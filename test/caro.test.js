'use strict';
// Second game (Cờ Caro / Gomoku) through the generic game layer + DB migration from v2.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const games = require('../games');
const runner = require('../runner');
const sandbox = require('../sandbox');
const mp = require('../matchplay');

const caro = games.get('caro');
global.window = {};
require('../bot_templates.js');
const TPL = global.window.GAME_TEMPLATES;
const hasPy = !!sandbox.which('python3');
const hasGpp = !!sandbox.which('g++');
test.before(() => runner.detectToolchains());

const place = (board, cells, player) => cells.forEach(([r, c]) => caro.applyMove(board, { to: { r, c } }, player));

test('caro engine: five in any direction wins, gaps and short lines do not, full board draws', () => {
    const rules = caro.resolveRules({});
    assert.deepStrictEqual([rules.rows, rules.winLength, rules.maxPlies], [15, 5, 225]);
    for (const [name, cells] of [
        ['row', [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]]], ['col', [[2, 9], [3, 9], [4, 9], [5, 9], [6, 9]]],
        ['diag', [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]], ['anti', [[1, 9], [2, 8], [3, 7], [4, 6], [5, 5]]]]) {
        const b = caro.createInitialBoard(rules); place(b, cells, 2);
        assert.strictEqual(caro.checkWin(b, rules).winner, 2, name);
    }
    const b = caro.createInitialBoard(rules);
    place(b, [[0, 0], [0, 1], [0, 2], [0, 4], [0, 5]], 1);                    // gap
    assert.strictEqual(caro.checkWin(b, rules).winner, null);
    place(b, [[0, 3]], 1);                                                    // fills the gap -> 6 in a row (freestyle: 5 or more)
    assert.strictEqual(caro.checkWin(b, rules).winner, 1);

    // tic-tac-toe is the same engine: 3x3, 3 in a row; a full board with no line is a draw
    const ttt = caro.resolveRules({ size: 3, winLength: 3 });
    const d = caro.createInitialBoard(ttt);
    const pattern = [[1, 2, 1], [1, 2, 2], [2, 1, 1]];
    pattern.forEach((row, r) => row.forEach((p, c) => caro.applyMove(d, { to: { r, c } }, p)));
    assert.deepStrictEqual(caro.checkWin(d, ttt).winner, 'draw');
});

test('caro rules validation and replay validation', () => {
    assert.ok(caro.validateRules({}).ok);
    assert.ok(caro.validateRules({ size: 3, winLength: 3 }).ok);
    assert.ok(!caro.validateRules({ size: 20 }).ok);
    assert.ok(!caro.validateRules({ size: 5, winLength: 6 }).ok, 'cannot need more stones than the board is wide');
    assert.ok(!caro.validateRules({ winLength: 2 }).ok);
    assert.ok(!caro.validateRules({ maxPlies: 1 }).ok);

    const rules = caro.resolveRules({ size: 5, winLength: 3 });
    const good = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]].map(([r, c], i) => ({ player: i % 2 ? 2 : 1, to: { r, c } }));
    const ok = caro.replayAndValidate(good, rules);
    assert.ok(ok.ok, ok.error);
    assert.strictEqual(ok.winner, 1);
    assert.strictEqual(ok.moves[0].from, null);
    assert.ok(!caro.replayAndValidate([{ player: 2, to: { r: 0, c: 0 } }], rules).ok, 'wrong turn');
    assert.ok(!caro.replayAndValidate([{ player: 1, to: { r: 0, c: 0 } }, { player: 2, to: { r: 0, c: 0 } }], rules).ok, 'occupied cell');
    assert.ok(!caro.replayAndValidate([{ player: 1, to: { r: 9, c: 0 } }], rules).ok, 'off board');
    assert.ok(!caro.replayAndValidate(good.concat([{ player: 2, to: { r: 4, c: 4 } }]), rules).ok, 'moves after the game ended');
});

