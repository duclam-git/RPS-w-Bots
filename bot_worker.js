// ===== OTTv2 Code Arena - in-browser bot runner (Web Worker) =====
// Runs the JavaScript bot code typed by the player for practice games and benchmarks, OFF the page:
//   - the server sends this file with its own CSP: eval is allowed (that is how bot code runs) but every
//     network request is blocked, so bot code cannot call the API with the player's session cookie;
//   - no DOM, no cookies, no localStorage;
//   - an endless loop only blocks this worker: the page terminates it after the time limit (bot_client.js).
// One worker per game: bot_worker.js?game=rps | ?game=caro. The helpers come from the same engine file the
// server gives to JS bots, so a bot behaves the same here, online and in tournaments.

(function () {
    'use strict';

    const GAME = new URLSearchParams(self.location.search).get('game') === 'caro' ? 'caro' : 'rps';
    self.module = { exports: {} };
    importScripts(GAME === 'caro' ? 'games/caro.js' : 'engine.js');
    const E = self.module.exports;

    const compiled = new Map();          // code -> Function (a few entries: blue / red / presets)
    function compile(code) {
        let fn = compiled.get(code);
        if (fn) return fn;
        fn = new Function('state', 'helpers', 'log', `${code}
;if (typeof getNextMove !== 'function') { throw new Error("Code bot phải có hàm 'function getNextMove(state, helpers, log)'."); }
return getNextMove(state, helpers, log);`);
        if (compiled.size > 8) compiled.clear();
        compiled.set(code, fn);
        return fn;
    }

    // Same helper set as the server-side JS sandbox (runner.js), plus the extras the practice page always had
    function makeHelpers(rules) {
        const h = {
            distance: (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)),
            manhattanDistance: (r1, c1, r2, c2) => Math.abs(r1 - r2) + Math.abs(c1 - c2),
            randomChoice: (arr) => arr[Math.floor(Math.random() * arr.length)],
            toColumnName: (c) => String.fromCharCode(65 + c),
            cloneBoard: (b) => E.cloneBoard(b)
        };
        const bind = (name, fn) => { if (typeof E[name] === 'function') h[name] = fn; };
        bind('canCapture', (a, b) => E.canCapture(a, b, rules));
        bind('simulateMove', (board, move, player) => E.simulateMove(board, move, player, rules));
        bind('getLegalMoves', (player, board) => E.getLegalMoves(player, board, rules));
        bind('toNotation', (r, c) => E.toNotation(r, c, rules));
        bind('fromNotation', (s) => E.fromNotation(s, rules));
        bind('checkWin', (board) => E.checkWin(board, rules));
        if (typeof E.countPieces === 'function') h.getPieceCounts = (p, b) => E.countPieces(p, b);
        if (typeof E.getPieces === 'function') h.getPieces = (p, b) => E.getPieces(p, b);
        return h;
    }

    const fmt = (args) => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

    /** One move. Never throws: { move, logs, error, elapsed }. */
    function runMove(code, state) {
        const logs = [];
        const t0 = performance.now();
        try {
            const rules = state.rules || E.resolveRules();
            const move = compile(code)(state, makeHelpers(rules), (...a) => { if (logs.length < 200) logs.push(fmt(a).slice(0, 2000)); });
            const clean = move && move.to ? (move.from ? { from: move.from, to: move.to } : { to: move.to }) : null;
            return { move: clean, logs, error: clean ? null : `Nước đi trả về không hợp lệ: ${JSON.stringify(move)}`, elapsed: performance.now() - t0 };
        } catch (e) {
            return { move: null, logs, error: (e && e.message) || String(e), elapsed: performance.now() - t0 };
        }
    }

    // The state a bot receives, identical to games/index.js -> botState()
    function botState(board, player, legalMoves, rules, moves) {
        const opp = player === 1 ? 2 : 1;
        const base = { board: E.cloneBoard(board), myPlayer: player, opponentPlayer: opp, turnNumber: Math.ceil((moves.length + 1) / 2), moveHistory: moves };
        if (GAME === 'caro') {
            return Object.assign(base, {
                grid: board.map(row => row.map(x => (x ? String(x.player) : '0')).join('')),
                legalMoves: legalMoves.map(m => ({ to: m.to })),
                winLength: rules.winLength,
                rules: { rows: rules.rows, cols: rules.cols, winLength: rules.winLength, maxPlies: rules.maxPlies, moveTimeoutMs: rules.moveTimeoutMs, timeBankMs: 0 }
            });
        }
        return Object.assign(base, {
            myGoal: player === 1 ? rules.blueGoal : rules.redGoal,
            opponentGoal: player === 1 ? rules.redGoal : rules.blueGoal,
            legalMoves,
            myCounts: E.countPieces(player, board),
            opponentCounts: E.countPieces(opp, board),
            rules: { rows: rules.rows, cols: rules.cols, beats: rules.beats, blueGoal: rules.blueGoal, redGoal: rules.redGoal, maxPlies: rules.maxPlies, moveTimeoutMs: rules.moveTimeoutMs, timeBankMs: 0 }
        });
    }

    const sameCell = (a, b) => !!a && !!b && a.r === b.r && a.c === b.c;
    const matchMove = (legal, m) => (m ? legal.find(x => sameCell(x.to, m.to) && (!x.from || sameCell(x.from, m.from))) : null);

    /** A whole game between two codes (benchmark). Illegal / crashing moves become random moves, like on the server. */
    function playGame(codes, rules) {
        const board = E.createInitialBoard(rules);
        const moves = [];
        const fallbacks = { 1: 0, 2: 0 };
        let player = 1;
        while (true) {
            const legal = E.getLegalMoves(player, board, rules);
            if (!legal.length) {
                const res = E.checkWin(board, rules);
                return { winner: res.winner === null ? (player === 1 ? 2 : 1) : res.winner, plies: moves.length, fallbacks };
            }
            const out = runMove(codes[player], botState(board, player, legal, rules, moves));
            let chosen = matchMove(legal, out.move);
            if (!chosen) { chosen = legal[Math.floor(Math.random() * legal.length)]; fallbacks[player]++; }
            E.applyMove(board, chosen, player, rules);
            moves.push({ turn: moves.length + 1, player, from: chosen.from || null, to: chosen.to, pieceType: chosen.pieceType, capture: chosen.capture, notation: chosen.notation });
            const res = E.checkWin(board, rules);
            if (res.winner !== null) return { winner: res.winner, reason: res.reason, plies: moves.length, fallbacks };
            if (moves.length >= rules.maxPlies) return { winner: 'draw', plies: moves.length, fallbacks };
            player = player === 1 ? 2 : 1;
        }
    }

    self.onmessage = (e) => {
        const d = e.data || {};
        if (d.type === 'move') {
            self.postMessage(Object.assign({ id: d.id, type: 'move' }, runMove(String(d.code || ''), d.state || {})));
        } else if (d.type === 'simulate') {
            const rules = E.resolveRules(d.rules || {});
            const codes = { 1: String(d.codeBlue || ''), 2: String(d.codeRed || '') };
            const count = Math.max(1, Math.min(500, d.count | 0));
            for (let i = 0; i < count; i++) {
                self.postMessage({ id: d.id, type: 'game', index: i, result: playGame(codes, rules) });
            }
            self.postMessage({ id: d.id, type: 'done' });
        }
    };
})();
