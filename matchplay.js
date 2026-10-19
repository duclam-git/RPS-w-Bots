// ===== OTTv2 Code Arena - Headless Match Player =====
// One authoritative game loop used by both online rooms and tournaments.
// The server owns the board; bots only ever see a JSON snapshot and answer with a move.

'use strict';

const engine = require('./engine');
const runner = require('./runner');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Compact history handed to bots (no logs / timings -> small stdin payload).
 */
function slimHistory(moves) {
    return moves.map(m => ({
        turn: m.ply,
        player: m.player,
        from: m.from,
        to: m.to,
        pieceType: m.pieceType,
        capture: m.capture,
        notation: m.notation
    }));
}

/**
 * Play one complete game.
 *
 * @param {object} opts
 * @param {{name:string, lang:string, handler:object}} opts.blue   player 1 (moves first)
 * @param {{name:string, lang:string, handler:object}} opts.red    player 2
 * @param {object}  [opts.rules]        resolved rules (see engine.resolveRules)
 * @param {number}  [opts.delayMs=0]    pause between plies (lets spectators follow live)
 * @param {{aborted:boolean}} [opts.signal]  set signal.aborted = true to stop early
 * @param {Function} [opts.onStart]     (board)
 * @param {Function} [opts.onMove]      ({ move, board, capturedByBlue, capturedByRed, nextPlayer })
 * @returns {Promise<{aborted:boolean, winner?, reason?, moves, durationMs, fallbacks:{blue:number,red:number}}>}
 */
async function playMatch(opts) {
    const rules = opts.rules || engine.resolveRules();
    const signal = opts.signal || { aborted: false };
    const delayMs = opts.delayMs || 0;
    const startedAt = Date.now();

    const board = engine.createInitialBoard(rules);
    const moves = [];
    const capturedByBlue = [];
    const capturedByRed = [];
    const fallbacks = { blue: 0, red: 0 };
    const used = { 1: 0, 2: 0 };            // thinking time consumed per side (for rules.timeBankMs)
    const bank = rules.timeBankMs || 0;
    let player = 1;

    if (opts.onStart) opts.onStart(engine.cloneBoard(board));

    while (true) {
        if (signal.aborted) return { aborted: true, moves, durationMs: Date.now() - startedAt, fallbacks };

        const legalMoves = engine.getLegalMoves(player, board, rules);
        if (legalMoves.length === 0) {
            const res = engine.checkWin(board, rules);
            return finish(res.winner === null ? (player === 1 ? 2 : 1) : res.winner,
                res.reason || 'Không còn nước đi hợp lệ!');
        }

        const side = player === 1 ? opts.blue : opts.red;
        const state = {
            board,
            myPlayer: player,
            opponentPlayer: player === 1 ? 2 : 1,
            myGoal: player === 1 ? rules.blueGoal : rules.redGoal,
            opponentGoal: player === 1 ? rules.redGoal : rules.blueGoal,
            legalMoves,
            myCounts: engine.countPieces(player, board),
            opponentCounts: engine.countPieces(player === 1 ? 2 : 1, board),
            turnNumber: Math.ceil((moves.length + 1) / 2),
            moveHistory: slimHistory(moves)
        };

        // Chess-clock style budget: the move limit shrinks to whatever is left in this side's bank
        let allowed = rules.moveTimeoutMs;
        if (bank > 0) {
            const left = bank - used[player];
            if (left <= 0) {
                return finish(player === 1 ? 2 : 1, `${player === 1 ? 'Đội Xanh' : 'Đội Đỏ'} đã hết tổng thời gian suy nghĩ (${bank}ms)!`);
            }
            allowed = Math.max(50, Math.min(allowed, left));
        }
        const res = await runner.executeBotMove(side.handler, state, allowed);
        used[player] += res.elapsed || 0;
        if (signal.aborted) return { aborted: true, moves, durationMs: Date.now() - startedAt, fallbacks };

        let chosen = null;
        if (res.move) {
            chosen = legalMoves.find(m =>
                m.from.r === res.move.from.r && m.from.c === res.move.from.c &&
                m.to.r === res.move.to.r && m.to.c === res.move.to.c);
        }

        // Crashed / timed out / illegal -> server plays a random legal move and flags it.
        let fallback = false;
        let errorText = '';
        if (!chosen) {
            fallback = true;
            errorText = res.error || 'Nước đi không hợp lệ';
            chosen = legalMoves[Math.floor(Math.random() * legalMoves.length)];
            fallbacks[player === 1 ? 'blue' : 'red']++;
        }

        if (chosen.capture) (player === 1 ? capturedByBlue : capturedByRed).push(chosen.capture);
        engine.applyMove(board, chosen);

        const record = {
            ply: moves.length + 1,
            player,
            from: chosen.from,
            to: chosen.to,
            pieceType: chosen.pieceType,
            capture: chosen.capture,
            notation: chosen.notation,
            elapsedMs: res.elapsed,
            fallback,
            log: fallback ? `[FALLBACK] ${errorText}\n${res.log || ''}`.trim() : (res.log || '')
        };
        moves.push(record);

        const outcome = engine.checkWin(board, rules);
        const nextPlayer = player === 1 ? 2 : 1;

        if (opts.onMove) {
            opts.onMove({
                move: record,
                board: engine.cloneBoard(board),
                capturedByBlue: capturedByBlue.slice(),
                capturedByRed: capturedByRed.slice(),
                nextPlayer
            });
        }

        if (outcome.winner !== null) return finish(outcome.winner, outcome.reason);
        if (moves.length >= rules.maxPlies) {
            return finish('draw', `Trận đấu kết thúc hòa sau ${rules.maxPlies} nước đi!`);
        }

        player = nextPlayer;
        if (delayMs > 0) await sleep(delayMs);
    }

    function finish(winner, reason) {
        return {
            aborted: false,
            winner,
            reason,
            moves,
            durationMs: Date.now() - startedAt,
            fallbacks,
            capturedByBlue,
            capturedByRed
        };
    }
}

/**
 * Smoke-test a freshly compiled bot: it must answer the opening position with a legal move.
 * Catches syntax errors / missing getNextMove / crashes BEFORE a bot is allowed into a tournament,
 * instead of silently playing random fallback moves for the whole event.
 */
async function smokeTest(handler, rules = engine.resolveRules()) {
    const board = engine.createInitialBoard(rules);
    const out = { ok: true, errors: [] };
    for (const player of [1, 2]) {
        const legalMoves = engine.getLegalMoves(player, board, rules);
        const state = {
            board,
            myPlayer: player,
            opponentPlayer: player === 1 ? 2 : 1,
            myGoal: player === 1 ? rules.blueGoal : rules.redGoal,
            opponentGoal: player === 1 ? rules.redGoal : rules.blueGoal,
            legalMoves,
            myCounts: engine.countPieces(player, board),
            opponentCounts: engine.countPieces(player === 1 ? 2 : 1, board),
            turnNumber: 1,
            moveHistory: []
        };
        const res = await runner.executeBotMove(handler, state, rules.moveTimeoutMs);
        const legal = res.move && legalMoves.find(m =>
            m.from.r === res.move.from.r && m.from.c === res.move.from.c &&
            m.to.r === res.move.to.r && m.to.c === res.move.to.c);
        if (!legal) {
            out.ok = false;
            out.errors.push(`${player === 1 ? 'Xanh' : 'Đỏ'}: ${res.error || 'nước đi không hợp lệ'}${res.log ? ` — ${String(res.log).slice(0, 300)}` : ''}`);
            break;
        }
    }
    return out;
}

module.exports = { playMatch, smokeTest, sleep };
