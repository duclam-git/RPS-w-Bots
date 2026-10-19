'use strict';
// Admin features (issue #4): custom rules, time bank, editing tournaments, fixing results, user admin.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const E = require('../engine');
const runner = require('../runner');
const mp = require('../matchplay');

const PORT = 4300 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'admin-test-key';
const DB = path.join(os.tmpdir(), `ott-admin-${process.pid}.db`);
const LB = path.join(os.tmpdir(), `ott-admin-${process.pid}-lb.json`);
let server;

const RUSHER = `function getNextMove(s, h) { let b = null, d = 1e9; for (const m of s.legalMoves) { const x = h.distance(m.to.r, m.to.c, s.myGoal.r, s.myGoal.c) - (m.capture ? .5 : 0); if (x < d) { d = x; b = m; } } return b; }`;
const SLOW = `function getNextMove(s, h) { const t = Date.now(); while (Date.now() - t < 350); return s.legalMoves[0]; }`;

class Client {
    constructor() { this.cookie = ''; }
    async call(method, url, body, headers = {}) {
        const res = await fetch(BASE + url, {
            method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
            body: body ? JSON.stringify(body) : undefined
        });
        for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
            const [pair] = c.split(';');
            this.cookie = /Max-Age=0/i.test(c) ? '' : pair;
        }
        return { status: res.status, json: await res.json().catch(() => ({})) };
    }
}
const admin = new Client();
const A = { 'x-admin-key': KEY };
const create = async (cfg, format = 'single_elim') => (await admin.call('POST', '/api/tournaments', { name: 'T', format, config: { requireLogin: false, ...cfg } }, A)).json.id;
const enter = async (tid, n) => { for (let i = 1; i <= n; i++) { const r = await admin.call('POST', `/api/tournaments/${tid}/entries`, { name: `B${i}`, lang: 'javascript', code: RUSHER }); assert.strictEqual(r.status, 201, JSON.stringify(r.json)); } };
const detail = async (tid) => (await admin.call('GET', `/api/tournaments/${tid}`)).json;
async function waitFinished(tid) {
    for (let i = 0; i < 300; i++) { const d = await detail(tid); if (d.tournament.status === 'finished') return d; await new Promise(r => setTimeout(r, 300)); }
    throw new Error('not finished');
}

test.before(async () => {
    server = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), DB_PATH: DB, ADMIN_KEY: KEY, DISABLE_RATE_LIMIT: '1', LEADERBOARD_PATH: LB },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start')), 15000);
        server.stdout.on('data', d => { if (String(d).includes('running at')) { clearTimeout(t); resolve(); } });
        server.on('exit', c => reject(new Error('server exited ' + c)));
    });
});
test.after(() => {
    if (server) server.kill();
    for (const f of [DB, DB + '-wal', DB + '-shm', LB]) { try { fs.unlinkSync(f); } catch (e) {} }
});

// ---------------------------------------------------------------- rules
test('validateRules: accepts sane rules, explains every problem otherwise', () => {
    assert.ok(E.validateRules({}).ok);
    assert.ok(E.validateRules({ setup: E.DEFAULT_RULES.setup, maxPlies: 100, moveTimeoutMs: 1000, timeBankMs: 30000 }).ok);
    const bad = E.validateRules({ maxPlies: 5, moveTimeoutMs: 99999, timeBankMs: 10,
        setup: { p1: [{ r: 4, c: 4, t: 'rock' }, { r: 4, c: 4, t: 'paper' }, { r: 0, c: 8, t: 'rock' }], p2: [] } });
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.errors.length >= 5, bad.errors.join(' | '));
    assert.ok(!E.validateRules({ setup: { p1: [{ r: 9, c: 0, t: 'rock' }], p2: [{ r: 1, c: 1, t: 'rock' }] } }).ok, 'off-board');
    assert.ok(!E.validateRules({ setup: { p1: [{ r: 4, c: 4, t: 'lizard' }], p2: [{ r: 1, c: 1, t: 'rock' }] } }).ok, 'unknown piece');
    assert.ok(!E.validateRules({ blueGoal: { r: 3, c: 3 }, redGoal: { r: 3, c: 3 }, setup: { p1: [{ r: 4, c: 4, t: 'rock' }], p2: [{ r: 1, c: 1, t: 'rock' }] } }).ok, 'same goals');
});

