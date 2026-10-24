'use strict';
// Warm bot processes (runner.js): JavaScript / Python bots answer many moves from one process, yet every move
// behaves as if the bot had just been started, and a process that misbehaves never costs the next move.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');
const runner = require('../runner');
const E = require('../engine');

const hasPy = () => runner.getToolchains().python.ok;
const state = (turn = 1) => {
    const board = E.createInitialBoard();
    return { board, myPlayer: 1, legalMoves: E.getLegalMoves(1, board), myGoal: { r: 0, c: 8 }, moveHistory: [], turnNumber: turn };
};
const prep = async (lang, code) => {
    const p = await runner.prepareBot(`warm_${lang}_${Math.random().toString(36).slice(2, 8)}`, lang, code);
    assert.ok(p.success, p.error);
    return p.botHandler;
};
const warmOf = (h) => [...(h.warmIdle || [])].length;
// processes whose command line names this bot (a bubblewrap sandbox shows up as two)
const alive = (h) => {
    const id = path.basename(h.scriptPath);
    return Number(execSync(`ps -eo args | grep -F "${id}" | grep -v grep | wc -l`).toString().trim());
};
const stats = () => runner.getStats().warm;

test.before(() => runner.detectToolchains());

test('a warm bot answers later moves from the same process, each move from a fresh scope', async () => {
    const h = await prep('javascript', `let calls = 0;
function getNextMove(s, h, log) { calls++; log('calls=' + calls); return s.legalMoves[0]; }`);
    const before = stats();
    const first = await runner.executeBotMove(h, state(), 2500);
    const times = [];
    for (let i = 0; i < 5; i++) {
        const r = await runner.executeBotMove(h, state(), 2500);
        assert.ok(r.move, r.error);
        assert.match(r.log, /^calls=1$/, 'top-level variables start over every move');
        times.push(r.elapsed);
    }
    assert.ok(first.move, first.error);
    const after = stats();
    assert.strictEqual(after.started - before.started, 1, 'one process for six moves');
    assert.strictEqual(after.reused - before.reused, 5);
    assert.strictEqual(warmOf(h), 1);
    assert.ok(Math.max(...times) < first.elapsed + 5, `reused moves are not slower than the first: ${first.elapsed} / ${times}`);
    runner.cleanupBot(h);
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(alive(h), 0, 'cleanupBot stops the warm process');
});

test('python: the bot script runs as __main__ on every move with that move as its stdin', { skip: false }, async (t) => {
    if (!hasPy()) return t.skip('python missing');
    const h = await prep('python', `import sys, json
seen = globals().get('seen', 0) + 1
s = json.loads(sys.stdin.read())
print('turn', s['turnNumber'], 'seen', seen, file=sys.stderr)
if __name__ == '__main__':
    m = s['legalMoves'][s['turnNumber'] % len(s['legalMoves'])]
    print(json.dumps({'from': m['from'], 'to': m['to']}))`);
    for (const turn of [1, 2, 3]) {
        const r = await runner.executeBotMove(h, state(turn), 2500);
        assert.ok(r.move, r.error);
        assert.match(r.log, new RegExp(`turn ${turn} seen 1`));
        const want = state(turn).legalMoves[turn % state(turn).legalMoves.length];
        assert.deepStrictEqual(r.move, { from: want.from, to: want.to });
    }
    assert.strictEqual(warmOf(h), 1);
    runner.cleanupBot(h);
});

test('a move that runs out of time kills its process; the next move gets a fresh one', async () => {
    const h = await prep('javascript', `function getNextMove(s) { if (s.turnNumber === 2) for (;;) {} return s.legalMoves[0]; }`);
    assert.ok((await runner.executeBotMove(h, state(1), 2500)).move);
    const slow = await runner.executeBotMove(h, state(2), 600);
    assert.strictEqual(slow.move, null);
    assert.match(slow.error, /Quá thời gian/);
    const started = stats().started;
    const next = await runner.executeBotMove(h, state(3), 2500);
    assert.ok(next.move, next.error);
    assert.strictEqual(stats().started - started, 1, 'a new process answered');
    assert.strictEqual(warmOf(h), 1, 'the stuck process is gone, only the new one is left');
    runner.cleanupBot(h);
});

