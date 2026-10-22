'use strict';
// Network surface: hostile socket payloads, floods, cross-site WebSockets, proxies, headers,
// races in the room lifecycle, global bot cap, graceful shutdown and resume.
process.env.MAX_BOT_PROCS = '2';          // read by runner at load time (used by the cap test below)
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { io } = require('socket.io-client');
const runner = require('../runner');
const E = require('../engine');
const sandbox = require('../sandbox');

const ROOT = path.join(__dirname, '..');
let nextPort = 4400 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const procs = [];

const RUSHER = `function getNextMove(s, h) { let b = null, d = 1e9; for (const m of s.legalMoves) { const x = h.distance(m.to.r, m.to.c, s.myGoal.r, s.myGoal.c) - (m.capture ? .5 : 0); if (x < d) { d = x; b = m; } } return b; }`;

async function boot(env = {}, dbFile) {
    const port = nextPort++;
    const db = dbFile || path.join(os.tmpdir(), `ott-net-${process.pid}-${port}.db`);
    const proc = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), DB_PATH: db, ADMIN_KEY: 'net-key', LEADERBOARD_PATH: path.join(os.tmpdir(), `ott-net-${process.pid}-${port}-lb.json`), BACKUP_INTERVAL_HOURS: '0', ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const srv = { port, base: `http://127.0.0.1:${port}`, proc, db, out: '', err: '', exited: null };
    proc.stdout.on('data', d => { srv.out += d; });
    proc.stderr.on('data', d => { srv.err += d; });
    proc.on('exit', (c) => { srv.exited = c; });
    procs.push(srv);
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start: ' + srv.err)), 15000);
        const check = () => { if (srv.out.includes('running at')) { clearTimeout(t); resolve(); } else setTimeout(check, 50); };
        check();
    });
    srv.alive = () => srv.exited === null;
    srv.health = async () => (await fetch(srv.base + '/healthz')).json();
    srv.stop = async () => { if (srv.exited === null) { proc.kill('SIGKILL'); await sleep(100); } };
    return srv;
}
test.after(async () => {
    for (const s of procs) { await s.stop(); for (const f of [s.db, s.db + '-wal', s.db + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} } }
});

const connect = (srv, opts = {}) => new Promise((resolve, reject) => {
    const s = io(srv.base, { transports: ['websocket'], reconnection: false, ...opts });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
});
const once = (sock, ev, ms = 8000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms); sock.once(ev, (d) => { clearTimeout(t); res(d); }); });

// ------------------------------------------------------------------------------------------------
test('malformed / hostile socket payloads never crash the server', async () => {
    const srv = await boot({ DISABLE_RATE_LIMIT: '1' });
    const probes = [
        ['create_room', undefined], ['create_room', null], ['create_room', 42], ['create_room', 'x'], ['create_room', [1, 2]],
        ['join_room', null], ['join_room', 'x'], ['join_room', { roomCode: { evil: 1 } }], ['join_room', { roomCode: 'A'.repeat(5000) }],
        ['player_ready', null], ['player_ready', { code: 12345 }], ['player_ready', { code: 'x'.repeat(200 * 1024) }],
        ['watch_tournament', null], ['watch_tournament', { id: 1 }], ['request_rematch', null], ['leave_room', null],
        ['no_such_event', { a: 1 }]
    ];
    for (const [ev, payload] of probes) {
        const s = await connect(srv);
        payload === undefined ? s.emit(ev) : s.emit(ev, payload);
        await sleep(60);
        s.close();
        assert.ok(srv.alive(), `server died on ${ev}(${JSON.stringify(payload)?.slice(0, 40)}): ${srv.err.slice(0, 300)}`);
    }
    // an in-room socket sending garbage after a valid create
    const s = await connect(srv);
    s.emit('create_room', { playerName: { a: 1 }, lang: ['x'] });
    const created = await once(s, 'room_created');
    assert.match(created.roomCode, /^OTT-[A-Z2-9]{4}$/);
    s.emit('player_ready', { code: 'x'.repeat(200 * 1024), lang: 'cpp' });
    const bad = await once(s, 'match_code_error');
    assert.match(bad.error, /quá lớn/);
    s.close();
    assert.deepStrictEqual(await srv.health(), { ok: true, uptime: (await srv.health()).uptime });
});

