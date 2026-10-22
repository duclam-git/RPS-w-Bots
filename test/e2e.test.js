'use strict';
// End-to-end: boots the real server (temp DB), registers real JS bots, plays tournaments to the end.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'test-admin-key';
const DB = path.join(os.tmpdir(), `ott-e2e-${process.pid}.db`);
const LB = path.join(os.tmpdir(), `ott-e2e-${process.pid}-lb.json`);
let server;

const RUSHER = `function getNextMove(state, helpers, log) {
  let best = null, bd = 1e9;
  for (const m of state.legalMoves) {
    const d = helpers.distance(m.to.r, m.to.c, state.myGoal.r, state.myGoal.c) - (m.capture ? 0.5 : 0);
    if (d < bd) { bd = d; best = m; }
  }
  log('rush', best.notation);
  return best;
}`;
const RANDOM = `function getNextMove(state, helpers) { return helpers.randomChoice(state.legalMoves); }`;
const BROKEN = `function getNextMove(state) { throw new Error('boom'); }`;

async function call(method, url, body, headers = {}) {
    const res = await fetch(BASE + url, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}
const admin = { 'x-admin-key': ADMIN };

async function waitFinished(tid, timeoutMs = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const { json } = await call('GET', `/api/tournaments/${tid}`);
        if (json.tournament.status === 'finished') return json;
        await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('tournament did not finish in time');
}

test.before(async () => {
    server = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), DB_PATH: DB, ADMIN_KEY: ADMIN, DISABLE_RATE_LIMIT: '1', ADMIN_KEY_HEADER: '1', ALLOW_GUEST_ROOMS: '1', ADMIN_PASSWORD: 'admin-pass-123', LEADERBOARD_PATH: LB },
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

test('static files: whitelist only (db / source are never served)', async () => {
    for (const p of ['/data/ott.db', '/server.js', '/db.js', '/package.json', '/temp_bots/x.js']) {
        const r = await fetch(BASE + p);
        assert.strictEqual(r.status, 404, p);
    }
    assert.strictEqual((await fetch(BASE + '/')).status, 200);
    assert.strictEqual((await fetch(BASE + '/logic.js')).status, 200);
});

test('admin endpoints require the key', async () => {
    const r = await call('POST', '/api/tournaments', { name: 'x', format: 'single_elim' });
    assert.strictEqual(r.status, 401);
});

test('registration rejects a broken bot with a readable reason', async () => {
    const { json: { id } } = await call('POST', '/api/tournaments', { name: 'reg', format: 'single_elim', config: { requireLogin: false } }, admin);
    const bad = await call('POST', `/api/tournaments/${id}/entries`, { name: 'Broken', lang: 'javascript', code: BROKEN });
    assert.strictEqual(bad.status, 422);
    assert.match(bad.json.error, /boom/);
    const ok = await call('POST', `/api/tournaments/${id}/entries`, { name: 'Good', lang: 'javascript', code: RANDOM });
    assert.strictEqual(ok.status, 201);
    assert.ok(ok.json.editToken);
    const dup = await call('POST', `/api/tournaments/${id}/entries`, { name: 'good', lang: 'javascript', code: RANDOM });
    assert.strictEqual(dup.status, 409);
    // code & tokens never leak
    const detail = (await call('GET', `/api/tournaments/${id}`)).json;
    assert.ok(!JSON.stringify(detail).includes('randomChoice'), 'submitted source code must never be exposed');   // a snippet only the submitted bot contains
    assert.ok(!JSON.stringify(detail).includes(ok.json.editToken));
});

test('single elimination with a bye (5 bots) plays to a champion; games are stored + replayable', async () => {
    const { json: { id } } = await call('POST', '/api/tournaments',
        { name: 'KO', format: 'single_elim', config: { requireLogin: false, bestOf: 1, thirdPlace: true, concurrency: 3, rules: { maxPlies: 60 } } }, admin);
    for (let i = 1; i <= 5; i++) {
        const r = await call('POST', `/api/tournaments/${id}/entries`,
            { name: `Bot${i}`, lang: 'javascript', code: i % 2 ? RUSHER : RANDOM });
        assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    }
    assert.strictEqual((await call('POST', `/api/tournaments/${id}/start`, { seeding: 'registration' }, admin)).status, 200);
    // registration is closed now
    assert.strictEqual((await call('POST', `/api/tournaments/${id}/entries`, { name: 'Late', lang: 'javascript', code: RANDOM })).status, 409);

    assert.strictEqual((await call('POST', `/api/tournaments/${id}/run`, { mode: 'all' }, admin)).status, 200);
    const done = await waitFinished(id);

    assert.ok(done.tournament.champion, 'has champion');
    const bracket = done.series.filter(s => s.stage === 'bracket');
    assert.strictEqual(bracket.length, 7);                        // 4 + 2 + 1 slots for 8-size bracket
    assert.strictEqual(bracket.filter(s => s.status === 'bye').length, 3);
    assert.ok(done.series.every(s => ['done', 'bye'].includes(s.status)));
    assert.strictEqual(done.series.filter(s => s.stage === 'third_place').length, 1);
    const final = bracket.find(s => s.round === 3);
    assert.strictEqual(final.winnerEntry, done.tournament.champion.id);

    // history + replay
    const list = (await call('GET', `/api/matches?tournament=${id}`)).json;
    assert.ok(list.total >= 4);                                   // at least the real games
    const m = (await call('GET', `/api/matches/${list.rows[0].id}`)).json;
    assert.strictEqual(m.initialBoard.length, 9);
    assert.ok(m.moves.length > 0 && m.moves.length <= 60);
    assert.strictEqual(m.moves[0].player, 1);
    assert.ok(['blue', 'red', 'draw'].includes(m.winner));
    // replaying the stored moves with the engine reproduces the stored result
    const E = require('../engine');
    const check = E.replayAndValidate(m.moves.map(x => ({ player: x.player, from: x.from, to: x.to })), E.resolveRules(m.rules));
    assert.ok(check.ok, check.error);
    assert.strictEqual(check.winner === 1 ? 'blue' : check.winner === 2 ? 'red' : 'draw', m.winner);
});

test('groups -> knockout (6 bots, 2 groups, top 2 advance)', async () => {
    const { json: { id } } = await call('POST', '/api/tournaments', {
        name: 'World', format: 'groups_knockout',
        config: { requireLogin: false, groupCount: 2, advance: 2, groupBestOf: 2, bestOf: 1, concurrency: 4, rules: { maxPlies: 40 } }
    }, admin);
    for (let i = 1; i <= 6; i++) {
        await call('POST', `/api/tournaments/${id}/entries`, { name: `G${i}`, lang: 'javascript', code: i <= 3 ? RUSHER : RANDOM });
    }
    assert.strictEqual((await call('POST', `/api/tournaments/${id}/start`, { seeding: 'random' }, admin)).status, 200);
    let d = (await call('GET', `/api/tournaments/${id}`)).json;
    assert.strictEqual(d.series.filter(s => s.stage === 'group').length, 6);   // 2 groups x C(3,2)
    assert.strictEqual(d.series.filter(s => s.stage === 'bracket').length, 0); // bracket appears after groups
    await call('POST', `/api/tournaments/${id}/run`, { mode: 'all' }, admin);
    d = await waitFinished(id);
    assert.strictEqual(Object.keys(d.standings).length, 2);
    assert.strictEqual(d.series.filter(s => s.stage === 'bracket').length, 3); // 4 qualifiers -> 2 semis + final
    assert.ok(d.tournament.champion);
});

test('local (browser) match upload is re-validated by the server', async () => {
    const E = require('../engine');
    // build a legal short game with the engine (random legal moves up to 6 plies, then cut -> not finished)
    const board = E.createInitialBoard();
    const moves = [];
    let p = 1;
    for (let i = 0; i < 6; i++) {
        const m = E.getLegalMoves(p, board)[0];
        moves.push({ player: p, from: m.from, to: m.to });
        E.applyMove(board, m);
        p = p === 1 ? 2 : 1;
    }
    const unfinished = await call('POST', '/api/matches/local', { blue: { name: 'A' }, red: { name: 'B' }, moves });
    assert.strictEqual(unfinished.status, 422);                               // game not over -> rejected
    const forged = await call('POST', '/api/matches/local', { blue: { name: 'A' }, red: { name: 'B' },
        moves: [{ player: 1, from: { r: 0, c: 0 }, to: { r: 8, c: 8 } }] });
    assert.strictEqual(forged.status, 422);
});

test('online room (socket.io) still works and the finished game lands in history', async () => {
    const { io } = require('socket.io-client');
    const a = io(BASE, { transports: ['websocket'] });
    const b = io(BASE, { transports: ['websocket'] });
    const once = (sock, ev) => new Promise(res => sock.once(ev, res));

    const created = once(a, 'room_created');
    a.emit('create_room', { playerName: 'Alice', lang: 'javascript' });
    const { roomCode } = await created;
    const joined = once(b, 'room_joined');
    b.emit('join_room', { roomCode, playerName: 'Bob', lang: 'javascript' });
    await joined;

    const moves = [];
    a.on('online_move_made', d => moves.push(d.moveRecord));
    const finished = once(a, 'online_match_finished');
    a.emit('player_ready', { code: RUSHER, lang: 'javascript', name: 'Alice' });
    b.emit('player_ready', { code: RUSHER, lang: 'javascript', name: 'Bob' });
    const result = await finished;
    a.close(); b.close();

    assert.ok(moves.length > 0);
    assert.ok(result.matchId, 'online_match_finished carries matchId');
    const m = (await call('GET', `/api/matches/${result.matchId}`)).json;
    assert.strictEqual(m.kind, 'online');
    assert.strictEqual(m.blue.name, 'Alice');
    assert.strictEqual(m.moves.length, moves.length);
});

test('local (browser) match: a genuine finished game is accepted, stored and replayable', async () => {
    const E = require('../engine');
    const board = E.createInitialBoard();
    const moves = [];
    let p = 1, res;
    // both sides rush their goal -> finishes quickly; same shape the browser uploads
    for (let i = 0; i < 400; i++) {
        const goal = p === 1 ? E.DEFAULT_RULES.blueGoal : E.DEFAULT_RULES.redGoal;
        const legal = E.getLegalMoves(p, board);
        legal.sort((a, b) =>
            (Math.max(Math.abs(a.to.r - goal.r), Math.abs(a.to.c - goal.c)) - (a.capture ? .5 : 0)) -
            (Math.max(Math.abs(b.to.r - goal.r), Math.abs(b.to.c - goal.c)) - (b.capture ? .5 : 0)));
        const m = legal[0];
        moves.push({ player: p, from: m.from, to: m.to });
        E.applyMove(board, m);
        res = E.checkWin(board);
        if (res.winner !== null) break;
        p = p === 1 ? 2 : 1;
    }
    assert.ok(res.winner !== null, 'test game should finish');

    // a lying client cannot choose the winner: the server derives it from the moves
    const out = await call('POST', '/api/matches/local', { blue: { name: 'Local<script>', lang: 'javascript' }, red: { name: 'Tactical AI' }, moves, winner: 'red' });
    assert.strictEqual(out.status, 201, JSON.stringify(out.json));
    const m = (await call('GET', `/api/matches/${out.json.id}`)).json;
    assert.strictEqual(m.kind, 'local');
    assert.strictEqual(m.winner, res.winner === 1 ? 'blue' : res.winner === 2 ? 'red' : 'draw');
    assert.strictEqual(m.moves.length, moves.length);
    const list = (await call('GET', '/api/matches?kind=local&player=tactical')).json;
    assert.ok(list.rows.some(r => r.id === out.json.id));
});

test('online room: a player leaving mid-match does not cancel it (result still saved); spectators cannot cancel it', async () => {
    const { io } = require('socket.io-client');
    const a = io(BASE, { transports: ['websocket'] });
    const b = io(BASE, { transports: ['websocket'] });
    const spec = io(BASE, { transports: ['websocket'] });
    const once = (sock, ev) => new Promise(res => sock.once(ev, res));

    const created = once(a, 'room_created');
    a.emit('create_room', { playerName: 'Stayer', lang: 'javascript' });
    const { roomCode } = await created;
    const joined = once(b, 'room_joined');
    b.emit('join_room', { roomCode, playerName: 'Quitter', lang: 'javascript' });
    await joined;
    const watching = once(spec, 'room_joined');
    spec.emit('join_room', { roomCode, playerName: 'Watcher' });
    assert.strictEqual((await watching).slot, 'spectator');

    const firstMove = once(a, 'online_move_made');
    const finished = once(a, 'online_match_finished');
    const aborted = new Promise(res => a.once('match_error', res));
    a.emit('player_ready', { code: RUSHER, lang: 'javascript' });
    b.emit('player_ready', { code: RUSHER, lang: 'javascript' });
    await firstMove;

    const refused = once(spec, 'join_error');
    spec.emit('request_rematch');
    assert.match(await refused, /người chơi/);

    const left = once(a, 'player_left_match');
    b.close();
    assert.match((await left).message, /Quitter/);

    const result = await Promise.race([finished, aborted.then(m => { throw new Error('match aborted: ' + m); })]);
    a.close(); spec.close();
    assert.ok(result.matchId);
    const m = (await call('GET', `/api/matches/${result.matchId}`)).json;
    assert.strictEqual(m.red.name, 'Quitter');
    assert.ok(m.reason && m.moves.length > 1, 'the match was played to its end');
});

test('server-side bot runs (/api/run-bot-move) need a logged-in account', async () => {
    const body = { lang: 'javascript', code: RANDOM, state: { legalMoves: [] }, game: 'rps' };
    assert.strictEqual((await call('POST', '/api/run-bot-move', body)).status, 401);

    const reg = await fetch(BASE + '/api/auth/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Runner_Probe', password: 'password-123' })
    });
    assert.strictEqual(reg.status, 201);
    const cookie = reg.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const res = await fetch(BASE + '/api/run-bot-move', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body)
    });
    assert.notStrictEqual(res.status, 401);
});
