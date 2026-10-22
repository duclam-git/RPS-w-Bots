'use strict';
// Accounts, sessions, admin, rated Elo, tournaments-with-accounts - against the real server.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 4100 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_KEY = 'auth-test-key';
const DB = path.join(os.tmpdir(), `ott-auth-${process.pid}.db`);
const LB = path.join(os.tmpdir(), `ott-auth-${process.pid}-lb.json`);
let server;

const RUSHER = `function getNextMove(state, helpers) {
  let best = null, bd = 1e9;
  for (const m of state.legalMoves) {
    const d = helpers.distance(m.to.r, m.to.c, state.myGoal.r, state.myGoal.c) - (m.capture ? 0.5 : 0);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}`;

// ---- tiny client with a cookie jar ----
class Client {
    constructor() { this.cookie = ''; }
    async call(method, url, body, headers = {}) {
        const res = await fetch(BASE + url, {
            method,
            headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
            body: body ? JSON.stringify(body) : undefined
        });
        const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        for (const c of set) {
            const [pair] = c.split(';');
            const [k, v] = pair.split('=');
            if (/Max-Age=0/i.test(c) || v === '') this.cookie = '';
            else this.cookie = `${k}=${v}`;
        }
        return { status: res.status, json: await res.json().catch(() => ({})), setCookie: set };
    }
}
async function account(name, password = 'password-123') {
    const c = new Client();
    const r = await c.call('POST', '/api/auth/register', { username: name, password });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    return c;
}

test.before(async () => {
    server = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), DB_PATH: DB, ADMIN_KEY, DISABLE_RATE_LIMIT: '1', ADMIN_KEY_HEADER: '1', ALLOW_GUEST_ROOMS: '1', ADMIN_PASSWORD: 'admin-pass-123', LEADERBOARD_PATH: LB },
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

