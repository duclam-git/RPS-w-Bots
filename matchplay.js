// ===== OTTv2 Code Arena - Headless Match Player =====
// One authoritative game loop used by online rooms and tournaments, for ANY registered game (games/index.js).
// The server owns the board; bots only ever see a JSON snapshot and answer with a move.

'use strict';

const games = require('./games');
const runner = require('./runner');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Compact history handed to bots (no logs / timings -> small stdin payload). */
function slimHistory(moves) {
    return moves.map(m => ({
        turn: m.ply, player: m.player, from: m.from || null, to: m.to,
        pieceType: m.pieceType, capture: m.capture, notation: m.notation
    }));
}

/**
 * Play one complete game.
 *
 * @param {object} opts
 * @param {{name:string, lang:string, handler:object}} opts.blue   player 1 (moves first)
 * @param {{name:string, lang:string, handler:object}} opts.red    player 2
 * @param {object}  [opts.game]         a game from games/index.js (default: rps)
 * @param {object}  [opts.rules]        resolved rules of that game
 * @param {number}  [opts.delayMs=0]    pause between plies (lets spectators follow live)
 * @param {{aborted:boolean}} [opts.signal]  set signal.aborted = true to stop early
 * @param {Function} [opts.onStart]     (board)
 * @param {Function} [opts.onMove]      ({ move, board, capturedByBlue, capturedByRed, nextPlayer })
 */
async function playMatch(opts) {
    const game = opts.game || games.get(games.DEFAULT_GAME);
    const rules = opts.rules || game.resolveRules();
    const signal = opts.signal || { aborted: false };
    const delayMs = opts.delayMs || 0;
    const startedAt = Date.now();

    const board = game.createInitialBoard(rules);
    const moves = [];
    const capturedByBlue = [];
    const capturedByRed = [];
    const fallbacks = { blue: 0, red: 0 };
    const used = { 1: 0, 2: 0 };            // thinking time consumed per side (for rules.timeBankMs)
    const bank = rules.timeBankMs || 0;
    let player = 1;

    if (opts.onStart) opts.onStart(game.cloneBoard(board));

    while (true) {
        if (signal.aborted) return { aborted: true, moves, durationMs: Date.now() - startedAt, fallbacks };

        const legalMoves = game.getLegalMoves(player, board, rules);
        if (legalMoves.length === 0) {
            const res = game.checkWin(board, rules);
            return finish(res.winner === null ? (player === 1 ? 2 : 1) : res.winner, res.reason || 'Không còn nước đi hợp lệ!');
        }

        const side = player === 1 ? opts.blue : opts.red;
        const state = game.botState({ board, player, legalMoves, rules, moves: slimHistory(moves) });

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

        const chosenByBot = res.move ? game.matchMove(legalMoves, res.move) : null;
        let chosen = chosenByBot;

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
        game.applyMove(board, chosen, player, rules);

        const record = {
            ply: moves.length + 1,
            player,
            from: chosen.from || null,
            to: chosen.to,
            pieceType: chosen.pieceType,
            capture: chosen.capture,
            notation: chosen.notation,
            elapsedMs: res.elapsed,
            fallback,
            log: fallback ? `[FALLBACK] ${errorText}\n${res.log || ''}`.trim() : (res.log || '')
        };
        moves.push(record);

        const outcome = game.checkWin(board, rules);
        const nextPlayer = player === 1 ? 2 : 1;

        if (opts.onMove) {
            opts.onMove({
                move: record,
                board: game.cloneBoard(board),
                capturedByBlue: capturedByBlue.slice(),
                capturedByRed: capturedByRed.slice(),
                nextPlayer
            });
        }

        if (outcome.winner !== null) return finish(outcome.winner, outcome.reason);
        if (moves.length >= rules.maxPlies) return finish('draw', `Trận đấu kết thúc hòa sau ${rules.maxPlies} nước đi!`);

        player = nextPlayer;
        if (delayMs > 0) await sleep(delayMs);
    }

    function finish(winner, reason) {
        return { aborted: false, winner, reason, moves, durationMs: Date.now() - startedAt, fallbacks, capturedByBlue, capturedByRed };
    }
}

/**
 * Smoke-test a freshly compiled bot: it must answer the opening position (as both players) with a legal move.
 * Catches syntax errors / missing getNextMove / crashes BEFORE a bot is allowed into a tournament,
 * instead of silently playing random fallback moves for the whole event.
 */
async function smokeTest(handler, rules, game = games.get(games.DEFAULT_GAME)) {
    rules = rules || game.resolveRules();
    const board = game.createInitialBoard(rules);
    const out = { ok: true, errors: [] };
    for (const player of [1, 2]) {
        const legalMoves = game.getLegalMoves(player, board, rules);
        const state = game.botState({ board, player, legalMoves, rules, moves: [] });
        const res = await runner.executeBotMove(handler, state, rules.moveTimeoutMs);
        const legal = res.move && game.matchMove(legalMoves, res.move);
        if (!legal) {
            out.ok = false;
            out.errors.push(`${player === 1 ? 'Xanh' : 'Đỏ'}: ${res.error || 'nước đi không hợp lệ'}${res.log ? ` — ${String(res.log).slice(0, 300)}` : ''}`);
            break;
        }
    }
    return out;
}

module.exports = { playMatch, smokeTest, sleep };