test('time bank: a side that burns its total thinking time loses', async () => {
    const slow = await runner.prepareBot('tb_slow', 'javascript', SLOW);
    const fast = await runner.prepareBot('tb_fast', 'javascript', RUSHER);
    const res = await mp.playMatch({
        blue: { name: 'slow', handler: slow.botHandler }, red: { name: 'fast', handler: fast.botHandler },
        rules: E.resolveRules({ timeBankMs: 1200, moveTimeoutMs: 2000 })
    });
    runner.cleanupBot(slow.botHandler); runner.cleanupBot(fast.botHandler);
    assert.strictEqual(res.winner, 2);
    assert.match(res.reason, /hết tổng thời gian/);
    assert.ok(res.moves.length <= 8, `ended quickly (${res.moves.length} plies)`);
});

test('custom setup + goals are used by real games, stored with the match, and replay validates', async () => {
    const rules = { maxPlies: 40, setup: { p1: [{ r: 4, c: 2, t: 'rock' }, { r: 5, c: 2, t: 'paper' }], p2: [{ r: 4, c: 6, t: 'scissors' }] },
        blueGoal: { r: 0, c: 4 }, redGoal: { r: 8, c: 4 } };
    const tid = await create({ bestOf: 1, rules });
    await enter(tid, 2);
    assert.strictEqual((await admin.call('POST', `/api/tournaments/${tid}/start`, {}, A)).status, 200);
    await admin.call('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }, A);
    const d = await waitFinished(tid);
    const list = (await admin.call('GET', `/api/matches?tournament=${tid}`)).json;
    const m = (await admin.call('GET', `/api/matches/${list.rows[0].id}`)).json;
    assert.strictEqual(m.initialBoard.flat().filter(Boolean).length, 3, 'only the 3 custom pieces exist');
    assert.deepStrictEqual(m.rules.blueGoal, { r: 0, c: 4 });
    const check = E.replayAndValidate(m.moves.map(x => ({ player: x.player, from: x.from, to: x.to })), E.resolveRules(m.rules));
    assert.ok(check.ok, check.error);
    assert.ok(d.tournament.champion);
});

test('invalid rules are rejected with a readable message; rules endpoints work', async () => {
    const r = await admin.call('POST', '/api/tournaments', { name: 'bad', format: 'single_elim', config: { rules: { setup: { p1: [], p2: [] } } } }, A);
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /ít nhất 1 quân/);
    const v = await admin.call('POST', '/api/rules/validate', { maxPlies: 3 });
    assert.strictEqual(v.json.ok, false);
    const def = (await admin.call('GET', '/api/rules/default')).json;
    assert.strictEqual(def.setup.p1.length, 10);
});

// ---------------------------------------------------------------- editing
test('edit a tournament: free while registering, restricted after start', async () => {
    const tid = await create({ bestOf: 3 });
    await enter(tid, 2);
    let r = await admin.call('PATCH', `/api/tournaments/${tid}`, { name: 'Renamed', format: 'round_robin', config: { groupBestOf: 2, rules: { maxPlies: 50, timeBankMs: 60000 } } }, A);
    assert.strictEqual(r.status, 200);
    let d = await detail(tid);
    assert.deepStrictEqual([d.tournament.name, d.tournament.format, d.tournament.config.rules.maxPlies], ['Renamed', 'round_robin', 50]);
    assert.strictEqual((await admin.call('PATCH', `/api/tournaments/${tid}`, { config: { rules: { maxPlies: 5 } } }, A)).status, 400);
    assert.strictEqual((await new Client().call('PATCH', `/api/tournaments/${tid}`, { name: 'hax' })).status, 401);

    await admin.call('POST', `/api/tournaments/${tid}/start`, {}, A);
    assert.strictEqual((await admin.call('PATCH', `/api/tournaments/${tid}`, { config: { rules: { maxPlies: 70 } } }, A)).status, 409);
    assert.strictEqual((await admin.call('PATCH', `/api/tournaments/${tid}`, { format: 'single_elim' }, A)).status, 409);
    assert.strictEqual((await admin.call('PATCH', `/api/tournaments/${tid}`, { name: 'Live rename', config: { moveDelayMs: 100, concurrency: 1, rules: { maxPlies: 50, timeBankMs: 60000 } } }, A)).status, 200);
    d = await detail(tid);
    assert.deepStrictEqual([d.tournament.name, d.tournament.config.moveDelayMs, d.tournament.config.concurrency], ['Live rename', 100, 1]);
});