test('register: validation, case-insensitive uniqueness, reserved names, secure cookie', async () => {
    const c = new Client();
    assert.strictEqual((await c.call('POST', '/api/auth/register', { username: 'a b', password: 'password-123' })).status, 400);
    assert.strictEqual((await c.call('POST', '/api/auth/register', { username: 'okname', password: 'short' })).status, 400);
    assert.strictEqual((await c.call('POST', '/api/auth/register', { username: 'Grandmaster AI'.replace(' ', '_'), password: 'password-123' })).status, 201); // not reserved (underscore)
    assert.strictEqual((await c.call('POST', '/api/auth/register', { username: 'Alice', password: 'password-123' })).status, 201);
    const dup = await new Client().call('POST', '/api/auth/register', { username: 'aLiCe', password: 'password-123' });
    assert.strictEqual(dup.status, 409);

    const fresh = new Client();
    const r = await fresh.call('POST', '/api/auth/register', { username: 'Cookie_Tester', password: 'password-123' });
    assert.strictEqual(r.status, 201);
    const cookie = r.setCookie.join(';');
    assert.match(cookie, /ott_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.ok(!JSON.stringify(r.json).includes('password'), 'no password material in responses');

    const me = await fresh.call('GET', '/api/auth/me');
    assert.strictEqual(me.json.user.username, 'Cookie_Tester');
    assert.strictEqual(me.json.user.elo, 1200);
    assert.strictEqual(me.json.isAdmin, false);
});

test('login / logout / wrong password / brute-force lockout', async () => {
    await account('LoginUser');
    const c = new Client();
    assert.strictEqual((await c.call('POST', '/api/auth/login', { username: 'LoginUser', password: 'nope-nope-nope' })).status, 401);
    assert.strictEqual((await c.call('GET', '/api/auth/me')).json.user, null);
    const ok = await c.call('POST', '/api/auth/login', { username: 'loginuser', password: 'password-123' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await c.call('GET', '/api/auth/me')).json.user.username, 'LoginUser');
    await c.call('POST', '/api/auth/logout');
    assert.strictEqual((await c.call('GET', '/api/auth/me')).json.user, null);

    // 5 failures lock the account for a while - even the right password is refused meanwhile
    const victim = await account('LockVictim');
    const attacker = new Client();
    for (let i = 0; i < 5; i++) await attacker.call('POST', '/api/auth/login', { username: 'LockVictim', password: 'wrong-wrong-' + i });
    const locked = await new Client().call('POST', '/api/auth/login', { username: 'LockVictim', password: 'password-123' });
    assert.strictEqual(locked.status, 429);
    assert.ok(victim.cookie, 'existing session is unaffected');
});

test('CSRF: state-changing requests from a foreign Origin are rejected', async () => {
    const c = await account('CsrfUser');
    const evil = await c.call('POST', '/api/auth/logout', undefined, { origin: 'http://evil.example' });
    assert.strictEqual(evil.status, 403);
    const same = await c.call('POST', '/api/auth/lang', { lang: 'python' }, { origin: BASE });
    assert.strictEqual(same.status, 200);
});

test('admin: one login page, password then ADMIN_KEY; only key-verified sessions are admin', async () => {
    // the seeded admin account cannot be registered by somebody else
    assert.strictEqual((await new Client().call('POST', '/api/auth/register', { username: 'ADMIN', password: 'password-123' })).status, 409);

    // step 1: right password -> NO session yet, only a short-lived HttpOnly challenge scoped to /api/auth
    const c = new Client();
    const s1 = await c.call('POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' });
    assert.strictEqual(s1.status, 200);
    assert.strictEqual(s1.json.needAdminKey, true);
    assert.ok(!s1.json.user, 'no user/session before the key');
    const ch = s1.setCookie.find(x => x.startsWith('ott_admin_challenge='));
    assert.ok(ch && /HttpOnly/i.test(ch) && /SameSite=Strict/i.test(ch) && /Path=\/api\/auth/i.test(ch), ch);
    assert.ok(!s1.setCookie.some(x => x.startsWith('ott_session=')), 'no session cookie in step 1');
    const challengeOnly = c.cookie;
    assert.strictEqual((await c.call('POST', '/api/tournaments', { name: 'x', format: 'single_elim' })).status, 401);

    // step 2: wrong key counts down, right key opens an admin session (shorter lifetime than a player's)
    c.cookie = challengeOnly;
    const bad = await c.call('POST', '/api/auth/admin-verify', { key: 'wrong' });
    assert.strictEqual(bad.status, 403);
    c.cookie = challengeOnly;
    const ok = await c.call('POST', '/api/auth/admin-verify', { key: ADMIN_KEY });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
    assert.strictEqual(ok.json.redirect, '/arena.html#/admin');
    const sess = ok.setCookie.find(x => x.startsWith('ott_session='));
    const maxAge = Number(/Max-Age=(\d+)/.exec(sess)[1]);
    assert.ok(maxAge <= 8 * 3600, 'admin session is short-lived: ' + maxAge);
    assert.strictEqual((await c.call('GET', '/api/auth/me')).json.isAdmin, true);
    assert.strictEqual((await c.call('POST', '/api/tournaments', { name: 'Admin by account', format: 'single_elim' })).status, 201);

    // the challenge is single use
    const replay = new Client(); replay.cookie = challengeOnly;
    assert.strictEqual((await replay.call('POST', '/api/auth/admin-verify', { key: ADMIN_KEY })).status, 401);

    // three wrong keys burn the challenge: start again from the password
    const d = new Client();
    await d.call('POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' });
    const dch = d.cookie;
    for (let i = 0; i < 2; i++) { d.cookie = dch; assert.strictEqual((await d.call('POST', '/api/auth/admin-verify', { key: 'nope' })).status, 403); }
    d.cookie = dch;
    const third = await d.call('POST', '/api/auth/admin-verify', { key: 'nope' });
    assert.strictEqual(third.json.restart, true);
    d.cookie = dch;
    assert.strictEqual((await d.call('POST', '/api/auth/admin-verify', { key: ADMIN_KEY })).status, 401, 'burnt challenge');

    // the key alone does not make anybody admin any more
    const p = await account('FutureAdmin');
    assert.strictEqual((await p.call('POST', '/api/auth/claim-admin', { key: ADMIN_KEY })).status, 410);
    assert.strictEqual((await p.call('GET', '/api/auth/me')).json.isAdmin, false);
    // players land on their home page
    const pl = await new Client().call('POST', '/api/auth/login', { username: 'FutureAdmin', password: 'password-123' });
    assert.strictEqual(pl.json.redirect, '/home.html');
    // the scripting header works only because this test server sets ADMIN_KEY_HEADER=1
    assert.strictEqual((await new Client().call('POST', '/api/tournaments', { name: 'k', format: 'single_elim' }, { 'x-admin-key': ADMIN_KEY })).status, 201);
});

