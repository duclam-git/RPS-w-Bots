// ===== OTTv2 Code Arena - Headless Game Engine =====
// Pure rules logic (no I/O). Shared by:
//   - online rooms        (server.js)
//   - tournament matches  (tournament.js / matchplay.js)
//   - validation of matches uploaded by the browser (api.js)
//   - JS bot sandbox helpers (runner.js)
//
// Everything is driven by a `rules` object so the admin UI (issue #4) can later
// override setup / limits per tournament without touching this file.

'use strict';

const DEFAULT_RULES = Object.freeze({
    rows: 9,
    cols: 9,
    blueGoal: { r: 0, c: 8 },   // I9
    redGoal: { r: 8, c: 0 },    // A1
    beats: { rock: ['scissors'], paper: ['rock'], scissors: ['paper'] },
    maxPlies: 200,              // draw after this many half-moves
    moveTimeoutMs: 2500,        // per-move time limit for bots
    setup: {
        p1: [
            { r: 4, c: 1, t: 'paper' }, { r: 4, c: 2, t: 'scissors' },
            { r: 5, c: 1, t: 'rock' }, { r: 5, c: 2, t: 'paper' }, { r: 5, c: 3, t: 'scissors' },
            { r: 6, c: 2, t: 'rock' }, { r: 6, c: 3, t: 'paper' }, { r: 6, c: 4, t: 'scissors' },
            { r: 7, c: 3, t: 'rock' }, { r: 7, c: 4, t: 'paper' }
        ],
        p2: [
            { r: 4, c: 6, t: 'scissors' }, { r: 4, c: 7, t: 'paper' },
            { r: 3, c: 5, t: 'scissors' }, { r: 3, c: 6, t: 'paper' }, { r: 3, c: 7, t: 'rock' },
            { r: 2, c: 4, t: 'scissors' }, { r: 2, c: 5, t: 'paper' }, { r: 2, c: 6, t: 'rock' },
            { r: 1, c: 4, t: 'paper' }, { r: 1, c: 5, t: 'rock' }
        ]
    }
});

/** Merge user overrides on top of the defaults (shallow for scalars, replace for objects). */
function resolveRules(overrides) {
    const o = overrides || {};
    return {
        rows: o.rows || DEFAULT_RULES.rows,
        cols: o.cols || DEFAULT_RULES.cols,
        blueGoal: o.blueGoal || DEFAULT_RULES.blueGoal,
        redGoal: o.redGoal || DEFAULT_RULES.redGoal,
        beats: o.beats || DEFAULT_RULES.beats,
        maxPlies: o.maxPlies || DEFAULT_RULES.maxPlies,
        moveTimeoutMs: o.moveTimeoutMs || DEFAULT_RULES.moveTimeoutMs,
        timeBankMs: o.timeBankMs || 0,          // total thinking time per side for the whole game (0 = unlimited)
        setup: o.setup || DEFAULT_RULES.setup
    };
}

function canCapture(attacker, defender, rules = DEFAULT_RULES) {
    const list = rules.beats[attacker];
    return !!list && list.includes(defender);
}

function toNotation(r, c, rules = DEFAULT_RULES) {
    return `${String.fromCharCode(65 + c)}${rules.rows - r}`;
}

function fromNotation(str, rules = DEFAULT_RULES) {
    const c = str.charCodeAt(0) - 65;
    const r = rules.rows - parseInt(str.slice(1), 10);
    return { r, c };
}

function createInitialBoard(rules = DEFAULT_RULES) {
    const b = Array.from({ length: rules.rows }, () => Array(rules.cols).fill(null));
    rules.setup.p1.forEach(p => { b[p.r][p.c] = { player: 1, type: p.t }; });
    rules.setup.p2.forEach(p => { b[p.r][p.c] = { player: 2, type: p.t }; });
    return b;
}

function cloneBoard(board) {
    return board.map(row => row.map(cell => (cell ? { player: cell.player, type: cell.type } : null)));
}

function getLegalMoves(player, board, rules = DEFAULT_RULES) {
    const moves = [];
    for (let r = 0; r < rules.rows; r++) {
        for (let c = 0; c < rules.cols; c++) {
            const p = board[r][c];
            if (!p || p.player !== player) continue;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= rules.rows || nc < 0 || nc >= rules.cols) continue;
                    const target = board[nr][nc];
                    const ok = !target || (target.player !== player && canCapture(p.type, target.type, rules));
                    if (!ok) continue;
                    moves.push({
                        from: { r, c },
                        to: { r: nr, c: nc },
                        pieceType: p.type,
                        capture: target ? target.type : null,
                        notation: `${toNotation(r, c, rules)} → ${toNotation(nr, nc, rules)}`
                    });
                }
            }
        }
    }
    return moves;
}

/** Returns a new board with `move` applied (does not mutate). */
function simulateMove(board, move) {
    const nb = cloneBoard(board);
    nb[move.to.r][move.to.c] = nb[move.from.r][move.from.c];
    nb[move.from.r][move.from.c] = null;
    return nb;
}