test('every starter bot of every language answers a caro position with a legal move', async () => {
    const rules = caro.resolveRules({ size: 9, winLength: 5 });
    for (const lang of ['javascript', 'python', 'cpp']) {
        if ((lang === 'python' && !hasPy) || (lang === 'cpp' && !hasGpp)) continue;
        const p = await runner.prepareBot(`caro_${lang}`, lang, TPL.caro[lang].blue, { game: caro });
        assert.ok(p.success, `${lang}: ${p.error}`);
        const smoke = await mp.smokeTest(p.botHandler, rules, caro);
        assert.ok(smoke.ok, `${lang}: ${smoke.errors}`);
        runner.cleanupBot(p.botHandler);
    }
});

test('bots of all languages play caro against each other without a single fallback (every sandbox tier)', async () => {
    const rules = caro.resolveRules({ size: 9, winLength: 5 });
    for (const mode of ['builtin', 'auto']) {
        sandbox.configure({ mode, strict: false });
        await sandbox.detect({ pythonCmd: 'python3' });
        const bots = [];
        for (const lang of ['javascript', 'python', 'cpp']) {
            if ((lang === 'python' && !hasPy) || (lang === 'cpp' && !hasGpp)) continue;
            const p = await runner.prepareBot(`cg_${lang}_${mode}`, lang, TPL.caro[lang].blue, { game: caro });
            assert.ok(p.success, p.error);
            bots.push({ name: lang, lang, handler: p.botHandler });
        }
        for (let i = 0; i < bots.length; i++) {
            const res = await mp.playMatch({ game: caro, rules, blue: bots[i], red: bots[(i + 1) % bots.length] });
            assert.deepStrictEqual(res.fallbacks, { blue: 0, red: 0 }, `${mode}: ${bots[i].name} v ${bots[(i + 1) % bots.length].name}`);
            assert.ok([1, 2, 'draw'].includes(res.winner));
            assert.ok(res.moves.every(m => m.from === null && m.pieceType === 'stone'));
            // the stored record replays to the same result
            const check = caro.replayAndValidate(res.moves.map(m => ({ player: m.player, to: m.to })), rules);
            assert.ok(check.ok, check.error);
            assert.strictEqual(check.winner, res.winner);
        }
        bots.forEach(b => runner.cleanupBot(b.handler));
    }
    sandbox.configure({ mode: 'auto', strict: false });
    await sandbox.detect({ pythonCmd: 'python3' });
});

test('the starter bot is actually good: it beats a random player almost always (both colours)', async () => {
    const rules = caro.resolveRules({ size: 9, winLength: 5 });
    const rnd = await runner.prepareBot('caro_rnd', 'javascript', 'function getNextMove(s, h) { return h.randomChoice(s.legalMoves); }', { game: caro });
    const bot = await runner.prepareBot('caro_good', 'javascript', TPL.caro.javascript.blue, { game: caro });
    let wins = 0, games_ = 0;
    for (let i = 0; i < 6; i++) {
        const botBlue = i % 2 === 0;
        const res = await mp.playMatch({
            game: caro, rules,
            blue: botBlue ? { name: 'bot', handler: bot.botHandler } : { name: 'rnd', handler: rnd.botHandler },
            red: botBlue ? { name: 'rnd', handler: rnd.botHandler } : { name: 'bot', handler: bot.botHandler }
        });
        games_++;
        if (res.winner === (botBlue ? 1 : 2)) wins++;
    }
    runner.cleanupBot(rnd.botHandler); runner.cleanupBot(bot.botHandler);
    assert.ok(wins >= 5, `bot won ${wins}/${games_}`);
});