test('player area pages need a session; login page sends logged-in users onwards', async () => {
    const get = (url, cookie) => fetch(BASE + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    for (const page of ['/', '/home.html', '/index.html', '/caro.html']) {
        const r = await get(page);
        assert.strictEqual(r.status, 302, page);
        assert.ok(r.headers.get('location').startsWith('/login.html'), page);
    }
    assert.strictEqual((await get('/login.html')).status, 200);
    assert.strictEqual((await get('/guide.html')).status, 200);
    assert.strictEqual((await get('/arena.html')).status, 200, 'tournaments stay public to watch');
    const u = await account('PageUser');
    assert.strictEqual((await get('/home.html', u.cookie)).status, 200);
    assert.strictEqual((await get('/caro.html', u.cookie)).status, 200);
    const lr = await get('/login.html', u.cookie);
    assert.strictEqual(lr.status, 302);
    assert.strictEqual(lr.headers.get('location'), '/home.html');
    const w = await get('/bot_worker.js', u.cookie);
    assert.strictEqual(w.headers.get('content-security-policy'), "default-src 'none'; script-src 'self' 'unsafe-eval'", 'bot worker: eval yes, network no');
    assert.strictEqual((await get('/data/ott.db')).status, 404);
});

test('tournament registration with accounts: login required, name = account, one entry each, owner-only edits', async () => {
    const admin = new Client();
    const { json: { id } } = await admin.call('POST', '/api/tournaments', { name: 'Accounts Cup', format: 'single_elim' }, { 'x-admin-key': ADMIN_KEY });
    const anon = new Client();
    assert.strictEqual((await anon.call('POST', `/api/tournaments/${id}/entries`, { name: 'x', lang: 'javascript', code: RUSHER })).status, 401);

    const bob = await account('Bob_T'), eve = await account('Eve_T');
    const r = await bob.call('POST', `/api/tournaments/${id}/entries`, { name: 'SomeoneElse', lang: 'javascript', code: RUSHER });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    assert.strictEqual(r.json.name, 'Bob_T', 'cannot pick another name');
    assert.strictEqual(r.json.editToken, null);
    assert.strictEqual((await bob.call('POST', `/api/tournaments/${id}/entries`, { lang: 'javascript', code: RUSHER })).status, 409);

    assert.strictEqual((await bob.call('PUT', `/api/tournaments/${id}/entries/${r.json.id}`, { code: RUSHER })).status, 200);
    assert.strictEqual((await eve.call('PUT', `/api/tournaments/${id}/entries/${r.json.id}`, { code: RUSHER })).status, 403);
    assert.strictEqual((await eve.call('DELETE', `/api/tournaments/${id}/entries/${r.json.id}`)).status, 403);
    assert.strictEqual((await bob.call('DELETE', `/api/tournaments/${id}/entries/${r.json.id}`)).status, 200);   // withdraw
    assert.strictEqual((await bob.call('POST', `/api/tournaments/${id}/entries`, { lang: 'javascript', code: RUSHER })).status, 201);

    // anonymous tournaments exist, but nobody can squat an account name there
    const { json: { id: open } } = await admin.call('POST', '/api/tournaments', { name: 'Open', format: 'single_elim', config: { requireLogin: false } }, { 'x-admin-key': ADMIN_KEY });
    assert.strictEqual((await anon.call('POST', `/api/tournaments/${open}/entries`, { name: 'bob_t', lang: 'javascript', code: RUSHER })).status, 409);
    assert.strictEqual((await anon.call('POST', `/api/tournaments/${open}/entries`, { name: 'Guest1', lang: 'javascript', code: RUSHER })).status, 201);
});

test('online rooms: rated games move Elo in the DB; guest games never do; tournament seeding follows Elo', async () => {
    const { io } = require('socket.io-client');
    const play = async (aCookie, bCookie, aName, bName) => {
        const a = io(BASE, { transports: ['websocket'], extraHeaders: aCookie ? { cookie: aCookie } : {} });
        const b = io(BASE, { transports: ['websocket'], extraHeaders: bCookie ? { cookie: bCookie } : {} });
        const once = (sock, ev) => new Promise(res => sock.once(ev, res));
        const created = once(a, 'room_created');
        a.emit('create_room', { playerName: aName, lang: 'javascript' });
        const { roomCode, roomState } = await created;
        const joined = once(b, 'room_joined');
        b.emit('join_room', { roomCode, playerName: bName, lang: 'javascript' });
        const j = await joined;
        const finished = once(a, 'online_match_finished');
        a.emit('player_ready', { code: RUSHER, lang: 'javascript', name: 'spoofed-name' });
        b.emit('player_ready', { code: RUSHER, lang: 'javascript', name: 'spoofed-name' });
        const result = await finished;
        a.close(); b.close();
        return { result, roomState, joinedState: j.roomState };
    };

    const winner = await account('Rated_A'), loser = await account('Rated_B');
    const rated = await play(winner.cookie, loser.cookie, 'ignored', 'ignored');
    assert.strictEqual(rated.joinedState.rated, true);
    assert.strictEqual(rated.joinedState.blue.name, 'Rated_A', 'account name wins over what the client sends');
    assert.ok(rated.result.eloOutcome, 'rated game returns an Elo outcome');
    assert.strictEqual(rated.result.eloOutcome.blue.delta, 16);          // identical ratings, Blue (first mover) wins
    const a = (await winner.call('GET', '/api/auth/me')).json.user, b = (await loser.call('GET', '/api/auth/me')).json.user;
    assert.deepStrictEqual([a.elo, a.wins, a.matches], [1216, 1, 1]);
    assert.deepStrictEqual([b.elo, b.losses, b.matches], [1184, 1, 1]);
    const lb = (await winner.call('GET', '/api/leaderboard')).json;
    assert.strictEqual(lb.find(p => p.name === 'Rated_A').elo, 1216);
    assert.ok(lb.some(p => p.isBot), 'reference AIs are still listed');

    // guest vs account: recorded in history, ladder untouched, spoofed names rejected
    const guestGame = await play(winner.cookie, null, 'x', 'Rated_B');            // guest pretends to be Rated_B
    assert.strictEqual(guestGame.joinedState.rated, false);
    assert.strictEqual(guestGame.joinedState.red.name, 'Rated_B (khách)');
    assert.strictEqual(guestGame.result.eloOutcome, null);
    assert.strictEqual((await winner.call('GET', '/api/auth/me')).json.user.elo, 1216);

    // same account on both seats is never rated
    const self = await play(winner.cookie, winner.cookie, 'x', 'y');
    assert.strictEqual(self.joinedState.rated, false);

    // profile + "my matches"
    const prof = (await new Client().call('GET', '/api/users/rated_a')).json;
    assert.strictEqual(prof.user.username, 'Rated_A');
    assert.strictEqual(prof.record.online.wins >= 1, true);
    assert.strictEqual(prof.user.rank >= 1, true);
    const mine = (await winner.call('GET', '/api/matches?mine=1')).json;
    assert.ok(mine.total >= 3 && mine.rows.every(m => m.blueUser === 'Rated_A' || m.redUser === 'Rated_A'));
    assert.strictEqual((await new Client().call('GET', '/api/matches?mine=1')).status, 401);

    // tournament seeding by rating: Rated_A (1216) must be seed 1 even though registered last
    const admin = new Client();
    const { json: { id } } = await admin.call('POST', '/api/tournaments', { name: 'Seeded', format: 'single_elim' }, { 'x-admin-key': ADMIN_KEY });
    for (const c of [loser, winner]) assert.strictEqual((await c.call('POST', `/api/tournaments/${id}/entries`, { lang: 'javascript', code: RUSHER })).status, 201);
    assert.strictEqual((await admin.call('POST', `/api/tournaments/${id}/start`, { seeding: 'rating' }, { 'x-admin-key': ADMIN_KEY })).status, 200);
    const d = (await admin.call('GET', `/api/tournaments/${id}`)).json;
    assert.strictEqual(d.entries[0].username, 'Rated_A');
    assert.strictEqual(d.entries[0].seed, 1);
});

test('password change signs out other devices', async () => {
    const phone = await account('Multi_Dev');
    const laptop = new Client();
    await laptop.call('POST', '/api/auth/login', { username: 'Multi_Dev', password: 'password-123' });
    assert.strictEqual((await laptop.call('GET', '/api/auth/me')).json.user.username, 'Multi_Dev');
    assert.strictEqual((await phone.call('POST', '/api/auth/password', { oldPassword: 'wrong', newPassword: 'new-password-1' })).status, 401);
    assert.strictEqual((await phone.call('POST', '/api/auth/password', { oldPassword: 'password-123', newPassword: 'new-password-1' })).status, 200);
    assert.strictEqual((await laptop.call('GET', '/api/auth/me')).json.user, null, 'other device is signed out');
    assert.strictEqual((await phone.call('GET', '/api/auth/me')).json.user.username, 'Multi_Dev');
    assert.strictEqual((await new Client().call('POST', '/api/auth/login', { username: 'Multi_Dev', password: 'new-password-1' })).status, 200);
});

test('practice games of both games are re-played by the server before they enter the history', async () => {
    const c = await account('PracticeUser');
    // 3x3 caro, Blue wins on the diagonal
    const moves = [[0, 0], [0, 1], [1, 1], [0, 2], [2, 2]].map(([r, cc], i) => ({ player: i % 2 ? 2 : 1, to: { r, c: cc } }));
    const ok = await c.call('POST', '/api/matches/local', { game: 'caro', rules: { size: 3, winLength: 3 }, mine: ['blue'], blue: { name: 'me' }, red: { name: 'bot' }, moves });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
    const m = (await c.call('GET', `/api/matches/${ok.json.id}`)).json;
    assert.deepStrictEqual([m.game, m.winner, m.rules.rows], ['caro', 'blue', 3]);
    // a forged game (Red claims a cell twice) and bad rules are refused
    const forged = moves.slice(0, 3).concat([{ player: 2, to: { r: 1, c: 1 } }]);
    assert.strictEqual((await c.call('POST', '/api/matches/local', { game: 'caro', rules: { size: 3, winLength: 3 }, moves: forged })).status, 422);
    assert.strictEqual((await c.call('POST', '/api/matches/local', { game: 'caro', rules: { size: 3, winLength: 6 }, moves })).status, 400);
    assert.strictEqual((await c.call('POST', '/api/matches/local', { game: 'chess', moves })).status, 400);
    const prof = (await c.call('GET', '/api/users/PracticeUser')).json;
    assert.deepStrictEqual(prof.byGame.caro, { games: 1, wins: 1, losses: 0, draws: 0 });
});