test('admin decides pairings by hand, can replay them, and cannot break later rounds', async () => {
    const tid = await create({ bestOf: 1, rules: { maxPlies: 40 } });
    await enter(tid, 4);
    await admin.call('POST', `/api/tournaments/${tid}/start`, { seeding: 'registration' }, A);
    let d = await detail(tid);
    const semis = d.series.filter(s => s.round === 1).sort((a, b) => a.slot - b.slot);
    const final = d.series.find(s => s.round === 2);
    const res = (sid, winner) => admin.call('POST', `/api/tournaments/${tid}/series/${sid}/result`, { winner }, A);

    assert.strictEqual((await res(final.id, 'a')).status, 409, 'final is not ready yet');
    assert.strictEqual((await res(semis[0].id, 'tie')).status, 400, 'no ties in a bracket');
    assert.strictEqual((await res(semis[0].id, 'a')).status, 200);
    d = await detail(tid);
    const s0 = d.series.find(s => s.id === semis[0].id);
    assert.deepStrictEqual([s0.status, s0.decidedBy, s0.winnerEntry], ['done', 'admin', s0.a.id]);
    assert.strictEqual(d.series.find(s => s.id === final.id).a.id, s0.a.id, 'winner advanced');

    assert.strictEqual((await res(semis[1].id, 'b')).status, 200);
    assert.strictEqual((await res(final.id, 'b')).status, 200);
    d = await detail(tid);
    assert.strictEqual(d.tournament.status, 'finished');
    assert.ok(d.tournament.champion);

    // replaying semi 1 is refused while the final used its result...
    const refuse = await admin.call('POST', `/api/tournaments/${tid}/series/${semis[0].id}/reset`, undefined, A);
    assert.strictEqual(refuse.status, 409);
    // ...but undoing from the top works: final -> semi, tournament re-opens
    assert.strictEqual((await admin.call('POST', `/api/tournaments/${tid}/series/${final.id}/reset`, undefined, A)).status, 200);
    d = await detail(tid);
    assert.deepStrictEqual([d.tournament.status, d.tournament.champion], ['running', null]);
    assert.strictEqual((await admin.call('POST', `/api/tournaments/${tid}/series/${semis[0].id}/reset`, undefined, A)).status, 200);
    d = await detail(tid);
    const f2 = d.series.find(s => s.id === final.id);
    assert.deepStrictEqual([f2.a, f2.status], [null, 'pending'], 'semi winner was taken back out of the final');

    // the engine can now play the repaired bracket to the end
    await admin.call('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }, A);
    d = await waitFinished(tid);
    assert.ok(d.tournament.champion);
});

test('resetting a played pairing deletes its games and replays it', async () => {
    const tid = await create({ bestOf: 1, rules: { maxPlies: 40 } });
    await enter(tid, 2);
    await admin.call('POST', `/api/tournaments/${tid}/start`, {}, A);
    await admin.call('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }, A);
    let d = await waitFinished(tid);
    const before = (await admin.call('GET', `/api/matches?tournament=${tid}`)).json.total;
    assert.ok(before >= 1);
    const sid = d.series[0].id;
    assert.strictEqual((await admin.call('POST', `/api/tournaments/${tid}/series/${sid}/reset`, undefined, A)).status, 200);
    assert.strictEqual((await admin.call('GET', `/api/matches?tournament=${tid}`)).json.total, 0);
    d = await detail(tid);
    assert.deepStrictEqual([d.tournament.status, d.series[0].status, d.series[0].gamesPlayed], ['running', 'ready', 0]);
    await admin.call('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }, A);
    assert.ok((await waitFinished(tid)).tournament.champion);
});

test('history: admins can delete online/local records but never tournament games', async () => {
    const board = E.createInitialBoard();
    const moves = []; let p = 1, res;
    for (let i = 0; i < 400; i++) {
        const goal = p === 1 ? E.DEFAULT_RULES.blueGoal : E.DEFAULT_RULES.redGoal;
        const legal = E.getLegalMoves(p, board).sort((a, b) =>
            Math.max(Math.abs(a.to.r - goal.r), Math.abs(a.to.c - goal.c)) - Math.max(Math.abs(b.to.r - goal.r), Math.abs(b.to.c - goal.c)));
        moves.push({ player: p, from: legal[0].from, to: legal[0].to });
        E.applyMove(board, legal[0]);
        res = E.checkWin(board); if (res.winner !== null) break;
        p = p === 1 ? 2 : 1;
    }
    const up = await new Client().call('POST', '/api/matches/local', { blue: { name: 'X' }, red: { name: 'Y' }, moves });
    assert.strictEqual(up.status, 201, JSON.stringify(up.json));
    assert.strictEqual((await new Client().call('DELETE', `/api/matches/${up.json.id}`)).status, 401);
    assert.strictEqual((await admin.call('DELETE', `/api/matches/${up.json.id}`, undefined, A)).status, 200);
    assert.strictEqual((await admin.call('GET', `/api/matches/${up.json.id}`)).status, 404);
    const t = (await admin.call('GET', '/api/matches?kind=tournament&limit=1')).json.rows[0];
    assert.strictEqual((await admin.call('DELETE', `/api/matches/${t.id}`, undefined, A)).status, 404);
});

// ---------------------------------------------------------------- users
test('user administration: roles, last-admin guard, password reset revokes sessions', async () => {
    const mk = async (name) => { const c = new Client(); const r = await c.call('POST', '/api/auth/register', { username: name, password: 'password-123' }); return { c, id: r.json.user.id }; };
    const boss = await mk('Boss_1'), pupil = await mk('Pupil_1');
    assert.strictEqual((await pupil.c.call('GET', '/api/admin/users')).status, 401);
    assert.strictEqual((await boss.c.call('POST', '/api/auth/claim-admin', { key: KEY })).status, 200);

    const list = (await boss.c.call('GET', '/api/admin/users')).json;
    assert.ok(list.find(u => u.username === 'Pupil_1') && !JSON.stringify(list).includes('password'));

    assert.strictEqual((await boss.c.call('POST', `/api/admin/users/${pupil.id}/role`, { role: 'admin' })).status, 200);
    assert.strictEqual((await pupil.c.call('GET', '/api/auth/me')).json.isAdmin, true);
    assert.strictEqual((await boss.c.call('POST', `/api/admin/users/${pupil.id}/role`, { role: 'user' })).status, 200);
    assert.strictEqual((await boss.c.call('POST', `/api/admin/users/${boss.id}/role`, { role: 'user' })).status, 409, 'last admin is protected');
    assert.strictEqual((await boss.c.call('POST', `/api/admin/users/${pupil.id}/role`, { role: 'king' })).status, 400);

    assert.strictEqual((await boss.c.call('POST', `/api/admin/users/${pupil.id}/password`, { password: 'short' })).status, 400);
    assert.strictEqual((await boss.c.call('POST', `/api/admin/users/${pupil.id}/password`, { password: 'reset-pass-99' })).status, 200);
    assert.strictEqual((await pupil.c.call('GET', '/api/auth/me')).json.user, null, 'old session revoked');
    assert.strictEqual((await new Client().call('POST', '/api/auth/login', { username: 'Pupil_1', password: 'reset-pass-99' })).status, 200);
});

// ---------------------------------------------------------------- error responses
test('errors are always JSON (no HTML pages / stack traces), including bad JSON and bad ids', async () => {
    const raw = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username": ' });
    assert.strictEqual(raw.status, 400);
    assert.match(raw.headers.get('content-type'), /json/);
    const body = await raw.json();
    assert.ok(body.error && !JSON.stringify(body).includes('node_modules'), JSON.stringify(body));

    const badId = await admin.call('GET', '/api/matches/not-a-number');
    assert.strictEqual(badId.status, 400);
    assert.strictEqual(typeof badId.json.error, 'string');
    const big = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(3 * 1024 * 1024) }) });
    assert.strictEqual(big.status, 413);
    assert.ok((await big.json()).error);
});