/** Applies `move` in place. */
function applyMove(board, move) {
    board[move.to.r][move.to.c] = board[move.from.r][move.from.c];
    board[move.from.r][move.from.c] = null;
}

function countPieces(player, board) {
    const counts = { rock: 0, paper: 0, scissors: 0, total: 0 };
    for (const row of board) {
        for (const p of row) {
            if (p && p.player === player) {
                if (counts[p.type] !== undefined) counts[p.type]++;
                counts.total++;
            }
        }
    }
    return counts;
}

function getPieces(player, board) {
    const out = [];
    board.forEach((row, r) => row.forEach((p, c) => {
        if (p && p.player === player) out.push({ r, c, type: p.type });
    }));
    return out;
}

/**
 * Evaluates the position. winner: 1 | 2 | 'draw' | null (game continues).
 */
function checkWin(board, rules = DEFAULT_RULES) {
    const { blueGoal, redGoal } = rules;
    const atBlue = board[blueGoal.r][blueGoal.c];
    if (atBlue && atBlue.player === 1) {
        return { winner: 1, reason: `Đội Xanh đã chiếm ô đích ${toNotation(blueGoal.r, blueGoal.c, rules)}!` };
    }
    const atRed = board[redGoal.r][redGoal.c];
    if (atRed && atRed.player === 2) {
        return { winner: 2, reason: `Đội Đỏ đã chiếm ô đích ${toNotation(redGoal.r, redGoal.c, rules)}!` };
    }

    const c1 = countPieces(1, board).total;
    const c2 = countPieces(2, board).total;
    if (c1 === 0) return { winner: 2, reason: 'Đội Xanh đã bị bắt hết toàn bộ quân!' };
    if (c2 === 0) return { winner: 1, reason: 'Đội Đỏ đã bị bắt hết toàn bộ quân!' };

    const m1 = getLegalMoves(1, board, rules).length;
    const m2 = getLegalMoves(2, board, rules).length;
    if (m1 === 0 && m2 === 0) return { winner: 'draw', reason: 'Cả hai đội đều hết nước đi (Hòa)!' };
    if (m1 === 0) return { winner: 2, reason: 'Đội Xanh không còn nước đi hợp lệ!' };
    if (m2 === 0) return { winner: 1, reason: 'Đội Đỏ không còn nước đi hợp lệ!' };

    return { winner: null, reason: '' };
}

/**
 * Re-plays a recorded game from scratch and validates every move.
 * moves: [{ player, from:{r,c}, to:{r,c} }]
 * Returns { ok, error?, winner, reason, plies, board }.
 * winner is derived by the engine – never trusted from the client.
 */
function replayAndValidate(moves, rules = DEFAULT_RULES) {
    const board = createInitialBoard(rules);
    const enriched = [];
    let expected = 1;
    for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        if (!m || !m.from || !m.to) return { ok: false, error: `Nước #${i + 1} thiếu tọa độ` };
        if (m.player !== expected) return { ok: false, error: `Nước #${i + 1} sai lượt` };
        const legal = getLegalMoves(expected, board, rules).find(l =>
            l.from.r === m.from.r && l.from.c === m.from.c && l.to.r === m.to.r && l.to.c === m.to.c);
        if (!legal) return { ok: false, error: `Nước #${i + 1} không hợp lệ` };
        applyMove(board, legal);
        enriched.push({
            ply: i + 1, player: expected, from: legal.from, to: legal.to,
            pieceType: legal.pieceType, capture: legal.capture, notation: legal.notation
        });
        const res = checkWin(board, rules);
        if (res.winner !== null) {
            if (i !== moves.length - 1) return { ok: false, error: 'Còn nước đi sau khi trận đã kết thúc' };
            return { ok: true, winner: res.winner, reason: res.reason, plies: moves.length, board, moves: enriched };
        }
        expected = expected === 1 ? 2 : 1;
    }
    if (moves.length >= rules.maxPlies) {
        return { ok: true, winner: 'draw', reason: `Hòa do hết ${rules.maxPlies} nước đi`, plies: moves.length, board, moves: enriched };
    }
    return { ok: false, error: 'Trận đấu chưa kết thúc' };
}

const PIECE_TYPES = ['rock', 'paper', 'scissors'];
const MAX_PIECES_PER_SIDE = 30;

/**
 * Validates admin-supplied rule overrides (issue #4). Pure; used by the API and by the editor.
 * Accepts: maxPlies, moveTimeoutMs, timeBankMs, blueGoal, redGoal, setup {p1:[{r,c,t}], p2:[...]}.
 * The board stays 9x9 (the bot helpers and the editor assume it).
 * Returns { ok, errors:[...], rules } where `rules` holds ONLY the validated overrides.
 */
