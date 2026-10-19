'use strict';
const test = require('node:test');
const assert = require('node:assert');
const runner = require('../runner');
const E = require('../engine');

const state = () => {
    const board = E.createInitialBoard();
    const legalMoves = E.getLegalMoves(1, board);
    return { board, myPlayer: 1, legalMoves, myGoal: { r: 0, c: 8 }, moveHistory: [] };
};
const run = async (lang, code, timeout = 2500) => {
    const prep = await runner.prepareBot(`rt_${lang}_${Math.random().toString(36).slice(2, 8)}`, lang, code);
    if (!prep.success) return { prep };
    const res = await runner.executeBotMove(prep.botHandler, state(), timeout);
    runner.cleanupBot(prep.botHandler);
    return { prep, res };
};

test.before(() => runner.detectToolchains());

test('bots cannot read the server secrets from the environment', async () => {
    process.env.ADMIN_KEY = 'super-secret';
    const { res } = await run('javascript', `function getNextMove(s, h, log) { log('KEY=' + process.env.ADMIN_KEY); return s.legalMoves[0]; }`);
    assert.ok(res.move);
    assert.match(res.log, /KEY=undefined/);
});

test('python bots can log non-ASCII text (UTF-8 forced)', async (t) => {
    if (!runner.getToolchains().python.ok) return t.skip('python not installed');
    const code = `import sys, json\ns = json.loads(sys.stdin.read())\nprint('Xin chào, nước đi đẹp ✓', file=sys.stderr)\nm = s['legalMoves'][0]\nprint(json.dumps({'from': m['from'], 'to': m['to']}))`;
    const { res } = await run('python', code);
    assert.ok(res.move, res.error);
    assert.match(res.log, /nước đi đẹp/);
});

test('a bot that floods stdout is stopped', async () => {
    const { res } = await run('javascript', `function getNextMove(s, h, log) { for (;;) process.stdout.write('x'.repeat(65536)); }`, 5000);
    // stopped one way or another (output cap, time limit or the sandbox's memory limit) - never a move, never a hang
    assert.strictEqual(res.move, null);
    assert.ok(res.error, 'reports why it failed');
});

test('c++ compile errors are readable and do not leak server paths', async (t) => {
    if (!runner.getToolchains().cpp.ok) return t.skip('g++ not installed');
    const { prep } = await run('cpp', 'int main() { this is not c++ }');
    assert.strictEqual(prep.success, false);
    assert.match(prep.error, /Lỗi biên dịch C\+\+/);
    assert.ok(!prep.error.includes('temp_bots'), prep.error);
});

test('starter templates (all languages, both sides) compile and answer with a legal move', async (t) => {
    global.window = {};
    delete require.cache[require.resolve('../bot_templates.js')];
    require('../bot_templates.js');
    const tpl = global.window.MULTI_LANG_TEMPLATES;
    for (const lang of ['javascript', 'python', 'cpp']) {
        if (lang !== 'javascript' && !runner.getToolchains()[lang].ok) continue;
        for (const side of ['blue', 'red']) {
            const { prep, res } = await run(lang, tpl[lang][side], 3000);
            assert.ok(prep.success, `${lang}/${side}: ${prep.error}`);
            const board = E.createInitialBoard();
            const player = side === 'blue' ? 1 : 2;
            const legal = E.getLegalMoves(player, board);
            // the red template is evaluated as player 2
            const prep2 = await runner.prepareBot(`rt_tpl_${lang}_${side}`, lang, tpl[lang][side]);
            const st = { board, myPlayer: player, legalMoves: legal,
                myGoal: player === 1 ? { r: 0, c: 8 } : { r: 8, c: 0 }, moveHistory: [{ turn: 1, player: 2, from: { r: 0, c: 0 }, to: { r: 0, c: 1 } }] };
            const out = await runner.executeBotMove(prep2.botHandler, st, 3000);
            runner.cleanupBot(prep2.botHandler);
            assert.ok(out.move, `${lang}/${side}: ${out.error}`);
            assert.ok(legal.some(m => m.from.r === out.move.from.r && m.from.c === out.move.from.c && m.to.r === out.move.to.r && m.to.c === out.move.to.c),
                `${lang}/${side} returned an illegal move (moveHistory must not be mistaken for legalMoves)`);
        }
    }
});