test('JS helpers come from the game engine and receive the game rules (getLegalMoves / simulateMove / checkWin / toNotation)', async () => {
    const code = `function getNextMove(s, h, log) {
  const legal = h.getLegalMoves(s.myPlayer, s.board);
  const sim = h.simulateMove(s.board, legal[0], s.myPlayer);
  log('legal=' + legal.length + ' placed=' + (sim[legal[0].to.r][legal[0].to.c].player) + ' win=' + h.checkWin(sim).winner + ' note=' + h.toNotation(0, 0) + ' canCapture=' + typeof h.canCapture);
  return legal[0];
}`;
    const rules = caro.resolveRules({ size: 7, winLength: 4 });
    const p = await runner.prepareBot('caro_helpers', 'javascript', code, { game: caro });
    const board = caro.createInitialBoard(rules);
    const legalMoves = caro.getLegalMoves(1, board, rules);
    const res = await runner.executeBotMove(p.botHandler, caro.botState({ board, player: 1, legalMoves, rules, moves: [] }), 3000);
    runner.cleanupBot(p.botHandler);
    assert.ok(res.move, res.error);
    assert.match(res.log, /legal=49 placed=1 win=null note=A7 canCapture=undefined/);
});

test('DB upgrade v2 -> v3 keeps every existing match and move, and new games can store placement moves', () => {
    const Database = require('better-sqlite3');
    const file = path.join(os.tmpdir(), `ott-mig-${process.pid}.db`);
    for (const f of [file, file + '-wal', file + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
    const { MIGRATIONS } = require('../db');
    // build a genuine v2 database by hand and fill it like the previous release would have
    const old = new Database(file);
    old.pragma('foreign_keys = ON');
    MIGRATIONS.slice(0, 2).forEach(sql => old.exec(sql));
    old.pragma('user_version = 2');
    old.prepare(`INSERT INTO matches (kind, blue_name, red_name, winner, reason, plies, rules_json, created_at) VALUES ('online','Old A','Old B','blue','r',2,'{}',1)`).run();
    old.prepare(`INSERT INTO match_moves (match_id, ply, player, from_r, from_c, to_r, to_c, piece, capture, fallback, log) VALUES (1,1,1,4,1,3,2,'paper',NULL,0,'x'),(1,2,2,4,7,5,6,'rock','scissors',1,'y')`).run();
    old.prepare(`INSERT INTO tournaments (name, format, config_json, created_at) VALUES ('Old cup','single_elim','{}',1)`).run();
    old.close();

    const script = `
      process.env.DB_PATH = ${JSON.stringify(file)};
      const d = require(${JSON.stringify(path.join(__dirname, '..', 'db.js'))});
      const out = {
        version: d.db.pragma('user_version', { simple: true }),
        moves: d.getMatch(1).moves.map(m => [m.ply, m.player, m.from && [m.from.r, m.from.c], [m.to.r, m.to.c], m.capture, m.fallback, m.log]),
        game: d.getMatch(1).game,
        tgame: d.db.prepare('SELECT game FROM tournaments').get().game,
      };
      const id = d.saveMatch({ game: 'caro', kind: 'tournament', blue: { name: 'X' }, red: { name: 'Y' }, winner: 1, reason: 'five', rules: { rows: 9 } },
        [{ ply: 1, player: 1, from: null, to: { r: 4, c: 4 }, pieceType: 'stone' }]);
      out.caro = d.getMatch(id).moves[0].from === null && d.getMatch(id).game === 'caro';
      out.listed = d.listMatches({ game: 'caro' }).total + '/' + d.listMatches({}).total;
      out.fk = d.db.pragma('foreign_key_check').length;
      console.log(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.version, 3);
    assert.deepStrictEqual(out.moves, [[1, 1, [4, 1], [3, 2], null, false, 'x'], [2, 2, [4, 7], [5, 6], 'scissors', true, 'y']]);
    assert.strictEqual(out.game, 'rps');
    assert.strictEqual(out.tgame, 'rps');
    assert.strictEqual(out.caro, true);
    assert.strictEqual(out.listed, '1/2');
    assert.strictEqual(out.fk, 0);
    for (const f of [file, file + '-wal', file + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
});
