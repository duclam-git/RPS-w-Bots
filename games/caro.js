// ===== OTTv2 Code Arena - game "Cờ Caro" (Gomoku, freestyle) =====
// Two players alternately place a stone on an empty cell; Blue (player 1) starts.
// First to get `winLength` (default 5) or more in a row - horizontal, vertical or diagonal - wins.
// A full board is a draw.  Board 3..19, win length 3..6 (3x3 with 3 is plain tic-tac-toe).
//
// Self-contained on purpose (no require): this very file is mounted into the bot sandbox so that
// JavaScript bots can use it through `helpers`.

'use strict';

const DEFAULT_RULES = Object.freeze({
    size: 15, rows: 15, cols: 15, winLength: 5,
    maxPlies: 225, moveTimeoutMs: 2500, timeBankMs: 0
});

function resolveRules(o) {
    o = o || {};
    const n = o.size || o.rows || DEFAULT_RULES.rows;
    return {
        size: n, rows: n, cols: n,
        winLength: o.winLength || DEFAULT_RULES.winLength,
        maxPlies: o.maxPlies || n * n,
        moveTimeoutMs: o.moveTimeoutMs || DEFAULT_RULES.moveTimeoutMs,
        timeBankMs: o.timeBankMs || 0
    };
}

/** Validated overrides only (same contract as the RPS engine): { ok, errors, rules } */
function validateRules(raw) {
    const errors = [];
    const out = {};
    const o = raw && typeof raw === 'object' ? raw : {};
    const intIn = (key, min, max, label, allowZero) => {
        if (o[key] === undefined || o[key] === null || o[key] === '') return undefined;
        const v = Number(o[key]);
        if (!Number.isInteger(v) || (!(allowZero && v === 0) && (v < min || v > max))) {
            errors.push(`${label} phải là số nguyên từ ${min} đến ${max}${allowZero ? ' (hoặc 0 = không giới hạn)' : ''}`);
            return undefined;
        }
        out[key] = v;
        return v;
    };
    const size = intIn('size', 3, 19, 'Cỡ bàn cờ') || DEFAULT_RULES.size;
    const win = intIn('winLength', 3, 6, 'Số quân liên tiếp để thắng') || DEFAULT_RULES.winLength;
    if (win > size) errors.push('Số quân liên tiếp để thắng không được lớn hơn cỡ bàn');
    intIn('maxPlies', 5, size * size, 'Giới hạn số nước đi');
    intIn('moveTimeoutMs', 100, 10000, 'Thời gian tối đa mỗi nước (ms)');
    intIn('timeBankMs', 1000, 3600000, 'Tổng thời gian suy nghĩ mỗi bên (ms)', true);
    return { ok: errors.length === 0, errors, rules: out };
}

const toNotation = (r, c, rules = DEFAULT_RULES) => `${String.fromCharCode(65 + c)}${rules.rows - r}`;
function fromNotation(str, rules = DEFAULT_RULES) {
    return { r: rules.rows - parseInt(String(str).slice(1), 10), c: String(str).charCodeAt(0) - 65 };
}

const createInitialBoard = (rules = DEFAULT_RULES) => Array.from({ length: rules.rows }, () => Array(rules.cols).fill(null));
const cloneBoard = (board) => board.map(row => row.map(x => (x ? { player: x.player, type: x.type } : null)));

function getLegalMoves(player, board, rules = DEFAULT_RULES) {
    const moves = [];
    for (let r = 0; r < rules.rows; r++) {
        for (let c = 0; c < rules.cols; c++) {
            if (!board[r][c]) moves.push({ to: { r, c }, pieceType: 'stone', capture: null, notation: toNotation(r, c, rules) });
        }
    }
    return moves;
}

function applyMove(board, move, player) { board[move.to.r][move.to.c] = { player, type: 'stone' }; }
function simulateMove(board, move, player) { const b = cloneBoard(board); applyMove(b, move, player); return b; }

/** { winner: 1 | 2 | 'draw' | null, reason, line? } */
function checkWin(board, rules = DEFAULT_RULES) {
    const { rows, cols, winLength } = rules;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    let empty = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = board[r][c];
            if (!cell) { empty++; continue; }
            for (const [dr, dc] of dirs) {
                const pr = r - dr, pc = c - dc;      // only count from the START of a run
                if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && board[pr][pc] && board[pr][pc].player === cell.player) continue;
                let n = 0;
                while (r + n * dr >= 0 && r + n * dr < rows && c + n * dc >= 0 && c + n * dc < cols &&
                    board[r + n * dr][c + n * dc] && board[r + n * dr][c + n * dc].player === cell.player) n++;
                if (n >= winLength) {
                    const who = cell.player === 1 ? 'Xanh' : 'Đỏ';
                    return { winner: cell.player, reason: `Đội ${who} có ${n} quân liên tiếp!`, line: { r, c, dr, dc, n } };
                }
            }
        }
    }
    if (empty === 0) return { winner: 'draw', reason: 'Bàn cờ đã kín — Hòa!' };
    return { winner: null, reason: '' };
}

/** Re-plays a recorded game and validates every move. moves: [{player, to:{r,c}}] */
function replayAndValidate(moves, rules = DEFAULT_RULES) {
    const board = createInitialBoard(rules);
    const enriched = [];
    let expected = 1;
    for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        if (!m || !m.to || !Number.isInteger(m.to.r) || !Number.isInteger(m.to.c)) return { ok: false, error: `Nước #${i + 1} thiếu tọa độ` };
        if (m.player !== expected) return { ok: false, error: `Nước #${i + 1} sai lượt` };
        if (m.to.r < 0 || m.to.r >= rules.rows || m.to.c < 0 || m.to.c >= rules.cols || board[m.to.r][m.to.c]) {
            return { ok: false, error: `Nước #${i + 1} không hợp lệ` };
        }
        applyMove(board, m, expected);
        enriched.push({ ply: i + 1, player: expected, from: null, to: { r: m.to.r, c: m.to.c }, pieceType: 'stone', capture: null, notation: toNotation(m.to.r, m.to.c, rules) });
        const res = checkWin(board, rules);
        if (res.winner !== null) {
            if (i !== moves.length - 1) return { ok: false, error: 'Còn nước đi sau khi trận đã kết thúc' };
            return { ok: true, winner: res.winner, reason: res.reason, plies: moves.length, board, moves: enriched };
        }
        expected = expected === 1 ? 2 : 1;
    }
    if (moves.length >= rules.maxPlies) return { ok: true, winner: 'draw', reason: `Hòa do hết ${rules.maxPlies} nước đi`, plies: moves.length, board, moves: enriched };
    return { ok: false, error: 'Trận đấu chưa kết thúc' };
}

module.exports = {
    DEFAULT_RULES, resolveRules, validateRules, toNotation, fromNotation,
    createInitialBoard, cloneBoard, getLegalMoves, applyMove, simulateMove, checkWin, replayAndValidate
};