test('a bot that crashes on one move only loses that move', async (t) => {
    const cases = [['javascript', `function getNextMove(s) { if (s.turnNumber === 2) process.exit(3); if (s.turnNumber === 3) throw new Error('boom'); return s.legalMoves[0]; }`]];
    if (hasPy()) cases.push(['python', `import sys, json, os
s = json.loads(sys.stdin.read())
if s['turnNumber'] == 2: os._exit(3)
if s['turnNumber'] == 3: raise RuntimeError('boom')
m = s['legalMoves'][0]
print(json.dumps({'from': m['from'], 'to': m['to']}))`]);
    for (const [lang, code] of cases) {
        const h = await prep(lang, code);
        assert.ok((await runner.executeBotMove(h, state(1), 2500)).move, lang);
        const died = await runner.executeBotMove(h, state(2), 2500);
        assert.strictEqual(died.move, null, `${lang}: exiting is not a move`);
        const threw = await runner.executeBotMove(h, state(3), 2500);
        assert.strictEqual(threw.move, null);
        assert.match(threw.log, /boom/, `${lang}: the error is in the log`);
        const ok = await runner.executeBotMove(h, state(4), 2500);
        assert.ok(ok.move, `${lang}: ${ok.error}`);
        runner.cleanupBot(h);
    }
});

test('a warm process that disappears between moves (CPU budget, OOM killer…) is replaced silently', async () => {
    const h = await prep('javascript', 'function getNextMove(s) { return s.legalMoves[0]; }');
    assert.ok((await runner.executeBotMove(h, state(), 2500)).move);
    process.kill([...h.warmIdle][0].child.pid, 'SIGKILL');
    await new Promise(r => setTimeout(r, 100));
    const r = await runner.executeBotMove(h, state(), 2500);
    assert.ok(r.move, `the move is not lost: ${r.error}`);
    runner.cleanupBot(h);
});

test('moves of one bot in several games at once each get their own process', async () => {
    const h = await prep('javascript', 'function getNextMove(s) { const t = Date.now() + 150; while (Date.now() < t) {} return s.legalMoves[0]; }');
    const rs = await Promise.all([1, 2, 3].map(() => runner.executeBotMove(h, state(), 2500)));
    rs.forEach(r => assert.ok(r.move, r.error));
    assert.ok(warmOf(h) >= 2, 'parallel moves did not queue behind one process');
    runner.cleanupBot(h);
});

test('WARM_BOTS=0 and a full memory budget fall back to one process per move', () => {
    const script = `
const runner = require(${JSON.stringify(path.join(__dirname, '..', 'runner'))});
const E = require(${JSON.stringify(path.join(__dirname, '..', 'engine'))});
(async () => {
    await runner.detectToolchains();
    const board = E.createInitialBoard();
    const st = { board, myPlayer: 1, legalMoves: E.getLegalMoves(1, board), myGoal: { r: 0, c: 8 }, moveHistory: [] };
    const p = await runner.prepareBot('warm_env_' + process.pid, 'javascript', 'function getNextMove(s) { return s.legalMoves[0]; }');
    for (let i = 0; i < 3; i++) if (!(await runner.executeBotMove(p.botHandler, st, 2500)).move) throw new Error('no move');
    runner.cleanupBot(p.botHandler);
    console.log(JSON.stringify(runner.getStats().warm));
})();`;
    for (const env of [{ WARM_BOTS: '0' }, { WARM_BOTS_MEM_MB: '10' }]) {
        const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, ...env } }).toString().trim().split('\n').pop());
        assert.deepStrictEqual([out.started, out.reused, out.oneOff], [0, 0, 3], JSON.stringify(env));
    }
});

test('idle warm processes do not keep the server process alive', () => {
    // a script that leaves a warm bot behind (no cleanupBot) must still exit on its own
    const script = `
const runner = require(${JSON.stringify(path.join(__dirname, '..', 'runner'))});
const E = require(${JSON.stringify(path.join(__dirname, '..', 'engine'))});
(async () => {
    await runner.detectToolchains();
    const board = E.createInitialBoard();
    const p = await runner.prepareBot('warm_exit_' + process.pid, 'javascript', 'function getNextMove(s) { return s.legalMoves[0]; }');
    const r = await runner.executeBotMove(p.botHandler, { board, myPlayer: 1, legalMoves: E.getLegalMoves(1, board), myGoal: { r: 0, c: 8 }, moveHistory: [] }, 2500);
    console.log(r.move ? 'moved' : r.error, runner.getStats().warm.idle);
})();`;
    const out = execFileSync(process.execPath, ['-e', script], { timeout: 10000 }).toString();
    assert.match(out, /moved 1/);
    runner.cleanupTempDir();          // the script above left its bot file behind on purpose
});