test('event floods are dropped with rate_limited; per-IP socket cap holds; room cap holds', async () => {
    const srv = await boot({ MAX_SOCKETS_PER_IP: '4', MAX_ROOMS: '3' });
    const s = await connect(srv);
    let limited = 0, created = 0;
    s.on('rate_limited', () => limited++);
    s.on('room_created', () => created++);
    for (let i = 0; i < 300; i++) s.emit('create_room', { playerName: 'spam' });
    await sleep(500);
    assert.ok(limited > 200, `flood was dropped (${limited} rate_limited)`);
    assert.ok(created <= 6, `only a handful of rooms were created (${created})`);
    assert.ok(srv.alive());

    // sockets per IP
    const extra = [];
    let refused = 0;
    for (let i = 0; i < 4; i++) {
        const c = io(srv.base, { transports: ['websocket'], reconnection: false });
        c.on('join_error', () => { refused++; });
        extra.push(c);
    }
    await sleep(600);
    assert.ok(refused >= 1, `connections beyond the per-IP cap are refused (${refused})`);
    extra.forEach(c => c.close()); s.close();

    // global room cap
    await sleep(300);
    const owners = [];
    let full = 0;
    for (let i = 0; i < 5; i++) {
        const c = await connect(srv).catch(() => null);
        if (!c) continue;
        c.on('join_error', (m) => { if (/quá nhiều phòng/.test(m)) full++; });
        c.emit('create_room', { playerName: 'p' + i });
        owners.push(c);
        await sleep(60);
        if (owners.length >= 4) break;
    }
    await sleep(300);
    owners.forEach(c => c.close());
    assert.ok(full >= 1, 'room cap reached');
});

test('cross-site WebSocket hijacking is refused; same-origin, no-Origin and allow-listed origins connect', async () => {
    const srv = await boot({ DISABLE_RATE_LIMIT: '1' });
    await assert.rejects(connect(srv, { extraHeaders: { origin: 'http://evil.example' } }), 'foreign origin must be rejected');
    const same = await connect(srv, { extraHeaders: { origin: srv.base } });
    same.close();
    const none = await connect(srv);
    none.close();
    const polling = io(srv.base, { transports: ['polling'], reconnection: false, extraHeaders: { origin: 'http://evil.example' } });
    await assert.rejects(new Promise((res, rej) => { polling.once('connect', res); polling.once('connect_error', rej); }));
    polling.close();

    const trusted = await boot({ DISABLE_RATE_LIMIT: '1', ALLOWED_ORIGINS: 'http://school.example' });
    (await connect(trusted, { extraHeaders: { origin: 'http://school.example' } })).close();
    await assert.rejects(connect(trusted, { extraHeaders: { origin: 'http://evil.example' } }));
});

