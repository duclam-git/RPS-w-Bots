// ===== OTTv2 Code Arena - game registry =====
// A "game" is a rules engine plus the few adapter functions the server needs to run bots against it.
// Adding a game = one engine file + one entry here (+ bot starter templates and, if the look differs, a
// renderer in arena.js).  Contract every engine honours:
//   DEFAULT_RULES, resolveRules(overrides) -> full rules, validateRules(raw) -> {ok, errors, rules}
//   createInitialBoard(rules)  getLegalMoves(player, board, rules)  applyMove(board, move, player, rules)
//   checkWin(board, rules) -> {winner: 1|2|'draw'|null, reason}   replayAndValidate(moves, rules)
// Adapter (defined below): botState(ctx), matchMove(legalMoves, botMove), enginePath (mounted in the sandbox).

'use strict';

const path = require('path');
const rpsEngine = require('../engine');
const caroEngine = require('./caro');

const sameCell = (a, b) => !!a && !!b && a.r === b.r && a.c === b.c;

const rps = {
    ...rpsEngine,
    id: 'rps',
    name: 'Oẳn tù tì — Đấu trường quân cờ',
    short: 'RPS',
    description: 'Mỗi bên 10 quân Đá/Giấy/Kéo trên bàn 9×9; đi 1 ô theo 8 hướng, quân khắc chế thì bắt được quân kia. Thắng khi chạm ô đích phía đối diện hoặc bắt hết quân.',
    enginePath: path.join(__dirname, '..', 'engine.js'),
    movesHaveFrom: true,
    botHint: 'getNextMove(state, helpers, log) trả về { from: {r,c}, to: {r,c} } — một phần tử của state.legalMoves.',
    // applyMove(board, move) of the RPS engine ignores the extra arguments
    botState({ board, player, legalMoves, rules, moves }) {
        const opp = player === 1 ? 2 : 1;
        return {
            board, myPlayer: player, opponentPlayer: opp,
            myGoal: player === 1 ? rules.blueGoal : rules.redGoal,
            opponentGoal: player === 1 ? rules.redGoal : rules.blueGoal,
            legalMoves,
            myCounts: rpsEngine.countPieces(player, board),
            opponentCounts: rpsEngine.countPieces(opp, board),
            turnNumber: Math.ceil((moves.length + 1) / 2),
            moveHistory: moves,
            rules: { rows: rules.rows, cols: rules.cols, beats: rules.beats, blueGoal: rules.blueGoal, redGoal: rules.redGoal, maxPlies: rules.maxPlies, moveTimeoutMs: rules.moveTimeoutMs, timeBankMs: rules.timeBankMs || 0 }
        };
    },
    matchMove: (legal, bot) => legal.find(m => sameCell(m.from, bot && bot.from) && sameCell(m.to, bot && bot.to)) || null
};

const caro = {
    ...caroEngine,
    id: 'caro',
    name: 'Cờ Caro (Gomoku)',
    short: 'Caro',
    description: 'Hai bên lần lượt đặt quân lên ô trống; ai có đủ N quân liên tiếp (mặc định 5) theo hàng, cột hoặc đường chéo trước thì thắng. Xanh đi trước. Bàn 3–19, N = 3–6 (3×3 với N=3 là cờ ca-rô 3 ô).',
    enginePath: path.join(__dirname, 'caro.js'),
    movesHaveFrom: false,
    botHint: 'getNextMove(state, helpers, log) trả về { to: {r,c} } — một ô trống trong state.legalMoves. state.grid là mảng chuỗi (0 trống, 1 Xanh, 2 Đỏ).',
    // `grid` = one string per row ('0' empty, '1' blue, '2' red): trivial to parse in C++ / Python / JS
    botState({ board, player, legalMoves, rules, moves }) {
        return {
            board, myPlayer: player, opponentPlayer: player === 1 ? 2 : 1,
            grid: board.map(row => row.map(x => (x ? String(x.player) : '0')).join('')),
            legalMoves: legalMoves.map(m => ({ to: m.to })),
            turnNumber: Math.ceil((moves.length + 1) / 2),
            winLength: rules.winLength,
            moveHistory: moves,
            rules: { rows: rules.rows, cols: rules.cols, winLength: rules.winLength, maxPlies: rules.maxPlies, moveTimeoutMs: rules.moveTimeoutMs, timeBankMs: rules.timeBankMs || 0 }
        };
    },
    matchMove: (legal, bot) => legal.find(m => sameCell(m.to, bot && bot.to)) || null
};

const games = new Map([[rps.id, rps], [caro.id, caro]]);

module.exports = {
    DEFAULT_GAME: 'rps',
    get: (id) => games.get(id) || null,
    has: (id) => games.has(id),
    list: () => [...games.values()].map(g => ({
        id: g.id, name: g.name, short: g.short, description: g.description, botHint: g.botHint,
        defaultRules: g.id === 'caro' ? g.resolveRules({}) : g.DEFAULT_RULES
    }))
};