function validateRules(raw) {
    const errors = [];
    const out = {};
    const o = raw && typeof raw === 'object' ? raw : {};
    const R = DEFAULT_RULES.rows, C = DEFAULT_RULES.cols;
    const isInt = (v) => Number.isInteger(v);
    const inBoard = (p) => p && isInt(p.r) && isInt(p.c) && p.r >= 0 && p.r < R && p.c >= 0 && p.c < C;

    const intIn = (key, min, max, label, allowZero) => {
        if (o[key] === undefined || o[key] === null || o[key] === '') return;
        const v = Number(o[key]);
        if (!isInt(v) || (!(allowZero && v === 0) && (v < min || v > max))) {
            errors.push(`${label} phải là số nguyên từ ${min} đến ${max}${allowZero ? ' (hoặc 0 = không giới hạn)' : ''}`);
        } else out[key] = v;
    };
    intIn('maxPlies', 20, 2000, 'Giới hạn số nước đi');
    intIn('moveTimeoutMs', 100, 10000, 'Thời gian tối đa mỗi nước (ms)');
    intIn('timeBankMs', 1000, 3600000, 'Tổng thời gian suy nghĩ mỗi bên (ms)', true);

    for (const key of ['blueGoal', 'redGoal']) {
        if (o[key] === undefined || o[key] === null) continue;
        if (!inBoard(o[key])) errors.push(`Ô đích ${key === 'blueGoal' ? 'Xanh' : 'Đỏ'} nằm ngoài bàn cờ`);
        else out[key] = { r: o[key].r, c: o[key].c };
    }

    if (o.setup !== undefined && o.setup !== null) {
        const setup = { p1: [], p2: [] };
        const used = new Map();
        const blueGoal = out.blueGoal || DEFAULT_RULES.blueGoal;
        const redGoal = out.redGoal || DEFAULT_RULES.redGoal;
        if (blueGoal.r === redGoal.r && blueGoal.c === redGoal.c) errors.push('Hai ô đích không được trùng nhau');
        for (const [key, label] of [['p1', 'Xanh'], ['p2', 'Đỏ']]) {
            const list = o.setup[key];
            if (!Array.isArray(list) || list.length === 0) { errors.push(`Đội ${label} cần ít nhất 1 quân`); continue; }
            if (list.length > MAX_PIECES_PER_SIDE) { errors.push(`Đội ${label} tối đa ${MAX_PIECES_PER_SIDE} quân`); continue; }
            for (const p of list) {
                if (!inBoard(p) || !PIECE_TYPES.includes(p.t)) { errors.push(`Quân của đội ${label} có tọa độ hoặc loại không hợp lệ`); continue; }
                const k = `${p.r},${p.c}`;
                if (used.has(k)) { errors.push(`Hai quân chồng lên nhau tại ô ${toNotation(p.r, p.c)}`); continue; }
                if ((p.r === blueGoal.r && p.c === blueGoal.c) || (p.r === redGoal.r && p.c === redGoal.c)) {
                    errors.push(`Không được đặt quân lên ô đích (${toNotation(p.r, p.c)})`); continue;
                }
                used.set(k, key);
                setup[key].push({ r: p.r, c: p.c, t: p.t });
            }
        }
        if (!errors.length) {
            // the starting position must be a playable game: nobody has won yet and both sides can move
            const probe = resolveRules({ ...out, setup });
            const board = createInitialBoard(probe);
            if (checkWin(board, probe).winner !== null) errors.push('Thế cờ xuất phát đã phân thắng bại');
            else if (!getLegalMoves(1, board, probe).length || !getLegalMoves(2, board, probe).length) {
                errors.push('Mỗi bên phải có ít nhất một nước đi ngay từ đầu');
            } else out.setup = setup;
        }
    } else if (out.blueGoal || out.redGoal) {
        // goals changed but setup is the default: default pieces must not sit on the new goal cells
        const bg = out.blueGoal || DEFAULT_RULES.blueGoal, rg = out.redGoal || DEFAULT_RULES.redGoal;
        if (bg.r === rg.r && bg.c === rg.c) errors.push('Hai ô đích không được trùng nhau');
        for (const p of [...DEFAULT_RULES.setup.p1, ...DEFAULT_RULES.setup.p2]) {
            if ((p.r === bg.r && p.c === bg.c) || (p.r === rg.r && p.c === rg.c)) {
                errors.push(`Ô đích trùng quân xuất phát mặc định (${toNotation(p.r, p.c)}) — hãy tự thiết lập thế cờ`); break;
            }
        }
    }
    return { ok: errors.length === 0, errors, rules: out };
}

module.exports = {
    validateRules,
    PIECE_TYPES,
    DEFAULT_RULES,
    resolveRules,
    canCapture,
    toNotation,
    fromNotation,
    createInitialBoard,
    cloneBoard,
    getLegalMoves,
    simulateMove,
    applyMove,
    countPieces,
    getPieces,
    checkWin,
    replayAndValidate
};