test('security headers, CORS policy and HSTS-only-on-https', async () => {
    const srv = await boot({ DISABLE_RATE_LIMIT: '1' });
    const r = await fetch(srv.base + '/');
    const h = (n) => r.headers.get(n);
    assert.match(h('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(h('content-security-policy'), /object-src 'none'/);
    assert.strictEqual(h('x-content-type-options'), 'nosniff');
    assert.strictEqual(h('x-frame-options'), 'DENY');
    assert.strictEqual(h('x-powered-by'), null);
    assert.strictEqual(h('strict-transport-security'), null, 'no HSTS over plain http');
    const tls = await fetch(srv.base + '/', { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(tls.headers.get('strict-transport-security') || '', /max-age=/);

    const evil = await fetch(srv.base + '/api/languages', { headers: { origin: 'http://evil.example' } });
    assert.strictEqual(evil.headers.get('access-control-allow-origin'), null, 'no CORS grant for foreign origins');
    const trusted = await boot({ DISABLE_RATE_LIMIT: '1', ALLOWED_ORIGINS: 'http://school.example' });
    const ok = await fetch(trusted.base + '/api/languages', { headers: { origin: 'http://school.example' } });
    assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'http://school.example');
    // and a cross-origin state-changing call is blocked by the CSRF guard even if CORS were granted
    const post = await fetch(trusted.base + '/api/auth/logout', { method: 'POST', headers: { origin: 'http://school.example' } });
    assert.strictEqual(post.status, 403);
});

test('behind a proxy: X-Forwarded-For is ignored unless TRUST_PROXY says how many hops to believe', async () => {
    let n = 0;      // a fresh username each time: the per-username lockout must not be what produces the 429
    const attempt = (srv, xff) => fetch(srv.base + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
        body: JSON.stringify({ username: `nobody${++n}x${process.pid}`, password: 'wrong-password' })
    }).then(r => r.status);

    const direct = await boot({});                                    // limiter on, no proxy trust
    const spoofed = [];
    for (let i = 0; i < 30; i++) spoofed.push(await attempt(direct, `10.0.0.${i}`));
    assert.ok(spoofed.includes(429), 'rotating a spoofed X-Forwarded-For must NOT dodge the limiter');

    const proxied = await boot({ TRUST_PROXY: '1' });                 // a real proxy appends the true client address
    const distinct = [];
    for (let i = 0; i < 30; i++) distinct.push(await attempt(proxied, `203.0.113.${i}`));
    assert.ok(!distinct.includes(429), 'distinct real clients behind the proxy are limited separately');
    const same = [];
    for (let i = 0; i < 30; i++) same.push(await attempt(proxied, '198.51.100.7'));
    assert.ok(same.includes(429), 'the same client is still limited');
});

test('two simultaneous submissions start exactly ONE match', async () => {
    const srv = await boot({ DISABLE_RATE_LIMIT: '1' });
    for (let round = 0; round < 3; round++) {
        const a = await connect(srv), b = await connect(srv);
        a.emit('create_room', { playerName: 'A' });
        const { roomCode } = await once(a, 'room_created');
        b.emit('join_room', { roomCode, playerName: 'B' });
        await once(b, 'room_joined');
        let started = 0, preparing = 0;
        a.on('match_started', () => started++);
        a.on('match_preparing', () => preparing++);
        a.emit('player_ready', { code: RUSHER, lang: 'javascript' });
        b.emit('player_ready', { code: RUSHER, lang: 'javascript' });     // same tick
        await sleep(4200);
        assert.strictEqual(preparing, 1, `round ${round}: compile phase ran once`);
        assert.strictEqual(started, 1, `round ${round}: one match started`);
        a.emit('leave_room'); a.close(); b.close();
        await sleep(150);
    }
    assert.ok(srv.alive(), srv.err.slice(0, 300));
});

test('a player leaving while the other bot is compiling does not crash the server', async (t) => {
    if (!sandbox.which('g++')) return t.skip('g++ missing');
    global.window = {}; delete require.cache[require.resolve('../bot_templates.js')]; require('../bot_templates.js');
    const cpp = global.window.MULTI_LANG_TEMPLATES.cpp.blue;
    const srv = await boot({ DISABLE_RATE_LIMIT: '1' });
    for (const leaveAfter of [30, 400, 1100, 2000]) {
        const a = await connect(srv), b = await connect(srv);
        a.emit('create_room', { playerName: 'A' });
        const { roomCode } = await once(a, 'room_created');
        b.emit('join_room', { roomCode, playerName: 'B' });
        await once(b, 'room_joined');
        let started = 0; const updates = [];
        a.on('match_started', () => started++);
        a.on('room_updated', (s) => updates.push(s));
        a.emit('player_ready', { code: cpp, lang: 'cpp' });
        b.emit('player_ready', { code: cpp, lang: 'cpp' });
        await sleep(leaveAfter);
        b.emit('leave_room');
        await sleep(3500);
        assert.ok(srv.alive(), `server died when a player left ${leaveAfter}ms into the compile: ${srv.err.slice(0, 400)}`);
        assert.strictEqual(started, 0, 'no match without an opponent');
        assert.strictEqual(updates[updates.length - 1].red, null);
        // the room still works: a new opponent can sit down
        const c = await connect(srv);
        c.emit('join_room', { roomCode, playerName: 'C' });
        const joined = await once(c, 'room_joined');
        assert.strictEqual(joined.slot, 'red');
        a.close(); b.close(); c.close();
        await sleep(100);
    }
    const left = fs.readdirSync(path.join(ROOT, 'temp_bots')).filter(f => /^bot_OTT-/.test(f));
    assert.deepStrictEqual(left, [], `compiled bots of abandoned rooms were cleaned up: ${left}`);
});

test('all bot processes of the whole server share one cap; waiting is not charged to the bot', async () => {
    await runner.detectToolchains();
    const slow = await runner.prepareBot('cap_slow', 'javascript', 'function getNextMove(s) { const t = Date.now(); while (Date.now() - t < 300); return s.legalMoves[0]; }');
    const board = E.createInitialBoard();
    const state = { board, myPlayer: 1, legalMoves: E.getLegalMoves(1, board), myGoal: { r: 0, c: 8 }, moveHistory: [] };
    const t0 = Date.now();
    const results = await Promise.all(Array.from({ length: 8 }, () => runner.executeBotMove(slow.botHandler, state, 3000)));
    const wall = Date.now() - t0;
    runner.cleanupBot(slow.botHandler);
    const st = runner.getStats().bots;
    assert.strictEqual(st.limit, 2);
    assert.ok(st.maxActive <= 2, `at most 2 bot processes at once (saw ${st.maxActive})`);
    assert.ok(results.every(r => r.move), 'every bot still answered');
    assert.ok(Math.max(...results.map(r => r.elapsed)) < 900, `queue time is not charged: ${results.map(r => r.elapsed)}`);
    assert.ok(wall > 1000, `work was queued, not run all at once (${wall}ms)`);
});

test('SIGTERM shuts down cleanly (exit 0) and an auto-running tournament resumes after restart', async () => {
    const dbFile = path.join(os.tmpdir(), `ott-net-shutdown-${process.pid}.db`);
    const key = { 'x-admin-key': 'net-key', 'content-type': 'application/json' };
    const srv = await boot({ DISABLE_RATE_LIMIT: '1' }, dbFile);
    const call = async (s, m, u, b) => (await fetch(s.base + u, { method: m, headers: key, body: b ? JSON.stringify(b) : undefined })).json();
    const { id } = await call(srv, 'POST', '/api/tournaments', { name: 'Resume', format: 'single_elim', config: { requireLogin: false, bestOf: 1, moveDelayMs: 60, concurrency: 2, rules: { maxPlies: 40 } } });
    for (let i = 1; i <= 4; i++) await call(srv, 'POST', `/api/tournaments/${id}/entries`, { name: `B${i}`, lang: 'javascript', code: RUSHER });
    await call(srv, 'POST', `/api/tournaments/${id}/start`, {});
    await call(srv, 'POST', `/api/tournaments/${id}/run`, { mode: 'all' });
    await sleep(700);
    assert.notStrictEqual((await call(srv, 'GET', `/api/tournaments/${id}`)).tournament.status, 'finished', 'still mid-run when we stop it');

    srv.proc.kill('SIGTERM');
    for (let i = 0; i < 100 && srv.exited === null; i++) await sleep(100);
    assert.strictEqual(srv.exited, 0, `clean exit (got ${srv.exited})`);
    assert.match(srv.out, /Đang tắt máy chủ/);

    const again = await boot({ DISABLE_RATE_LIMIT: '1' }, dbFile);
    let d;
    for (let i = 0; i < 200; i++) { d = await call(again, 'GET', `/api/tournaments/${id}`); if (d.tournament.status === 'finished') break; await sleep(300); }
    assert.strictEqual(d.tournament.status, 'finished', 'tournament resumed by itself after the restart');
    assert.ok(d.tournament.champion);
    again.proc.kill('SIGTERM');
    for (let i = 0; i < 100 && again.exited === null; i++) await sleep(100);
    assert.strictEqual(again.exited, 0);
});