// ---------------------------------------------------------------- sandbox in the real server
test('sandbox status is admin-only and describes every language', async () => {
    assert.strictEqual((await new Client().call('GET', '/api/admin/sandbox')).status, 401);
    const { sandbox, toolchains } = (await admin.call('GET', '/api/admin/sandbox', undefined, A)).json;
    assert.ok(['bwrap', 'builtin', 'off'].includes(sandbox.driver));
    for (const l of ['javascript', 'python', 'cpp']) assert.ok(['strong', 'basic', 'weak', 'none'].includes(sandbox.levels[l]), l);
    assert.ok(toolchains.javascript.ok);
});

test('a bot that goes after the server database and admin key finds nothing (end to end, real tournament)', async () => {
    const thief = `function getNextMove(s, h, log) {
  const fs = require('fs');
  try { log('DB:' + fs.readFileSync(${JSON.stringify(DB)}).slice(0, 16).toString()); } catch (e) { log('DB:blocked'); }
  try { log('FILES:' + fs.readdirSync(${JSON.stringify(path.dirname(DB))}).length); } catch (e) { log('FILES:blocked'); }
  log('KEY:' + process.env.ADMIN_KEY);
  let b = null, d = 1e9; for (const m of s.legalMoves) { const x = h.distance(m.to.r, m.to.c, s.myGoal.r, s.myGoal.c); if (x < d) { d = x; b = m; } } return b;
}`;
    const tid = await create({ bestOf: 1, rules: { maxPlies: 30 } });
    assert.strictEqual((await admin.call('POST', `/api/tournaments/${tid}/entries`, { name: 'Thief', lang: 'javascript', code: thief })).status, 201);
    assert.strictEqual((await admin.call('POST', `/api/tournaments/${tid}/entries`, { name: 'Honest', lang: 'javascript', code: RUSHER })).status, 201);
    await admin.call('POST', `/api/tournaments/${tid}/start`, {}, A);
    await admin.call('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }, A);
    await waitFinished(tid);
    const list = (await admin.call('GET', `/api/matches?tournament=${tid}`)).json;
    const logs = [];
    for (const row of list.rows) {
        const m = (await admin.call('GET', `/api/matches/${row.id}`)).json;
        logs.push(...m.moves.map(x => x.log));
    }
    const all = logs.join('\n');
    assert.match(all, /KEY:undefined/, 'the thief did run');
    assert.ok(!all.includes(KEY), 'ADMIN_KEY leaked into a bot');
    assert.ok(!all.includes('SQLite format'), 'database bytes leaked into a bot');
    assert.ok(!/FILES:[1-9]/.test(all), 'bot could list the data directory');
});

test('editing right after pausing / finishing waits for the scheduler instead of failing', async () => {
    const tid = await create({ bestOf: 1, moveDelayMs: 80, concurrency: 2, rules: { maxPlies: 40 } });
    await enter(tid, 4);
    await admin.call('POST', `/api/tournaments/${tid}/start`, {}, A);
    const semis = (await detail(tid)).series.filter(s => s.round === 1);
    await admin.call('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }, A);
    await new Promise(r => setTimeout(r, 500));                       // games are in flight
    assert.strictEqual((await admin.call('POST', `/api/tournaments/${tid}/series/${semis[0].id}/result`, { winner: 'a' }, A)).status, 409, 'still running -> must pause first');
    await admin.call('POST', `/api/tournaments/${tid}/pause`, undefined, A);
    const r = await admin.call('POST', `/api/tournaments/${tid}/series/${semis[0].id}/result`, { winner: 'a' }, A);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));       // waited for the loop to drain
    // resume and play out the rest, then edit immediately after the final whistle
    await admin.call('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }, A);
    const d = await waitFinished(tid);
    const final = d.series.find(s => s.round === 2);
    const again = await admin.call('POST', `/api/tournaments/${tid}/series/${final.id}/reset`, undefined, A);
    assert.strictEqual(again.status, 200, JSON.stringify(again.json));
    const run2 = await admin.call('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }, A);
    assert.strictEqual(run2.json.started, true, 'a fresh loop starts right after the reset');
    assert.ok((await waitFinished(tid)).tournament.champion);
});
