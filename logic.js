// ===== OTTv2 Bot Coding Battle - Game Logic & Arena Engine =====

(function () {
    'use strict';

    // =====================================================================
    // ===== GAME CONFIGURATION — Edit this section to modify game rules =====
    // =====================================================================
    //
    // All game rules are centralized here for easy modification.
    // You can change:
    //   - Board dimensions (rows, cols)
    //   - Piece types (add/remove/rename)
    //   - Capture rules (which type beats which)
    //   - Goal positions for each team
    //   - Initial piece placements
    //   - Move range (how far a piece can move per turn)
    //   - Maximum turns before a draw
    //   - Whether diagonal movement is allowed

    const GameConfig = {

        // --- Board ---
        rows: 9,
        cols: 9,

        // --- Piece Types ---
        // Each key is the internal type ID. Add or remove types here.
        // 'beats' is an array of type IDs that this type can capture.
        pieceTypes: {
            rock: {
                name: 'Đấm (Rock)',
                emoji: '✊',
                beats: ['scissors'],
                svg: `<svg viewBox="0 0 24 24"><path d="M5.5 10.5c0-1 .7-2 1.5-2.5V6.5a2 2 0 0 1 2-2c.4 0 .8.1 1.1.3A2 2 0 0 1 12 3.5a2 2 0 0 1 1.9 1.3c.3-.2.7-.3 1.1-.3a2 2 0 0 1 2 2v.5c.5.3 1 .8 1.2 1.5l.3 1.5v3a5 5 0 0 1-2 4l-1 .8a3 3 0 0 1-1.8.7H10a3 3 0 0 1-2.1-.9l-1.5-1.5A5 5 0 0 1 5.5 13z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="5" x2="9" y2="9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="4.5" x2="12" y2="9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="15" y1="5" x2="15" y2="9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
            },
            paper: {
                name: 'Lá (Paper)',
                emoji: '✋',
                beats: ['rock'],
                svg: `<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><line x1="8.5" y1="8" x2="15.5" y2="8" stroke="currentColor" stroke-width="2"/><line x1="8.5" y1="12" x2="15.5" y2="12" stroke="currentColor" stroke-width="2"/><line x1="8.5" y1="16" x2="13" y2="16" stroke="currentColor" stroke-width="2"/></svg>`
            },
            scissors: {
                name: 'Kéo (Scissors)',
                emoji: '✌️',
                beats: ['paper'],
                svg: `<svg viewBox="0 0 24 24"><circle cx="7" cy="17" r="2.8" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="17" cy="17" r="2.8" fill="none" stroke="currentColor" stroke-width="2.2"/><line x1="9.2" y1="15" x2="17" y2="5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="14.8" y1="15" x2="7" y2="5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`
            }
            // --- Example: Add a 4th type (Rock-Paper-Scissors-Lizard-Spock style) ---
            // lizard: {

            //     name: 'Thằn lằn (Lizard)',
            //     emoji: '🦎',
            //     beats: ['paper', 'spock'],
            //     svg: `<svg viewBox="0 0 24 24">...</svg>`
            // },
            // spock: {
            //     name: 'Spock',
            //     emoji: '🖖',
            //     beats: ['scissors', 'rock'],
            //     svg: `<svg viewBox="0 0 24 24">...</svg>`
            // },
        },

        // --- Movement Rules ---
        moveRange: 1,               // Max squares a piece can move per turn
        allowDiagonal: true,         // Allow diagonal movement (8 directions if true, 4 if false)

        // --- Goals ---
        // Blue (player 1) target and Red (player 2) target positions.
        // Set to null to automatically target the opposite corners:
        //   Blue -> top-right (r=0, c=cols-1)
        //   Red  -> bottom-left (r=rows-1, c=0)
        // Or set custom coordinates: { r: row, c: col }
        blueGoal: null,
        redGoal:  null,

        // --- Match Limits ---
        maxTurns: 2000,               // Draw after this many total turns (both players combined)

        // --- Initial Piece Placements ---
        // Each entry: { r: row, c: col, t: 'typeId' }
        initialPiecesBlue: [
            { r: 4, c: 1, t: 'paper' },      // B5
            { r: 4, c: 2, t: 'scissors' },   // C5
            { r: 5, c: 1, t: 'rock' },       // B4
            { r: 5, c: 2, t: 'paper' },      // C4
            { r: 5, c: 3, t: 'scissors' },   // D4
            { r: 6, c: 2, t: 'rock' },       // C3
            { r: 6, c: 3, t: 'paper' },      // D3
            { r: 6, c: 4, t: 'scissors' },   // E3
            { r: 7, c: 3, t: 'rock' },       // D2
            { r: 7, c: 4, t: 'paper' }       // E2
        ],
        initialPiecesRed: [
            { r: 4, c: 6, t: 'scissors' },   // G5
            { r: 4, c: 7, t: 'paper' },      // H5
            { r: 3, c: 5, t: 'scissors' },   // F6
            { r: 3, c: 6, t: 'paper' },      // G6
            { r: 3, c: 7, t: 'rock' },       // H6
            { r: 2, c: 4, t: 'scissors' },   // E7
            { r: 2, c: 5, t: 'paper' },      // F7
            { r: 2, c: 6, t: 'rock' },       // G7
            { r: 1, c: 4, t: 'paper' },      // E8
            { r: 1, c: 5, t: 'rock' }        // F8
        ]
    };

    // =====================================================================
    // ===== END OF GAME CONFIGURATION =====================================
    // =====================================================================

    // --- Derived constants from GameConfig (do not edit below) ---
    const ROWS = GameConfig.rows;
    const COLS = GameConfig.cols;
    const BLUE_GOAL = (GameConfig.blueGoal && GameConfig.blueGoal.r !== undefined)
        ? GameConfig.blueGoal
        : { r: 0, c: COLS - 1 };
    const RED_GOAL = (GameConfig.redGoal && GameConfig.redGoal.r !== undefined)
        ? GameConfig.redGoal
        : { r: ROWS - 1, c: 0 };

    // Build lookup tables from GameConfig.pieceTypes
    const PIECE_SVG = {};
    const TYPE_NAMES = {};
    const TYPE_EMOJI = {};
    for (const [typeId, info] of Object.entries(GameConfig.pieceTypes)) {
        PIECE_SVG[typeId] = info.svg;
        TYPE_NAMES[typeId] = info.name;
        TYPE_EMOJI[typeId] = info.emoji;
    }

    // Initial Piece Setups (reads from GameConfig)
    function getInitialPieces() {
        const p1 = GameConfig.initialPiecesBlue.map(p => ({ r: p.r, c: p.c, t: p.t }));
        const p2 = GameConfig.initialPiecesRed.map(p => ({ r: p.r, c: p.c, t: p.t }));
        return { p1, p2 };
    }

    // ===== Game State =====
    let board = [];
    let currentPlayer = 1; // 1: Blue, 2: Red
    let turnCount = 1;
    let selectedPiece = null;
    let lastMove = null;
    let moveHistory = [];
    let capturedByBlue = [];
    let capturedByRed = [];
    let gameOver = false;
    let winner = null;
    let winReason = '';

    // Match Battle Controls
    let isRunning = false;
    let isPaused = false;
    let battleSpeed = 350; // ms per step
    let stepTimer = null;
    let controllers = {
        blue: 'custom', // 'custom', 'human', 'random', 'rusher', 'hunter', 'tactical'
        red: 'tactical'
    };

    // Bot Consoles & Execution Logs
    let botLogs = [];
    let activeConsoleFilter = 'all';

    // Ace Editors & Multi-Language
    let editorBlue = null;
    let editorRed = null;
    let blueLang = localStorage.getItem('ott_blue_lang') || 'javascript';
    let redLang = localStorage.getItem('ott_red_lang') || 'javascript';

    // Theme & Player Profile & Socket.io Online Multiplayer
    let currentTheme = localStorage.getItem('ott_theme') || 'light';
    let currentPlayerProfile = null;
    let socket = null;
    let isOnlineMatch = false;
    let currentOnlineRoom = null;
    let myOnlineSlot = null; // 'blue' | 'red' | 'spectator'

    // Sound FX (Web Audio API)
    let audioCtx = null;
    let soundEnabled = true;

    function initAudio() {
        if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContextClass();
        }
    }

    function playSound(type) {
        if (!soundEnabled) return;
        try {
            initAudio();
            if (!audioCtx || audioCtx.state === 'suspended') {
                audioCtx && audioCtx.resume();
            }
            if (!audioCtx) return;

            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);

            if (type === 'move') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(700, now + 0.06);
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
                osc.start(now);
                osc.stop(now + 0.06);
            } else if (type === 'capture') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(280, now);
                osc.frequency.exponentialRampToValueAtTime(140, now + 0.12);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                osc.start(now);
                osc.stop(now + 0.12);
            } else if (type === 'win') {
                [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
                    const noteOsc = audioCtx.createOscillator();
                    const noteGain = audioCtx.createGain();
                    noteOsc.connect(noteGain);
                    noteGain.connect(audioCtx.destination);
                    noteOsc.type = 'square';
                    noteOsc.frequency.setValueAtTime(freq, now + idx * 0.09);
                    noteGain.gain.setValueAtTime(0.1, now + idx * 0.09);
                    noteGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.18);
                    noteOsc.start(now + idx * 0.09);
                    noteOsc.stop(now + idx * 0.09 + 0.18);
                });
            } else if (type === 'error') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(160, now);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.start(now);
                osc.stop(now + 0.15);
            }
        } catch (e) {
            // Audio error non-blocking
        }
    }

    // ===== Core Game Logic & Rules =====

    function canCapture(attackerType, defenderType) {
        if (!attackerType || !defenderType) return false;
        if (attackerType === defenderType) return false;
        const attackerInfo = GameConfig.pieceTypes[attackerType];
        if (!attackerInfo) return false;
        return attackerInfo.beats.includes(defenderType);
    }

    function toColumnName(c) {
        let col = "";
        let n = c + 1; // Convert 0-based index to 1-based column number
        while (n > 0) {
            n--;
            col = String.fromCharCode(65 + (n % 26)) + col;
            n = Math.floor(n / 26);
        }
        return col;
    }

    function toNotation(r, c) {
        return toColumnName(c) + (ROWS - r);
    }

    function fromNotation(str) {
        if (!str || str.length < 2) return null;

        const match = str.toUpperCase().match(/^([A-Z]+)(\d+)$/);
        if (!match) return null;

        const colStr = match[1];
        const rowNum = parseInt(match[2], 10);

        // Convert column letters to a 1-based column number
        let colNum = 0;
        for (const ch of colStr) {
            colNum = colNum * 26 + (ch.charCodeAt(0) - 64);
        }

        const c = colNum - 1; // Convert to 0-based index
        const r = ROWS - rowNum;

        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) {
            return null;
        }

        return { r, c };
    }

    function cloneBoard(b) {
        const nb = [];
        for (let r = 0; r < ROWS; r++) {
            nb[r] = [];
            for (let c = 0; c < COLS; c++) {
                const cell = b[r][c];
                nb[r][c] = cell ? { player: cell.player, type: cell.type } : null;
            }
        }
        return nb;
    }

    function isValidMove(sr, sc, dr, dc, b = board) {
        if (sr < 0 || sr >= ROWS || sc < 0 || sc >= COLS) return false;
        if (dr < 0 || dr >= ROWS || dc < 0 || dc >= COLS) return false;

        const rowDiff = Math.abs(dr - sr);
        const colDiff = Math.abs(dc - sc);
        if (rowDiff === 0 && colDiff === 0) return false;
        if (rowDiff > GameConfig.moveRange || colDiff > GameConfig.moveRange) return false;

        // Block diagonal movement if not allowed
        if (!GameConfig.allowDiagonal && rowDiff > 0 && colDiff > 0) return false;

        const myPiece = b[sr][sc];
        if (!myPiece) return false;

        const targetPiece = b[dr][dc];
        if (!targetPiece) return true; // Empty cell
        if (targetPiece.player === myPiece.player) return false; // Own piece blocks
        return canCapture(myPiece.type, targetPiece.type);
    }

    function getLegalMoves(player, b = board) {
        const moves = [];
        const range = GameConfig.moveRange;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const p = b[r][c];
                if (p && p.player === player) {
                    for (let dr = -range; dr <= range; dr++) {
                        for (let dc = -range; dc <= range; dc++) {
                            if (dr === 0 && dc === 0) continue;
                            const nr = r + dr;
                            const nc = c + dc;
                            if (isValidMove(r, c, nr, nc, b)) {
                                const target = b[nr][nc];
                                moves.push({
                                    from: { r, c },
                                    to: { r: nr, c: nc },
                                    pieceType: p.type,
                                    capture: target ? target.type : null,
                                    notation: `${toNotation(r, c)} → ${toNotation(nr, nc)}`
                                });
                            }
                        }
                    }
                }
            }
        }
        return moves;
    }

    function simulateMove(b, move) {
        const nb = cloneBoard(b);
        const { from, to } = move;
        nb[to.r][to.c] = nb[from.r][from.c];
        nb[from.r][from.c] = null;
        return nb;
    }

    function getPieceCounts(player, b = board) {
        const counts = { total: 0 };
        for (const typeId of Object.keys(GameConfig.pieceTypes)) {
            counts[typeId] = 0;
        }
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const p = b[r][c];
                if (p && p.player === player) {
                    counts[p.type]++;
                    counts.total++;
                }
            }
        }
        return counts;
    }

    function getPieces(player, b = board) {
        const pieces = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const p = b[r][c];
                if (p && p.player === player) {
                    pieces.push({ r, c, type: p.type });
                }
            }
        }
        return pieces;
    }

    function checkWin(b = board) {
        // Goal reach: Blue reaches target on the other side
        const pieceAtBlueGoal = b[BLUE_GOAL.r][BLUE_GOAL.c];
        if (pieceAtBlueGoal && pieceAtBlueGoal.player === 1) {
            return { winner: 1, reason: `Đội Xanh đã đưa quân tới ô đích ${toNotation(BLUE_GOAL.r, BLUE_GOAL.c)} ở phía bên kia bàn cờ!` };
        }

        // Goal reach: Red reaches target on the other side
        const pieceAtRedGoal = b[RED_GOAL.r][RED_GOAL.c];
        if (pieceAtRedGoal && pieceAtRedGoal.player === 2) {
            return { winner: 2, reason: `Đội Đỏ đã đưa quân tới ô đích ${toNotation(RED_GOAL.r, RED_GOAL.c)} ở phía bên kia bàn cờ!` };
        }

        // Total elimination check (if a team loses all pieces on the board)
        const p1Counts = getPieceCounts(1, b);
        const p2Counts = getPieceCounts(2, b);

        if (p1Counts.total === 0) {
            return { winner: 2, reason: 'Đội Xanh đã bị bắt hết toàn bộ quân cờ!' };
        }
        if (p2Counts.total === 0) {
            return { winner: 1, reason: 'Đội Đỏ đã bị bắt hết toàn bộ quân cờ!' };
        }

        // Check stalemate (no legal moves)
        const p1Moves = getLegalMoves(1, b);
        const p2Moves = getLegalMoves(2, b);
        if (p1Moves.length === 0 && p2Moves.length === 0) {
            return { winner: 'draw', reason: 'Cả hai đội đều hết nước đi hợp lệ (Hòa cờ)!' };
        }
        if (p1Moves.length === 0) {
            return { winner: 2, reason: 'Đội Xanh không còn nước đi hợp lệ!' };
        }
        if (p2Moves.length === 0) {
            return { winner: 1, reason: 'Đội Đỏ không còn nước đi hợp lệ!' };
        }

        return { winner: null, reason: '' };
    }

    function initBoard() {
        board = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
        const { p1, p2 } = getInitialPieces();
        p1.forEach(p => board[p.r][p.c] = { player: 1, type: p.t });
        p2.forEach(p => board[p.r][p.c] = { player: 2, type: p.t });
    }

    // ===== Bot Code Execution Sandbox =====

    function getBotCode(player) {
        const ctrl = player === 1 ? controllers.blue : controllers.red;
        if (ctrl === 'custom') {
            if (player === 1) {
                return editorBlue ? editorBlue.getValue() : localStorage.getItem('ott_bot_code_blue') || window.BOT_PRESETS.starterBlue;
            } else {
                return editorRed ? editorRed.getValue() : localStorage.getItem('ott_bot_code_red') || window.BOT_PRESETS.starterRed;
            }
        }
        // Built-in presets
        if (window.BOT_PRESETS && window.BOT_PRESETS[ctrl]) {
            return window.BOT_PRESETS[ctrl];
        }
        return window.BOT_PRESETS.random;
    }

    async function executeBot(player) {
        const legalMoves = getLegalMoves(player, board);
        if (legalMoves.length === 0) return null;

        const myGoal = player === 1 ? BLUE_GOAL : RED_GOAL;
        const opponentGoal = player === 1 ? RED_GOAL : BLUE_GOAL;
        const opponentPlayer = player === 1 ? 2 : 1;

        const state = {
            board: cloneBoard(board),
            myPlayer: player,
            opponentPlayer: opponentPlayer,
            myGoal: { ...myGoal },
            opponentGoal: { ...opponentGoal },
            legalMoves: legalMoves.map(m => ({ ...m, from: { ...m.from }, to: { ...m.to } })),
            moveHistory: [...moveHistory],
            capturedByMe: player === 1 ? [...capturedByBlue] : [...capturedByRed],
            capturedByOpponent: player === 1 ? [...capturedByRed] : [...capturedByBlue],
            myCounts: getPieceCounts(player, board),
            opponentCounts: getPieceCounts(opponentPlayer, board),
            turnNumber: Math.ceil(turnCount / 2)
        };

        const helpers = {
            canCapture,
            distance: (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)),
            manhattanDistance: (r1, c1, r2, c2) => Math.abs(r1 - r2) + Math.abs(c1 - c2),
            toColumnName,
            toNotation,
            fromNotation,
            cloneBoard,
            simulateMove,
            getLegalMoves: (p, b) => getLegalMoves(p, b),
            checkWin: (b) => checkWin(b),
            randomChoice: (arr) => arr[Math.floor(Math.random() * arr.length)],
            getPieceCounts: (p, b) => getPieceCounts(p, b),
            getPieces: (p, b) => getPieces(p, b)
        };

        const currentLogs = [];
        const logger = (...args) => {
            const formatted = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            currentLogs.push(formatted);
        };

        const codeString = getBotCode(player);
        const startTime = performance.now();
        let rawMove = null;
        let botError = null;

        const botName = player === 1 ? 'Đội Xanh' : 'Đội Đỏ';
        const botTag = player === 1 ? 'blue' : 'red';
        const ctrlType = player === 1 ? controllers.blue : controllers.red;
        const currentLang = player === 1 ? blueLang : redLang;

        if (ctrlType === 'custom' && (currentLang === 'python' || currentLang === 'cpp')) {
            try {
                const res = await fetch('/api/run-bot-move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        botId: player === 1 ? 'blue' : 'red',
                        lang: currentLang,
                        code: codeString,
                        state: state
                    })
                });
                const data = await res.json();
                if (data.success && data.move) {
                    rawMove = data.move;
                    if (data.log) currentLogs.push(data.log);
                } else {
                    botError = new Error(data.error || 'Runner error');
                }
            } catch (err) {
                // If the local backend server is not running (e.g. static offline play without node/python server)
                // simulate the standard template strategy so game doesn't stall, while warning in console
                currentLogs.push(`[Offline Runner Fallback] Không kết nối được server biên dịch (${err.message}). Đang dùng giả lập chiến thuật mẫu.`);
                const targetGoal = player === 1 ? { r: 0, c: 8 } : { r: 8, c: 0 };
                const winningMove = state.legalMoves.find(m => m.to.r === targetGoal.r && m.to.c === targetGoal.c);
                if (winningMove) {
                    rawMove = winningMove;
                } else {
                    const captureMove = state.legalMoves.find(m => m.hasCapture);
                    if (captureMove) {
                        rawMove = captureMove;
                    } else {
                        // Move minimizing distance to goal
                        let best = state.legalMoves[0];
                        let bestDist = 999;
                        for (const m of state.legalMoves) {
                            const d = Math.max(Math.abs(m.to.r - targetGoal.r), Math.abs(m.to.c - targetGoal.c));
                            if (d < bestDist) {
                                bestDist = d;
                                best = m;
                            }
                        }
                        rawMove = best;
                    }
                }
            }
        } else {
            try {
                const botWrapper = new Function('state', 'helpers', 'log', `
                    ${codeString}
                    if (typeof getNextMove !== 'function') {
                        throw new Error("Bot code must define 'function getNextMove(state, helpers, log)'.");
                    }
                    return getNextMove(state, helpers, log);
                `);
                rawMove = botWrapper(state, helpers, logger);
            } catch (err) {
                botError = err;
            }
        }
        const elapsedMs = (performance.now() - startTime).toFixed(1);

        if (currentLogs.length > 0) {
            currentLogs.forEach(msg => {
                addConsoleLog({
                    type: botTag,
                    player: player,
                    text: `[${botName} (${ctrlType})] ${msg}`,
                    time: new Date().toLocaleTimeString(),
                    elapsed: `${elapsedMs}ms`
                });
            });
        }

        if (botError) {
            addConsoleLog({
                type: 'error',
                player: player,
                text: `⚠️ [${botName}] Lỗi code: ${botError.message}`,
                time: new Date().toLocaleTimeString(),
                elapsed: `${elapsedMs}ms`
            });
            playSound('error');
            // Fallback to random legal move on error so match continues
            const fallback = helpers.randomChoice(legalMoves);
            addConsoleLog({
                type: 'warn',
                player: player,
                text: `⚠️ Tự động chọn nước dự phòng: ${fallback.notation}`,
                time: new Date().toLocaleTimeString(),
                elapsed: ''
            });
            return fallback;
        }

        // Validate returned move
        if (!rawMove || typeof rawMove !== 'object' || !rawMove.from || !rawMove.to) {
            addConsoleLog({
                type: 'error',
                player: player,
                text: `⚠️ [${botName}] Trả về nước đi không hợp lệ (${JSON.stringify(rawMove)})!`,
                time: new Date().toLocaleTimeString(),
                elapsed: `${elapsedMs}ms`
            });
            const fallback = helpers.randomChoice(legalMoves);
            return fallback;
        }

        // Find matching legal move
        const matchedMove = legalMoves.find(m =>
            m.from.r === rawMove.from.r &&
            m.from.c === rawMove.from.c &&
            m.to.r === rawMove.to.r &&
            m.to.c === rawMove.to.c
        );

        if (!matchedMove) {
            addConsoleLog({
                type: 'error',
                player: player,
                text: `⚠️ [${botName}] Nước đi phạm luật (${toNotation(rawMove.from.r, rawMove.from.c)} → ${toNotation(rawMove.to.r, rawMove.to.c)})!`,
                time: new Date().toLocaleTimeString(),
                elapsed: `${elapsedMs}ms`
            });
            return helpers.randomChoice(legalMoves);
        }

        addConsoleLog({
            type: botTag,
            player: player,
            text: `🎯 [${botName}] Đi nước ${matchedMove.notation} (${elapsedMs}ms)`,
            time: new Date().toLocaleTimeString(),
            elapsed: `${elapsedMs}ms`
        });

        return matchedMove;
    }

    // ===== Execute Move =====

    function executeMove(sr, sc, dr, dc) {
        const movingPiece = board[sr][sc];
        if (!movingPiece) return false;

        const capturedPiece = board[dr][dc];
        const isCapture = capturedPiece !== null;

        // Record Move
        const moveRecord = {
            turn: turnCount,
            player: currentPlayer,
            pieceType: movingPiece.type,
            from: toNotation(sr, sc),
            to: toNotation(dr, dc),
            fromCoords: { r: sr, c: sc },
            toCoords: { r: dr, c: dc },
            capture: isCapture ? capturedPiece.type : null,
            notation: `${toNotation(sr, sc)} → ${toNotation(dr, dc)}`
        };
        moveHistory.push(moveRecord);

        // Track captures
        if (isCapture) {
            if (currentPlayer === 1) {
                capturedByBlue.push(capturedPiece.type);
            } else {
                capturedByRed.push(capturedPiece.type);
            }
            playSound('capture');
        } else {
            playSound('move');
        }

        // Apply to board
        board[dr][dc] = board[sr][sc];
        board[sr][sc] = null;
        lastMove = { fromR: sr, fromC: sc, toR: dr, toC: dc };
        selectedPiece = null;

        // UI Refresh
        drawBoard();
        updateMaterialPanels();
        appendMoveLedger(moveRecord);

        // Win check
        const winCheck = checkWin(board);
        if (winCheck.winner !== null) {
            handleGameOver(winCheck.winner, winCheck.reason);
            return true;
        }

        // Draw by move limit
        if (turnCount >= GameConfig.maxTurns) {
            handleGameOver('draw', `Trận đấu kết thúc hòa sau ${GameConfig.maxTurns} nước đi (Giới hạn tối đa)!`);
            return true;
        }

        // Next turn
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        turnCount++;
        updateTurnIndicator();

        return true;
    }

    // ===== Battle Loop Controls =====

    async function stepBattle() {
        if (gameOver) {
            pauseBattle();
            return;
        }

        const currentController = currentPlayer === 1 ? controllers.blue : controllers.red;
        if (currentController === 'human') {
            // Human turn: wait for click
            updateStatusTicker(`Lượt của bạn (${currentPlayer === 1 ? 'Đội Xanh' : 'Đội Đỏ'}) - Nhấp vào quân cờ để đi`);
            return;
        }

        // Bot turn
        updateStatusTicker(`${currentPlayer === 1 ? 'Đội Xanh' : 'Đội Đỏ'} đang tính toán nước đi...`);
        const move = await executeBot(currentPlayer);
        if (move) {
            executeMove(move.from.r, move.from.c, move.to.r, move.to.c);
        }

        // If auto-running and match not over, schedule next step
        if (isRunning && !isPaused && !gameOver) {
            clearTimeout(stepTimer);
            stepTimer = setTimeout(() => {
                stepBattle();
            }, battleSpeed);
        }
    }

    function startBattle() {
        if (gameOver) {
            resetBattle();
        }
        isRunning = true;
        isPaused = false;
        updateBattleButtons();
        stepBattle();
    }

    function pauseBattle() {
        isRunning = false;
        isPaused = true;
        clearTimeout(stepTimer);
        updateBattleButtons();
        updateStatusTicker("Đã tạm dừng trận đấu");
    }

    function resetBattle() {
        pauseBattle();
        clearTimeout(stepTimer);

        initBoard();
        currentPlayer = 1;
        turnCount = 1;
        selectedPiece = null;
        lastMove = null;
        moveHistory = [];
        capturedByBlue = [];
        capturedByRed = [];
        gameOver = false;
        winner = null;
        winReason = '';

        hideWinModal();
        drawBoard();
        updateTurnIndicator();
        updateMaterialPanels();
        clearMoveLedger();
        updateBattleButtons();
        updateStatusTicker("Sẵn sàng! Nhấn 'Bắt đầu' để đấu bot.");
    }

    function handleGameOver(wonPlayer, reason) {
        gameOver = true;
        winner = wonPlayer;
        winReason = reason;
        pauseBattle();
        playSound('win');
        drawBoard();
        updateStatusTicker(reason);

        // Offline / local matches do not count toward Elo rating (unrated practice matches)
        showWinModal(wonPlayer, reason, null);
    }

    // ===== Human Cell Click Handler =====

    function handleCellClick(r, c) {
        if (gameOver) return;

        const currentController = currentPlayer === 1 ? controllers.blue : controllers.red;
        if (currentController !== 'human') {
            // Not a human turn
            return;
        }

        const clickedPiece = board[r][c];

        // Selecting a piece
        if (!selectedPiece) {
            if (clickedPiece && clickedPiece.player === currentPlayer) {
                selectedPiece = { r, c };
                drawBoard();
            }
            return;
        }

        const sr = selectedPiece.r;
        const sc = selectedPiece.c;

        // Deselect if clicked same cell
        if (sr === r && sc === c) {
            selectedPiece = null;
            drawBoard();
            return;
        }

        // Reselect if clicked own other piece
        if (clickedPiece && clickedPiece.player === currentPlayer) {
            selectedPiece = { r, c };
            drawBoard();
            return;
        }

        // Attempt move
        if (isValidMove(sr, sc, r, c)) {
            executeMove(sr, sc, r, c);

            // If opponent is bot and battle is running or auto-responding, trigger bot step
            const nextController = currentPlayer === 1 ? controllers.blue : controllers.red;
            if (nextController !== 'human' && !gameOver) {
                setTimeout(() => {
                    stepBattle();
                }, Math.min(battleSpeed, 350));
            }
        } else {
            selectedPiece = null;
            drawBoard();
        }
    }

    // ===== UI Rendering =====

    function drawBoard() {
        const boardEl = document.getElementById('board');
        if (!boardEl) return;
        boardEl.innerHTML = '';

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                cell.classList.add((r + c) % 2 === 0 ? 'cell-light' : 'cell-dark');
                cell.dataset.r = r;
                cell.dataset.c = c;

                if (c === COLS - 1) cell.classList.add('last-col');
                if (r === ROWS - 1) cell.classList.add('last-row');

                // Goals
                if (r === BLUE_GOAL.r && c === BLUE_GOAL.c) {
                    cell.classList.add('goal-blue');
                    const notation = toNotation(BLUE_GOAL.r, BLUE_GOAL.c);
                    cell.dataset.goalText = `🏁 ${notation}`;
                    cell.title = `Đích Đội Xanh (${notation}) — Về đây để thắng!`;
                }
                if (r === RED_GOAL.r && c === RED_GOAL.c) {
                    cell.classList.add('goal-red');
                    const notation = toNotation(RED_GOAL.r, RED_GOAL.c);
                    cell.dataset.goalText = `🚩 ${notation}`;
                    cell.title = `Đích Đội Đỏ (${notation}) — Về đây để thắng!`;
                }

                // Selected highlight
                if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                    cell.classList.add('selected');
                }

                // Last move highlights
                if (lastMove) {
                    if (lastMove.fromR === r && lastMove.fromC === c) cell.classList.add('last-move-from');
                    if (lastMove.toR === r && lastMove.toC === c) cell.classList.add('last-move-to');
                }

                // Valid move indicator for human player
                if (selectedPiece && isValidMove(selectedPiece.r, selectedPiece.c, r, c)) {
                    const target = board[r][c];
                    if (target && target.player !== board[selectedPiece.r][selectedPiece.c].player) {
                        cell.classList.add('capturable');
                    } else if (!target) {
                        cell.classList.add('valid-move');
                    }
                }

                // Piece
                const piece = board[r][c];
                if (piece) {
                    const pieceDiv = document.createElement('div');
                    pieceDiv.classList.add('piece', piece.player === 1 ? 'piece-blue' : 'piece-red', piece.type);

                    const iconDiv = document.createElement('div');
                    iconDiv.classList.add('piece-icon');
                    iconDiv.innerHTML = PIECE_SVG[piece.type];
                    pieceDiv.appendChild(iconDiv);

                    cell.appendChild(pieceDiv);
                }

                // Move dot
                if (!piece && selectedPiece && isValidMove(selectedPiece.r, selectedPiece.c, r, c)) {
                    const dot = document.createElement('div');
                    dot.classList.add('move-dot');
                    cell.appendChild(dot);
                }

                cell.addEventListener('click', () => handleCellClick(r, c));
                boardEl.appendChild(cell);
            }
        }
    }

    function updateTurnIndicator() {
        const text = document.getElementById('turn-text');
        const dot = document.getElementById('turn-dot');
        const roundNum = Math.ceil(turnCount / 2);
        const playerLabel = currentPlayer === 1 ? 'Đội Xanh (Blue)' : 'Đội Đỏ (Red)';

        if (text) {
            text.textContent = `Nước ${turnCount} (Vòng ${roundNum}): ${playerLabel}`;
        }
        if (dot) {
            if (currentPlayer === 1) {
                dot.classList.remove('red');
            } else {
                dot.classList.add('red');
            }
        }
    }

    function updateStatusTicker(msg) {
        const ticker = document.getElementById('status-ticker');
        if (ticker) ticker.textContent = msg;
    }

    function updateMaterialPanels() {
        const bluePanel = document.getElementById('captured-by-blue');
        const redPanel = document.getElementById('captured-by-red');
        const blueCountsEl = document.getElementById('blue-piece-counts');
        const redCountsEl = document.getElementById('red-piece-counts');

        // Captures
        if (bluePanel) {
            bluePanel.innerHTML = capturedByBlue.length === 0
                ? '<span class="empty-caps">Chưa ăn quân</span>'
                : capturedByBlue.map(t => `<span class="captured-piece piece-red-tag" title="Đã ăn ${TYPE_NAMES[t]}">${TYPE_EMOJI[t]}</span>`).join('');
        }
        if (redPanel) {
            redPanel.innerHTML = capturedByRed.length === 0
                ? '<span class="empty-caps">Chưa ăn quân</span>'
                : capturedByRed.map(t => `<span class="captured-piece piece-blue-tag" title="Đã ăn ${TYPE_NAMES[t]}">${TYPE_EMOJI[t]}</span>`).join('');
        }

        // Remaining piece badges
        const bCounts = getPieceCounts(1, board);
        const rCounts = getPieceCounts(2, board);

        if (blueCountsEl) {
            blueCountsEl.innerHTML = Object.keys(GameConfig.pieceTypes).map(typeId =>
                `<span class="count-badge" title="${TYPE_NAMES[typeId]} còn lại">${TYPE_EMOJI[typeId]} ${bCounts[typeId] || 0}</span>`
            ).join('\n                ');
        }
        if (redCountsEl) {
            redCountsEl.innerHTML = Object.keys(GameConfig.pieceTypes).map(typeId =>
                `<span class="count-badge" title="${TYPE_NAMES[typeId]} còn lại">${TYPE_EMOJI[typeId]} ${rCounts[typeId] || 0}</span>`
            ).join('\n                ');
        }
    }

    function updateBattleButtons() {
        const startBtn = document.getElementById('battle-start-btn');
        if (!startBtn) return;

        if (isRunning && !isPaused) {
            startBtn.innerHTML = '⏸ Tạm dừng';
            startBtn.classList.add('btn-active-pause');
        } else {
            startBtn.innerHTML = '▶ Bắt đầu đấu';
            startBtn.classList.remove('btn-active-pause');
        }
    }

    // ===== Move Ledger & History =====

    function appendMoveLedger(move) {
        const grid = document.getElementById('history-grid');
        const countEl = document.getElementById('move-count');
        if (!grid) return;

        const empty = grid.querySelector('.live-panel-empty');
        if (empty) empty.remove();

        const card = document.createElement('div');
        card.classList.add('history-move-card', move.player === 1 ? 'blue-move' : 'red-move');
        const playerColor = move.player === 1 ? 'var(--theme-blue)' : 'var(--theme-red)';
        const captureBadge = move.capture ? `<span class="ledger-capture">× ${TYPE_EMOJI[move.capture]}</span>` : '';

        card.innerHTML = `
            <span class="history-move-number">#${move.turn}</span>
            <div class="history-move-text">
                <span class="history-piece-icon" style="color: ${playerColor}">
                    ${PIECE_SVG[move.pieceType]}
                </span>
                <span class="notation-text">${move.from} → ${move.to}</span>
                ${captureBadge}
            </div>
        `;

        grid.appendChild(card);
        if (countEl) countEl.textContent = `${moveHistory.length} nước`;
        grid.scrollTop = grid.scrollHeight;
    }

    function clearMoveLedger() {
        const grid = document.getElementById('history-grid');
        const countEl = document.getElementById('move-count');
        if (grid) grid.innerHTML = '<div class="live-panel-empty">Chưa có nước đi nào</div>';
        if (countEl) countEl.textContent = '0 nước';
    }

    // ===== Bot Console Logger =====

    function addConsoleLog(logItem) {
        botLogs.push(logItem);
        if (botLogs.length > 500) botLogs.shift();
        renderConsole();
    }

    function renderConsole() {
        const consoleEl = document.getElementById('bot-console-output');
        const logCountBadge = document.getElementById('console-log-count');
        if (!consoleEl) return;

        if (logCountBadge) logCountBadge.textContent = botLogs.length;

        const filtered = botLogs.filter(item => {
            if (activeConsoleFilter === 'all') return true;
            if (activeConsoleFilter === 'blue') return item.player === 1;
            if (activeConsoleFilter === 'red') return item.player === 2;
            if (activeConsoleFilter === 'error') return item.type === 'error' || item.type === 'warn';
            return true;
        });

        if (filtered.length === 0) {
            consoleEl.innerHTML = '<div class="terminal-empty">Chưa có log từ Bot. Nhấn "Bắt đầu đấu" để xem nhật ký tính toán!</div>';
            return;
        }

        consoleEl.innerHTML = filtered.map(item => {
            const tagClass = `log-tag-${item.type}`;
            return `
                <div class="terminal-line ${tagClass}">
                    <span class="term-time">[${item.time}]</span>
                    <span class="term-text">${escapeHtml(item.text)}</span>
                    ${item.elapsed ? `<span class="term-elapsed">${item.elapsed}</span>` : ''}
                </div>
            `;
        }).join('');

        consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ===== Win Modal =====

    function showWinModal(wonPlayer, reason, eloOutcome = null) {
        const overlay = document.getElementById('win-overlay');
        const title = document.getElementById('win-title');
        const reasonEl = document.getElementById('win-reason');
        const statsEl = document.getElementById('win-stats');
        const eloBox = document.getElementById('win-elo-box');
        if (!overlay) return;

        if (wonPlayer === 1) {
            title.innerHTML = '🏆 Đội Xanh Chiến Thắng!';
            title.style.color = 'var(--theme-blue)';
        } else if (wonPlayer === 2) {
            title.innerHTML = '🏆 Đội Đỏ Chiến Thắng!';
            title.style.color = 'var(--theme-red)';
        } else {
            title.innerHTML = '🤝 Trận Đấu Hòa!';
            title.style.color = 'var(--theme-muted)';
        }

        if (reasonEl) reasonEl.textContent = reason;
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="win-stat-row">
                    <span>Tổng số nước đi:</span> <strong>${turnCount} nước</strong>
                </div>
                <div class="win-stat-row">
                    <span>Quân Xanh đã ăn:</span> <strong>${capturedByBlue.length} quân</strong>
                </div>
                <div class="win-stat-row">
                    <span>Quân Đỏ đã ăn:</span> <strong>${capturedByRed.length} quân</strong>
                </div>
            `;
        }

        if (eloBox) {
            if (eloOutcome) {
                const bDelta = eloOutcome.blue.delta >= 0 ? `+${eloOutcome.blue.delta}` : `${eloOutcome.blue.delta}`;
                const rDelta = eloOutcome.red.delta >= 0 ? `+${eloOutcome.red.delta}` : `${eloOutcome.red.delta}`;
                const bClass = eloOutcome.blue.delta >= 0 ? 'pos' : 'neg';
                const rClass = eloOutcome.red.delta >= 0 ? 'pos' : 'neg';
                eloBox.innerHTML = `
                    <div class="elo-outcome-card">
                        <div class="elo-player-result">
                            <strong style="color:var(--theme-blue);">🔵 ${escapeHtml(eloOutcome.blue.name)}</strong>
                            <span>${eloOutcome.blue.oldElo} ➔ <strong>${eloOutcome.blue.newElo}</strong></span>
                            <span class="elo-delta-badge ${bClass}">${bDelta} Elo</span>
                        </div>
                        <div style="font-weight:900; font-size:1.1rem; color:var(--theme-border);">VS</div>
                        <div class="elo-player-result">
                            <strong style="color:var(--theme-red);">🔴 ${escapeHtml(eloOutcome.red.name)}</strong>
                            <span>${eloOutcome.red.oldElo} ➔ <strong>${eloOutcome.red.newElo}</strong></span>
                            <span class="elo-delta-badge ${rClass}">${rDelta} Elo</span>
                        </div>
                    </div>
                `;
            } else {
                eloBox.innerHTML = `
                    <div class="elo-outcome-card" style="justify-content:center; color:var(--theme-muted); font-size:0.85rem; font-weight:600;">
                        <span>⚔️ Trận đấu Offline (Đấu tập - Không tính điểm Elo)</span>
                    </div>
                `;
            }
        }

        overlay.style.display = 'flex';
    }

    function hideWinModal() {
        const overlay = document.getElementById('win-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    // ===== Batch Simulation Runner =====

    let isSimulating = false;

    function runBatchSimulation(matchCount = 50) {
        if (isSimulating) return;
        isSimulating = true;

        const simModal = document.getElementById('sim-modal');
        const progressEl = document.getElementById('sim-progress-bar');
        const progressText = document.getElementById('sim-progress-text');
        const blueWinsEl = document.getElementById('sim-blue-wins');
        const redWinsEl = document.getElementById('sim-red-wins');
        const drawsEl = document.getElementById('sim-draws');
        const startSimBtn = document.getElementById('start-sim-btn');

        if (simModal) simModal.style.display = 'flex';
        if (startSimBtn) startSimBtn.disabled = true;

        let blueWins = 0;
        let redWins = 0;
        let draws = 0;
        let blueGoalWins = 0;
        let blueExtinctionWins = 0;
        let redGoalWins = 0;
        let redExtinctionWins = 0;
        let totalTurns = 0;

        let completed = 0;

        function simulateSingleMatch() {
            let simBoard = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
            const { p1, p2 } = getInitialPieces();
            p1.forEach(p => simBoard[p.r][p.c] = { player: 1, type: p.t });
            p2.forEach(p => simBoard[p.r][p.c] = { player: 2, type: p.t });

            let curPlayer = 1;
            let matchTurns = 0;
            const maxTurns = 250;

            const codeBlue = getBotCode(1);
            const codeRed = getBotCode(2);

            let fnBlue, fnRed;
            try {
                fnBlue = new Function('state', 'helpers', 'log', `${codeBlue}\nreturn getNextMove(state, helpers, log);`);
            } catch (e) {
                fnBlue = (state, helpers) => helpers.randomChoice(state.legalMoves);
            }
            try {
                fnRed = new Function('state', 'helpers', 'log', `${codeRed}\nreturn getNextMove(state, helpers, log);`);
            } catch (e) {
                fnRed = (state, helpers) => helpers.randomChoice(state.legalMoves);
            }

            const helpers = {
                canCapture,
                distance: (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)),
                manhattanDistance: (r1, c1, r2, c2) => Math.abs(r1 - r2) + Math.abs(c1 - c2),
                toColumnName,
                toNotation,
                fromNotation,
                cloneBoard,
                simulateMove,
                getLegalMoves: (p, b) => getLegalMoves(p, b),
                checkWin: (b) => checkWin(b),
                randomChoice: (arr) => arr[Math.floor(Math.random() * arr.length)],
                getPieceCounts: (p, b) => getPieceCounts(p, b),
                getPieces: (p, b) => getPieces(p, b)
            };
            const dummyLog = () => {};

            while (matchTurns < maxTurns) {
                const legalMoves = getLegalMoves(curPlayer, simBoard);
                if (legalMoves.length === 0) break;

                const state = {
                    board: cloneBoard(simBoard),
                    myPlayer: curPlayer,
                    opponentPlayer: curPlayer === 1 ? 2 : 1,
                    myGoal: curPlayer === 1 ? { ...BLUE_GOAL } : { ...RED_GOAL },
                    opponentGoal: curPlayer === 1 ? { ...RED_GOAL } : { ...BLUE_GOAL },
                    legalMoves: legalMoves,
                    moveHistory: [],
                    capturedByMe: [],
                    capturedByOpponent: [],
                    myCounts: getPieceCounts(curPlayer, simBoard),
                    opponentCounts: getPieceCounts(curPlayer === 1 ? 2 : 1, simBoard),
                    turnNumber: Math.ceil((matchTurns + 1) / 2)
                };

                let move = null;
                try {
                    const fn = curPlayer === 1 ? fnBlue : fnRed;
                    const res = fn(state, helpers, dummyLog);
                    if (res && res.from && res.to) {
                        move = legalMoves.find(m =>
                            m.from.r === res.from.r && m.from.c === res.from.c &&
                            m.to.r === res.to.r && m.to.c === res.to.c
                        );
                    }
                } catch (e) {
                    move = null;
                }

                if (!move) move = helpers.randomChoice(legalMoves);

                // Execute on simBoard
                simBoard[move.to.r][move.to.c] = simBoard[move.from.r][move.from.c];
                simBoard[move.from.r][move.from.c] = null;
                matchTurns++;

                const winCheck = checkWin(simBoard);
                if (winCheck.winner !== null) {
                    totalTurns += matchTurns;
                    if (winCheck.winner === 1) {
                        blueWins++;
                        if (winCheck.reason.includes(toNotation(BLUE_GOAL.r, BLUE_GOAL.c))) blueGoalWins++;
                    } else if (winCheck.winner === 2) {
                        redWins++;
                        if (winCheck.reason.includes(toNotation(RED_GOAL.r, RED_GOAL.c))) redGoalWins++;
                    } else {
                        draws++;
                    }
                    return;
                }

                curPlayer = curPlayer === 1 ? 2 : 1;
            }

            draws++;
            totalTurns += matchTurns;
        }

        // Run batch in chunks of 5 using requestAnimationFrame / setTimeout
        function runChunk() {
            const chunkSize = Math.min(5, matchCount - completed);
            for (let i = 0; i < chunkSize; i++) {
                simulateSingleMatch();
                completed++;
            }

            const pct = Math.round((completed / matchCount) * 100);
            if (progressEl) progressEl.style.width = `${pct}%`;
            if (progressText) progressText.textContent = `${completed} / ${matchCount} trận (${pct}%)`;
            if (blueWinsEl) blueWinsEl.textContent = `${blueWins} (${Math.round((blueWins / completed) * 100)}%)`;
            if (redWinsEl) redWinsEl.textContent = `${redWins} (${Math.round((redWins / completed) * 100)}%)`;
            if (drawsEl) drawsEl.textContent = `${draws} (${Math.round((draws / completed) * 100)}%)`;

            if (completed < matchCount) {
                setTimeout(runChunk, 15);
            } else {
                isSimulating = false;
                if (startSimBtn) startSimBtn.disabled = false;
                const statsEl = document.getElementById('sim-final-stats');
                if (statsEl) {
                    const blueGoalNotation = toNotation(BLUE_GOAL.r, BLUE_GOAL.c);
                    const redGoalNotation = toNotation(RED_GOAL.r, RED_GOAL.c);
                    statsEl.innerHTML = `
                        <div class="sim-stat-box">
                            <h4>🔵 Đội Xanh: ${Math.round((blueWins / matchCount) * 100)}%</h4>
                            <p>Số trận thắng (chiếm ô ${blueGoalNotation}): <strong>${blueWins}</strong></p>
                        </div>
                        <div class="sim-stat-box">
                            <h4>🔴 Đội Đỏ: ${Math.round((redWins / matchCount) * 100)}%</h4>
                            <p>Số trận thắng (chiếm ô ${redGoalNotation}): <strong>${redWins}</strong></p>
                        </div>
                        <div class="sim-stat-box">
                            <h4>📊 Số nước trung bình: <strong>${Math.round(totalTurns / matchCount)} nước</strong></h4>
                            <p>Hòa / Quá giới hạn: <strong>${draws}</strong></p>
                        </div>
                    `;
                }
            }
        }

        runChunk();
    }

    // ===== Multi-Language Ace Editor & Templates =====

    const MODE_MAP = {
        javascript: 'ace/mode/javascript',
        python: 'ace/mode/python',
        cpp: 'ace/mode/c_cpp'
    };

    function getDefaultCodeForLang(player, lang) {
        const key = `ott_bot_code_${player === 1 ? 'blue' : 'red'}_${lang}`;
        const saved = localStorage.getItem(key);
        // If saved code is invalid or corrupted (e.g. JS function saved under python or cpp), fall back to template
        if (saved && saved.trim()) {
            if ((lang === 'python' || lang === 'cpp') && saved.includes('function getNextMove(')) {
                // Corrupted localStorage with JS code, clear it
                localStorage.removeItem(key);
            } else {
                return saved;
            }
        }
        if (window.MULTI_LANG_TEMPLATES && window.MULTI_LANG_TEMPLATES[lang]) {
            return player === 1 ? window.MULTI_LANG_TEMPLATES[lang].blue : window.MULTI_LANG_TEMPLATES[lang].red;
        }
        return window.BOT_PRESETS.random;
    }

    function initAceEditors() {
        const defaultBlue = getDefaultCodeForLang(1, blueLang);
        const defaultRed = getDefaultCodeForLang(2, redLang);
        const editorTheme = "ace/theme/monokai";

        const blueSel = document.getElementById('blue-lang-select');
        const redSel = document.getElementById('red-lang-select');
        if (blueSel) blueSel.value = blueLang;
        if (redSel) redSel.value = redLang;

        if (window.ace) {
            try {
                editorBlue = window.ace.edit("editor-blue");
                editorBlue.setTheme(editorTheme);
                editorBlue.session.setMode(MODE_MAP[blueLang] || "ace/mode/javascript");
                editorBlue.setValue(defaultBlue, -1);
                editorBlue.setFontSize("13px");
                editorBlue.setShowPrintMargin(false);
                editorBlue.session.setTabSize(4);
                editorBlue.session.setUseSoftTabs(true);
                editorBlue.on('change', () => {
                    localStorage.setItem(`ott_bot_code_blue_${blueLang}`, editorBlue.getValue());
                });

                editorRed = window.ace.edit("editor-red");
                editorRed.setTheme(editorTheme);
                editorRed.session.setMode(MODE_MAP[redLang] || "ace/mode/javascript");
                editorRed.setValue(defaultRed, -1);
                editorRed.setFontSize("13px");
                editorRed.setShowPrintMargin(false);
                editorRed.session.setTabSize(4);
                editorRed.session.setUseSoftTabs(true);
                editorRed.on('change', () => {
                    localStorage.setItem(`ott_bot_code_red_${redLang}`, editorRed.getValue());
                });
            } catch (err) {
                console.warn("Ace init fallback:", err);
                initTextareaFallback();
            }
        } else {
            initTextareaFallback();
        }
    }

    function setEditorLanguage(player, lang) {
        if (player === 1) {
            blueLang = lang;
            localStorage.setItem('ott_blue_lang', lang);
            const sel = document.getElementById('blue-lang-select');
            if (sel) sel.value = lang;
            if (editorBlue) {
                editorBlue.session.setMode(MODE_MAP[lang] || 'ace/mode/javascript');
                const code = getDefaultCodeForLang(1, lang);
                editorBlue.setValue(code, -1);
            }
            const hint = document.getElementById('blue-editor-hint');
            if (hint) {
                if (lang === 'python') hint.innerHTML = 'Lập trình bot Python cho Đội Xanh (nhận state JSON qua <code>stdin</code>, in nước đi ra <code>stdout</code>)';
                else if (lang === 'cpp') hint.innerHTML = 'Lập trình bot C++17 cho Đội Xanh (nhận state JSON qua <code>cin</code>, in nước đi ra <code>cout</code>)';
                else hint.innerHTML = 'Lập trình hàm <code>getNextMove(state, helpers, log)</code> cho Đội Xanh';
            }
        } else {
            redLang = lang;
            localStorage.setItem('ott_red_lang', lang);
            const sel = document.getElementById('red-lang-select');
            if (sel) sel.value = lang;
            if (editorRed) {
                editorRed.session.setMode(MODE_MAP[lang] || 'ace/mode/javascript');
                const code = getDefaultCodeForLang(2, lang);
                editorRed.setValue(code, -1);
            }
            const hint = document.getElementById('red-editor-hint');
            if (hint) {
                if (lang === 'python') hint.innerHTML = 'Lập trình bot Python cho Đội Đỏ (nhận state JSON qua <code>stdin</code>, in nước đi ra <code>stdout</code>)';
                else if (lang === 'cpp') hint.innerHTML = 'Lập trình bot C++17 cho Đội Đỏ (nhận state JSON qua <code>cin</code>, in nước đi ra <code>cout</code>)';
                else hint.innerHTML = 'Lập trình hàm <code>getNextMove(state, helpers, log)</code> cho Đội Đỏ';
            }
        }
    }

    function initTextareaFallback() {
        const elBlue = document.getElementById('editor-blue');
        const elRed = document.getElementById('editor-red');
        const defaultBlue = getDefaultCodeForLang(1, blueLang);
        const defaultRed = getDefaultCodeForLang(2, redLang);

        if (elBlue) {
            elBlue.innerHTML = `<textarea class="fallback-textarea" id="textarea-blue">${escapeHtml(defaultBlue)}</textarea>`;
            document.getElementById('textarea-blue').addEventListener('input', (e) => {
                localStorage.setItem(`ott_bot_code_blue_${blueLang}`, e.target.value);
            });
        }
        if (elRed) {
            elRed.innerHTML = `<textarea class="fallback-textarea" id="textarea-red">${escapeHtml(defaultRed)}</textarea>`;
            document.getElementById('textarea-red').addEventListener('input', (e) => {
                localStorage.setItem(`ott_bot_code_red_${redLang}`, e.target.value);
            });
        }
    }

    function setEditorCode(player, code) {
        if (player === 1) {
            if (editorBlue) editorBlue.setValue(code, -1);
            else {
                const ta = document.getElementById('textarea-blue');
                if (ta) ta.value = code;
            }
            localStorage.setItem(`ott_bot_code_blue_${blueLang}`, code);
        } else {
            if (editorRed) editorRed.setValue(code, -1);
            else {
                const ta = document.getElementById('textarea-red');
                if (ta) ta.value = code;
            }
            localStorage.setItem(`ott_bot_code_red_${redLang}`, code);
        }
    }

    // ===== Theme Management (Dark Mode) =====

    function initTheme() {
        const saved = localStorage.getItem('ott_theme') || 
            (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        setTheme(saved);
    }

    function setTheme(theme) {
        currentTheme = theme;
        localStorage.setItem('ott_theme', theme);
        const root = document.documentElement;
        const btn = document.getElementById('theme-toggle-btn');
        if (theme === 'dark') {
            root.setAttribute('data-theme', 'dark');
            if (btn) btn.innerHTML = '☀️ Ban ngày';
        } else {
            root.removeAttribute('data-theme');
            if (btn) btn.innerHTML = '🌙 Ban đêm';
        }
        if (editorBlue) editorBlue.setTheme('ace/theme/monokai');
        if (editorRed) editorRed.setTheme('ace/theme/monokai');
    }

    function toggleTheme() {
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    }

    // ===== Player Profile & Leaderboard =====

    function initPlayerProfile() {
        if (!window.EloSystem) return;
        let p = window.EloSystem.getCurrentPlayer();
        if (!p) {
            p = window.EloSystem.setCurrentPlayer('Người chơi ' + Math.floor(100 + Math.random() * 900), 'javascript');
        }
        currentPlayerProfile = p;
        updateProfileUI();
        renderLeaderboard();
    }

    function updateProfileUI() {
        if (!currentPlayerProfile) return;
        const nameEl = document.getElementById('header-player-name');
        const eloEl = document.getElementById('header-player-elo');
        const lbName = document.getElementById('lb-user-name');
        const lbElo = document.getElementById('lb-user-elo');
        if (nameEl) nameEl.textContent = currentPlayerProfile.name;
        if (eloEl) eloEl.textContent = currentPlayerProfile.elo;
        if (lbName) lbName.textContent = currentPlayerProfile.name;
        if (lbElo) lbElo.textContent = currentPlayerProfile.elo;
    }

    function showProfileModal() {
        const modal = document.getElementById('player-profile-modal');
        const nameInp = document.getElementById('input-player-name');
        const langSel = document.getElementById('select-preferred-lang');
        const statsBox = document.getElementById('profile-stats-box');
        if (!modal) return;

        if (currentPlayerProfile) {
            if (nameInp) nameInp.value = currentPlayerProfile.name;
            if (langSel) langSel.value = currentPlayerProfile.lang || 'javascript';
            if (statsBox) {
                const wr = currentPlayerProfile.matches > 0 
                    ? Math.round((currentPlayerProfile.wins / currentPlayerProfile.matches) * 100) 
                    : 0;
                statsBox.innerHTML = `
                    <div class="win-stat-row"><span>Điểm Elo hiện tại:</span> <strong style="color:var(--theme-gold); font-size:1.1rem;">${currentPlayerProfile.elo}</strong></div>
                    <div class="win-stat-row"><span>Số trận đã đấu:</span> <strong>${currentPlayerProfile.matches} trận</strong></div>
                    <div class="win-stat-row"><span>Thắng / Thua / Hòa:</span> <strong>${currentPlayerProfile.wins}W - ${currentPlayerProfile.losses}L - ${currentPlayerProfile.draws}D</strong></div>
                    <div class="win-stat-row"><span>Tỉ lệ thắng:</span> <strong>${wr}%</strong></div>
                `;
            }
        }
        modal.style.display = 'flex';
    }

    function hideProfileModal() {
        const modal = document.getElementById('player-profile-modal');
        if (modal) modal.style.display = 'none';
    }

    function savePlayerProfile() {
        const nameInp = document.getElementById('input-player-name');
        const langSel = document.getElementById('select-preferred-lang');
        const name = nameInp ? nameInp.value.trim() : '';
        const lang = langSel ? langSel.value : 'javascript';
        if (name && window.EloSystem) {
            currentPlayerProfile = window.EloSystem.setCurrentPlayer(name, lang);
            updateProfileUI();
            renderLeaderboard();
            hideProfileModal();
        }
    }

    function renderLeaderboard(data) {
        const tbody = document.getElementById('leaderboard-body');
        if (!tbody || !window.EloSystem) return;
        if (data && Array.isArray(data)) {
            window.EloSystem.saveLeaderboard(data);
            if (currentPlayerProfile) {
                const found = data.find(p => p.name.toLowerCase() === currentPlayerProfile.name.toLowerCase());
                if (found) {
                    currentPlayerProfile = { ...currentPlayerProfile, ...found };
                    localStorage.setItem('ott_current_player', JSON.stringify(currentPlayerProfile));
                    updateProfileUI();
                }
            }
        }
        const list = data || window.EloSystem.getLeaderboard();
        list.sort((a, b) => b.elo - a.elo);

        tbody.innerHTML = list.map((item, idx) => {
            const rank = idx + 1;
            let medal = `<span class="rank-badge rank-normal">#${rank}</span>`;
            if (rank === 1) medal = `<span class="rank-badge rank-gold" title="Hạng 1">🥇</span>`;
            else if (rank === 2) medal = `<span class="rank-badge rank-silver" title="Hạng 2">🥈</span>`;
            else if (rank === 3) medal = `<span class="rank-badge rank-bronze" title="Hạng 3">🥉</span>`;

            const isCur = currentPlayerProfile && item.name.toLowerCase() === currentPlayerProfile.name.toLowerCase();
            const curClass = isCur ? 'current-user-row' : '';
            const winRate = item.matches > 0 ? Math.round((item.wins / item.matches) * 100) : 0;
            const lang = (item.lang || 'js').toLowerCase();
            const langClass = lang === 'cpp' ? 'cpp' : (lang === 'py' || lang === 'python' ? 'py' : 'js');

            return `
                <tr class="${curClass}">
                    <td>${medal}</td>
                    <td><strong>${escapeHtml(item.name)}</strong> ${item.isBot ? '🤖' : '👤'}</td>
                    <td><strong class="elo-number">${item.elo}</strong></td>
                    <td><span class="lang-pill ${langClass}">${langClass.toUpperCase()}</span></td>
                    <td>${item.matches}</td>
                    <td>${item.wins}W - ${item.losses}L - ${item.draws}D</td>
                    <td>${winRate}%</td>
                </tr>
            `;
        }).join('');
    }

    // ===== Realtime Online Multiplayer (Socket.io) =====

    // ===== Realtime Online Multiplayer (Socket.io) =====

    function initOnlineSocket() {
        if (typeof io !== 'function') return;
        try {
            socket = io();
            socket.on('connect', () => {
                const btn = document.getElementById('open-online-modal-btn');
                if (btn) btn.classList.add('connected');
            });
            socket.on('leaderboard_data', (data) => {
                renderLeaderboard(data);
            });
            socket.on('room_created', (data) => {
                currentOnlineRoom = data.roomCode;
                myOnlineSlot = data.slot;
                showLobbyView(data.roomCode, data.roomState);
                enterOnlineMode(data.roomCode, data.slot, data.roomState);
            });
            socket.on('room_joined', (data) => {
                currentOnlineRoom = data.roomCode;
                myOnlineSlot = data.slot;
                showLobbyView(data.roomCode, data.roomState);
                enterOnlineMode(data.roomCode, data.slot, data.roomState);
            });
            socket.on('room_updated', (roomState) => {
                updateLobbyState(roomState);
                updateOnlineActiveBar(roomState);
            });
            socket.on('player_submitted', (data) => {
                const isMe = data.player === myOnlineSlot;
                const pName = data.name || (data.player === 'blue' ? 'Đội Xanh' : 'Đội Đỏ');
                if (isMe) {
                    updateStatusTicker("✅ Bạn đã nộp code thành công! Đang chờ đối thủ nộp code...");
                } else {
                    updateStatusTicker(`📢 Đối thủ (${pName}) đã nộp code xong! Đến lượt bạn bấm "Nộp Code" để bắt đầu thi đấu.`);
                    const subText = document.getElementById('oab-status-text');
                    if (subText) subText.textContent = `📢 Đối thủ (${pName}) đã nộp code! Hãy bấm "Nộp Code" để bắt đầu ván đấu.`;
                }
            });
            socket.on('match_preparing', (msg) => {
                const st = document.getElementById('online-sync-status');
                if (st) st.textContent = msg;
                const subText = document.getElementById('oab-status-text');
                if (subText) subText.textContent = msg;
                updateStatusTicker(msg);
                const submitBtn = document.getElementById('online-submit-code-btn');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = '⏳ Đang kiểm tra code...';
                }
            });
            socket.on('match_code_error', (data) => {
                const submitBtn = document.getElementById('online-submit-code-btn');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '📤 Sửa & Nộp Lại Code';
                    submitBtn.classList.remove('submitted');
                }
                const subText = document.getElementById('oab-status-text');
                if (data.player === myOnlineSlot) {
                    alert(`❌ LỖI KIỂM TRA / BIÊN DỊCH CODE CỦA BẠN:\n\n${data.error}\n\nVui lòng kiểm tra lại cú pháp, sửa code và bấm "Nộp Code" lại!`);
                    updateStatusTicker(`❌ Lỗi code của bạn: ${data.error.slice(0, 120)}`);
                    if (subText) subText.textContent = `❌ Code của bạn bị lỗi! Hãy sửa code và bấm "Nộp Code" lại.`;
                    playSound('error');
                } else {
                    updateStatusTicker(`⚠️ Đối thủ (${data.name}) bị lỗi code khi kiểm tra! Đang chờ đối thủ sửa code và nộp lại...`);
                    if (subText) subText.textContent = `⚠️ Đối thủ (${data.name}) bị lỗi code! Đang chờ đối thủ sửa và nộp lại...`;
                }
            });
            socket.on('match_validated', (msg) => {
                const subText = document.getElementById('oab-status-text');
                if (subText) subText.textContent = msg;
                updateStatusTicker(msg);
                const submitBtn = document.getElementById('online-submit-code-btn');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = '⚔️ Bắt đầu thi đấu!';
                }
            });
            socket.on('match_started', (data) => {
                hideOnlineModal();
                isOnlineMatch = true;
                board = data.board;
                currentPlayer = 1;
                turnCount = 1;
                moveHistory = [];
                capturedByBlue = [];
                capturedByRed = [];
                gameOver = false;
                winner = null;
                drawBoard();
                updateTurnIndicator();
                updateMaterialPanels();
                clearMoveLedger();
                updateStatusTicker(`⚔️ Trận đấu Online bắt đầu! ${data.blue.name} (Xanh) vs ${data.red.name} (Đỏ)`);
                const subText = document.getElementById('oab-status-text');
                if (subText) subText.textContent = `⚔️ Trận đấu đang diễn ra trực tiếp!`;
            });
            socket.on('online_move_made', (data) => {
                const m = data.moveRecord;
                board = data.board;
                currentPlayer = data.currentPlayer;
                turnCount = data.turnCount;
                capturedByBlue = data.capturedByBlue;
                capturedByRed = data.capturedByRed;
                lastMove = { fromR: m.from.r, fromC: m.from.c, toR: m.to.r, toC: m.to.c };
                drawBoard();
                updateTurnIndicator();
                updateMaterialPanels();
                appendMoveLedger(m);
                if (m.capture) playSound('capture');
                else playSound('move');
                if (m.log) {
                    addConsoleLog({
                        type: m.player === 1 ? 'blue' : 'red',
                        player: m.player,
                        text: `[Online] ${m.log.slice(0, 150)}`,
                        time: new Date().toLocaleTimeString(),
                        elapsed: m.elapsed
                    });
                }
            });
            socket.on('online_match_finished', (data) => {
                isOnlineMatch = false;
                gameOver = true;
                winner = data.winner;
                winReason = data.reason;
                playSound('win');
                drawBoard();
                updateStatusTicker(data.reason);
                if (data.eloOutcome && data.eloOutcome.updatedLeaderboard) {
                    renderLeaderboard(data.eloOutcome.updatedLeaderboard);
                }
                unlockAllEditors();
                const submitBtn = document.getElementById('online-submit-code-btn');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '📤 Nộp Code Ván Mới';
                    submitBtn.classList.remove('submitted');
                }
                const subText = document.getElementById('oab-status-text');
                if (subText) subText.textContent = `Trận đấu kết thúc! Bạn có thể xem code đối thủ hoặc bấm "Nộp Code" để thi đấu ván mới.`;
                showWinModal(data.winner, data.reason, data.eloOutcome);
            });
            socket.on('rematch_ready', (msg) => {
                resetBattle();
                unlockAllEditors();
                applyOnlineEditorSecurity(myOnlineSlot);
                const submitBtn = document.getElementById('online-submit-code-btn');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '📤 Nộp Code Thi Đấu';
                    submitBtn.classList.remove('submitted');
                }
                const readyBtn = document.getElementById('online-ready-btn');
                if (readyBtn) readyBtn.textContent = '📤 Nộp Code Hiện Tại';
                updateStatusTicker(msg);
                const subText = document.getElementById('oab-status-text');
                if (subText) subText.textContent = msg;
            });
            socket.on('match_error', (err) => {
                alert(err);
                updateStatusTicker(err);
                const st = document.getElementById('online-sync-status');
                if (st) st.textContent = err;
            });
            socket.on('join_error', (err) => {
                alert(err);
            });
        } catch (e) {
            console.warn("Socket.io not reachable (offline mode active):", e);
        }
    }

    function showOnlineModal() {
        const modal = document.getElementById('online-match-modal');
        if (modal) modal.style.display = 'flex';
    }

    function hideOnlineModal() {
        const modal = document.getElementById('online-match-modal');
        if (modal) modal.style.display = 'none';
    }

    function showLobbyView(roomCode, roomState) {
        const createView = document.getElementById('online-view-create');
        const joinView = document.getElementById('online-view-join');
        const lobbyView = document.getElementById('online-room-lobby');
        const nav = document.getElementById('online-tab-nav');
        const pinLabel = document.getElementById('room-pin-label');

        if (createView) createView.style.display = 'none';
        if (joinView) joinView.style.display = 'none';
        if (nav) nav.style.display = 'none';
        if (lobbyView) lobbyView.style.display = 'flex';
        if (pinLabel) pinLabel.textContent = roomCode;

        updateLobbyState(roomState);
    }

    function enterOnlineMode(roomCode, slot, roomState) {
        const oab = document.getElementById('online-active-bar');
        if (oab) oab.style.display = 'flex';

        const codeEl = document.getElementById('oab-room-code');
        if (codeEl) codeEl.textContent = roomCode;

        const roleEl = document.getElementById('oab-my-role');
        if (roleEl) {
            roleEl.textContent = slot === 'blue' ? '🔵 Đội Xanh (Blue)' : '🔴 Đội Đỏ (Red)';
            roleEl.style.color = slot === 'blue' ? '#1d4ed8' : '#b91c1c';
        }

        // Switch to the player's editor tab
        const targetTab = slot === 'blue' ? 'tab-blue-bot' : 'tab-red-bot';
        document.querySelectorAll('.studio-tab-btn').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.studio-tab-pane').forEach(p => p.classList.remove('active'));
        const tabBtn = document.querySelector(`.studio-tab-btn[data-tab="${targetTab}"]`);
        if (tabBtn) tabBtn.classList.add('active');
        const pane = document.getElementById(targetTab);
        if (pane) pane.classList.add('active');
        if (slot === 'blue' && editorBlue) editorBlue.resize();
        if (slot === 'red' && editorRed) editorRed.resize();

        // Apply opponent editor lock overlay to protect strategy
        applyOnlineEditorSecurity(slot);

        // Disable offline controls
        const startBtn = document.getElementById('battle-start-btn');
        const stepBtn = document.getElementById('battle-step-btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.title = 'Đang trong phòng đấu online. Hãy bấm "Nộp Code" để thi đấu!';
        }
        if (stepBtn) stepBtn.disabled = true;

        // Reset submit button state
        const submitBtn = document.getElementById('online-submit-code-btn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '📤 Nộp Code Thi Đấu';
            submitBtn.classList.remove('submitted');
        }

        updateOnlineActiveBar(roomState);
        updateStatusTicker(`🌐 Đã kết nối phòng ${roomCode}! Hãy chỉnh sửa code bot của bạn và bấm "Nộp Code" khi hoàn tất.`);
    }

    function applyOnlineEditorSecurity(mySlot) {
        unlockAllEditors();
        if (mySlot === 'blue') {
            if (editorBlue) editorBlue.setReadOnly(false);
            if (editorRed) editorRed.setReadOnly(true);
            const redContainer = document.getElementById('editor-red');
            if (redContainer && !document.getElementById('red-editor-lock')) {
                const overlay = document.createElement('div');
                overlay.className = 'editor-locked-overlay';
                overlay.id = 'red-editor-lock';
                overlay.innerHTML = `
                    <div class="editor-locked-icon">🔒</div>
                    <div class="editor-locked-title">BẢO MẬT CODE ĐỐI THỦ</div>
                    <div class="editor-locked-desc">Code của Đội Đỏ (Đối thủ) được giữ bí mật trong thời gian viết code. Sau khi cả 2 nộp code và bắt đầu đấu, bạn sẽ thấy kết quả thi đấu!</div>
                `;
                redContainer.style.position = 'relative';
                redContainer.appendChild(overlay);
            }
        } else if (mySlot === 'red') {
            if (editorRed) editorRed.setReadOnly(false);
            if (editorBlue) editorBlue.setReadOnly(true);
            const blueContainer = document.getElementById('editor-blue');
            if (blueContainer && !document.getElementById('blue-editor-lock')) {
                const overlay = document.createElement('div');
                overlay.className = 'editor-locked-overlay';
                overlay.id = 'blue-editor-lock';
                overlay.innerHTML = `
                    <div class="editor-locked-icon">🔒</div>
                    <div class="editor-locked-title">BẢO MẬT CODE ĐỐI THỦ</div>
                    <div class="editor-locked-desc">Code của Đội Xanh (Đối thủ) được giữ bí mật trong thời gian viết code. Sau khi cả 2 nộp code và bắt đầu đấu, bạn sẽ thấy kết quả thi đấu!</div>
                `;
                blueContainer.style.position = 'relative';
                blueContainer.appendChild(overlay);
            }
        }
    }

    function unlockAllEditors() {
        if (editorBlue) editorBlue.setReadOnly(false);
        if (editorRed) editorRed.setReadOnly(false);
        const l1 = document.getElementById('red-editor-lock');
        if (l1) l1.remove();
        const l2 = document.getElementById('blue-editor-lock');
        if (l2) l2.remove();
    }

    function updateOnlineActiveBar(roomState) {
        if (!roomState) return;
        const bStatus = document.getElementById('oab-blue-status');
        const rStatus = document.getElementById('oab-red-status');

        if (bStatus) {
            if (roomState.blue) {
                if (roomState.blue.ready) {
                    bStatus.textContent = `🔵 ${roomState.blue.name}: ĐÃ NỘP ✓`;
                    bStatus.className = 'oab-pill ready';
                } else {
                    bStatus.textContent = `🔵 ${roomState.blue.name}: Đang viết code...`;
                    bStatus.className = 'oab-pill waiting';
                }
            } else {
                bStatus.textContent = '🔵 Xanh: Chờ người chơi...';
                bStatus.className = 'oab-pill waiting';
            }
        }

        if (rStatus) {
            if (roomState.red) {
                if (roomState.red.ready) {
                    rStatus.textContent = `🔴 ${roomState.red.name}: ĐÃ NỘP ✓`;
                    rStatus.className = 'oab-pill ready';
                } else {
                    rStatus.textContent = `🔴 ${roomState.red.name}: Đang viết code...`;
                    rStatus.className = 'oab-pill waiting';
                }
            } else {
                rStatus.textContent = '🔴 Đỏ: Chờ người chơi...';
                rStatus.className = 'oab-pill waiting';
            }
        }
    }

    function submitOnlineCode() {
        if (!socket || !currentOnlineRoom || !myOnlineSlot) {
            alert("Bạn chưa tham gia phòng online nào!");
            return;
        }

        const code = myOnlineSlot === 'blue'
            ? (editorBlue ? editorBlue.getValue() : '')
            : (editorRed ? editorRed.getValue() : '');

        const lang = myOnlineSlot === 'blue' ? blueLang : redLang;
        const name = currentPlayerProfile ? currentPlayerProfile.name : 'Người chơi';

        socket.emit('player_ready', { code, lang, name });

        const submitBtn = document.getElementById('online-submit-code-btn');
        if (submitBtn) {
            submitBtn.textContent = '🔄 Cập Nhật & Nộp Lại Code';
            submitBtn.classList.add('submitted');
        }

        const readyBtn = document.getElementById('online-ready-btn');
        if (readyBtn) {
            readyBtn.textContent = '🔄 Cập Nhật & Nộp Lại Code';
        }

        const subText = document.getElementById('oab-status-text');
        if (subText) subText.textContent = '✅ Bạn đã nộp code! Đang chờ đối thủ nộp code...';

        updateStatusTicker('✅ Bạn đã nộp code thành công! Trận đấu sẽ tự động kiểm tra code và chạy khi đối thủ cũng nộp.');
        playSound('move');
    }

    function exitOnlineRoom() {
        if (socket) socket.emit('leave_room');
        currentOnlineRoom = null;
        myOnlineSlot = null;
        isOnlineMatch = false;

        const oab = document.getElementById('online-active-bar');
        if (oab) oab.style.display = 'none';

        const lobby = document.getElementById('online-room-lobby');
        const nav = document.getElementById('online-tab-nav');
        const createView = document.getElementById('online-view-create');
        if (lobby) lobby.style.display = 'none';
        if (nav) nav.style.display = 'flex';
        if (createView) createView.style.display = 'block';

        unlockAllEditors();

        const startBtn = document.getElementById('battle-start-btn');
        const stepBtn = document.getElementById('battle-step-btn');
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.title = '';
        }
        if (stepBtn) stepBtn.disabled = false;

        hideOnlineModal();
        updateStatusTicker("Đã rời phòng online. Quay lại chế độ ngoại tuyến.");
    }

    function updateLobbyState(roomState) {
        if (!roomState) return;
        const bName = document.getElementById('lobby-blue-name');
        const bLang = document.getElementById('lobby-blue-lang');
        const bStatus = document.getElementById('lobby-blue-status');

        const rName = document.getElementById('lobby-red-name');
        const rLang = document.getElementById('lobby-red-lang');
        const rStatus = document.getElementById('lobby-red-status');

        if (roomState.blue) {
            if (bName) bName.textContent = roomState.blue.name;
            if (bLang) {
                bLang.textContent = (roomState.blue.lang || 'js').toUpperCase();
                bLang.className = `lang-pill ${roomState.blue.lang}`;
            }
            if (bStatus) {
                bStatus.textContent = roomState.blue.ready ? '✓ Đã nộp code' : 'Chưa nộp code';
                bStatus.className = `slot-ready-tag ${roomState.blue.ready ? 'ready' : 'waiting'}`;
            }
        } else {
            if (bName) bName.textContent = 'Đang chờ người chơi...';
            if (bStatus) { bStatus.textContent = 'Trống'; bStatus.className = 'slot-ready-tag waiting'; }
        }

        if (roomState.red) {
            if (rName) rName.textContent = roomState.red.name;
            if (rLang) {
                rLang.textContent = (roomState.red.lang || 'js').toUpperCase();
                rLang.className = `lang-pill ${roomState.red.lang}`;
            }
            if (rStatus) {
                rStatus.textContent = roomState.red.ready ? '✓ Đã nộp code' : 'Chưa nộp code';
                rStatus.className = `slot-ready-tag ${roomState.red.ready ? 'ready' : 'waiting'}`;
            }
        } else {
            if (rName) rName.textContent = 'Đang chờ người chơi...';
            if (rStatus) { rStatus.textContent = 'Trống'; rStatus.className = 'slot-ready-tag waiting'; }
        }
    }

    // ===== UI Event Binding =====

    function setupEventListeners() {
        // Battle Control Buttons
        const startBtn = document.getElementById('battle-start-btn');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                if (isRunning && !isPaused) pauseBattle();
                else startBattle();
            });
        }

        const stepBtn = document.getElementById('battle-step-btn');
        if (stepBtn) {
            stepBtn.addEventListener('click', () => {
                pauseBattle();
                stepBattle();
            });
        }

        const resetBtn = document.getElementById('battle-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', resetBattle);
        }

        // Speed Selector
        const speedSel = document.getElementById('battle-speed-select');
        if (speedSel) {
            speedSel.addEventListener('change', (e) => {
                battleSpeed = parseInt(e.target.value, 10);
            });
        }

        // Sound Mute Toggle
        const soundBtn = document.getElementById('sound-toggle-btn');
        if (soundBtn) {
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                soundBtn.textContent = soundEnabled ? '🔊 Âm thanh' : '🔇 Tắt tiếng';
                localStorage.setItem('ott_sound_enabled', soundEnabled ? '1' : '0');
            });
            const savedSound = localStorage.getItem('ott_sound_enabled');
            if (savedSound === '0') {
                soundEnabled = false;
                soundBtn.textContent = '🔇 Tắt tiếng';
            }
        }

        // Controller Selectors
        const blueCtrl = document.getElementById('blue-controller-select');
        const redCtrl = document.getElementById('red-controller-select');

        if (blueCtrl) {
            blueCtrl.addEventListener('change', (e) => {
                controllers.blue = e.target.value;
                updateRoleUI();
            });
        }
        if (redCtrl) {
            redCtrl.addEventListener('change', (e) => {
                controllers.red = e.target.value;
                updateRoleUI();
            });
        }

        // Quick Presets (Bot vs Bot, Human vs Bot, Bot vs Human)
        document.querySelectorAll('.preset-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                document.querySelectorAll('.preset-mode-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');

                if (mode === 'bot-vs-bot') {
                    controllers.blue = 'custom';
                    controllers.red = 'tactical';
                } else if (mode === 'human-vs-bot') {
                    controllers.blue = 'human';
                    controllers.red = 'tactical';
                } else if (mode === 'bot-vs-bot-mirror') {
                    controllers.blue = 'custom';
                    controllers.red = 'custom';
                }

                if (blueCtrl) blueCtrl.value = controllers.blue;
                if (redCtrl) redCtrl.value = controllers.red;
                updateRoleUI();
                resetBattle();
            });
        });

        // Studio Tabs
        document.querySelectorAll('.studio-tab-btn').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const targetId = e.currentTarget.dataset.tab;
                document.querySelectorAll('.studio-tab-btn').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.studio-tab-pane').forEach(p => p.classList.remove('active'));

                e.currentTarget.classList.add('active');
                const pane = document.getElementById(targetId);
                if (pane) pane.classList.add('active');

                // Resize Ace when tab becomes visible
                if (targetId === 'tab-blue-bot' && editorBlue) editorBlue.resize();
                if (targetId === 'tab-red-bot' && editorRed) editorRed.resize();
            });
        });

        // Template Loaders
        const blueTemplateSel = document.getElementById('template-select-blue');
        if (blueTemplateSel) {
            blueTemplateSel.addEventListener('change', (e) => {
                const key = e.target.value;
                if (key) {
                    let codeToLoad = null;
                    if (blueLang === 'python' || blueLang === 'cpp') {
                        if (key === 'starterBlue') {
                            codeToLoad = window.MULTI_LANG_TEMPLATES?.[blueLang]?.blue;
                        } else {
                            alert(`Mẫu "${key}" chỉ có phiên bản JavaScript. Để sử dụng mẫu này, vui lòng chuyển ngôn ngữ sang JavaScript.`);
                        }
                    } else if (window.BOT_PRESETS && window.BOT_PRESETS[key]) {
                        codeToLoad = window.BOT_PRESETS[key];
                    }

                    if (codeToLoad) {
                        if (confirm("Tải mẫu bot này vào khung code Đội Xanh? Code hiện tại sẽ được thay thế.")) {
                            setEditorCode(1, codeToLoad);
                        }
                    }
                }
                blueTemplateSel.value = "";
            });
        }

        const redTemplateSel = document.getElementById('template-select-red');
        if (redTemplateSel) {
            redTemplateSel.addEventListener('change', (e) => {
                const key = e.target.value;
                if (key) {
                    let codeToLoad = null;
                    if (redLang === 'python' || redLang === 'cpp') {
                        if (key === 'starterRed') {
                            codeToLoad = window.MULTI_LANG_TEMPLATES?.[redLang]?.red;
                        } else {
                            alert(`Mẫu "${key}" chỉ có phiên bản JavaScript. Để sử dụng mẫu này, vui lòng chuyển ngôn ngữ sang JavaScript.`);
                        }
                    } else if (window.BOT_PRESETS && window.BOT_PRESETS[key]) {
                        codeToLoad = window.BOT_PRESETS[key];
                    }

                    if (codeToLoad) {
                        if (confirm("Tải mẫu bot này vào khung code Đội Đỏ? Code hiện tại sẽ được thay thế.")) {
                            setEditorCode(2, codeToLoad);
                        }
                    }
                }
                redTemplateSel.value = "";
            });
        }

        // Copy Code Buttons
        const copyBlue = document.getElementById('copy-blue-btn');
        if (copyBlue) {
            copyBlue.addEventListener('click', () => {
                const code = editorBlue ? editorBlue.getValue() : document.getElementById('textarea-blue')?.value || '';
                navigator.clipboard.writeText(code).then(() => alert("Đã sao chép code Đội Xanh!"));
            });
        }
        const copyRed = document.getElementById('copy-red-btn');
        if (copyRed) {
            copyRed.addEventListener('click', () => {
                const code = editorRed ? editorRed.getValue() : document.getElementById('textarea-red')?.value || '';
                navigator.clipboard.writeText(code).then(() => alert("Đã sao chép code Đội Đỏ!"));
            });
        }

        // Reset Template Buttons
        const resetBlue = document.getElementById('reset-blue-btn');
        if (resetBlue) {
            resetBlue.addEventListener('click', () => {
                if (confirm(`Khôi phục code Đội Xanh (${blueLang.toUpperCase()}) về mẫu mặc định?`)) {
                    localStorage.removeItem(`ott_bot_code_blue_${blueLang}`);
                    const defaultCode = getDefaultCodeForLang(1, blueLang);
                    setEditorCode(1, defaultCode);
                }
            });
        }
        const resetRed = document.getElementById('reset-red-btn');
        if (resetRed) {
            resetRed.addEventListener('click', () => {
                if (confirm(`Khôi phục code Đội Đỏ (${redLang.toUpperCase()}) về mẫu mặc định?`)) {
                    localStorage.removeItem(`ott_bot_code_red_${redLang}`);
                    const defaultCode = getDefaultCodeForLang(2, redLang);
                    setEditorCode(2, defaultCode);
                }
            });
        }

        // Theme Toggle Button
        const themeBtn = document.getElementById('theme-toggle-btn');
        if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

        // Profile Modal Listeners
        const profileBtn = document.getElementById('profile-open-btn');
        if (profileBtn) profileBtn.addEventListener('click', showProfileModal);
        const closeProfileBtn = document.getElementById('close-profile-modal-btn');
        if (closeProfileBtn) closeProfileBtn.addEventListener('click', hideProfileModal);
        const saveProfileBtn = document.getElementById('save-profile-btn');
        if (saveProfileBtn) saveProfileBtn.addEventListener('click', savePlayerProfile);

        // Language Selectors
        const blueLangSel = document.getElementById('blue-lang-select');
        if (blueLangSel) {
            blueLangSel.addEventListener('change', (e) => setEditorLanguage(1, e.target.value));
        }
        const redLangSel = document.getElementById('red-lang-select');
        if (redLangSel) {
            redLangSel.addEventListener('change', (e) => setEditorLanguage(2, e.target.value));
        }

        // Online Multiplayer Modal & Actions
        const openOnlineBtn = document.getElementById('open-online-modal-btn');
        if (openOnlineBtn) openOnlineBtn.addEventListener('click', showOnlineModal);
        const closeOnlineBtn = document.getElementById('close-online-modal-btn');
        if (closeOnlineBtn) closeOnlineBtn.addEventListener('click', hideOnlineModal);

        document.querySelectorAll('#online-tab-nav .online-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#online-tab-nav .online-tab-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const tabId = e.currentTarget.dataset.tab;
                const createView = document.getElementById('online-view-create');
                const joinView = document.getElementById('online-view-join');
                if (createView) createView.style.display = tabId === 'online-view-create' ? 'block' : 'none';
                if (joinView) joinView.style.display = tabId === 'online-view-join' ? 'block' : 'none';
            });
        });

        const createRoomBtn = document.getElementById('online-create-room-btn');
        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => {
                if (!socket || !socket.connected) {
                    alert("Chưa kết nối được với Server! Hãy chạy 'npm start' trong terminal.");
                    return;
                }
                socket.emit('create_room', {
                    playerName: currentPlayerProfile ? currentPlayerProfile.name : 'Người chơi',
                    lang: blueLang
                });
            });
        }

        const joinRoomBtn = document.getElementById('online-join-room-btn');
        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', () => {
                if (!socket || !socket.connected) {
                    alert("Chưa kết nối được với Server! Hãy chạy 'npm start' trong terminal.");
                    return;
                }
                const inp = document.getElementById('online-join-code-input');
                const code = inp ? inp.value.trim() : '';
                if (!code) {
                    alert("Vui lòng nhập mã phòng!");
                    return;
                }
                socket.emit('join_room', {
                    roomCode: code,
                    playerName: currentPlayerProfile ? currentPlayerProfile.name : 'Người chơi',
                    lang: redLang
                });
            });
        }

        // Online Active Bar Buttons
        const onlineSubmitBtn = document.getElementById('online-submit-code-btn');
        if (onlineSubmitBtn) onlineSubmitBtn.addEventListener('click', submitOnlineCode);

        const onlineExitBtn = document.getElementById('online-exit-room-btn');
        if (onlineExitBtn) onlineExitBtn.addEventListener('click', exitOnlineRoom);

        const oabCopyBtn = document.getElementById('oab-copy-btn');
        if (oabCopyBtn) {
            oabCopyBtn.addEventListener('click', () => {
                if (currentOnlineRoom) {
                    navigator.clipboard.writeText(currentOnlineRoom).then(() => {
                        alert(`Đã sao chép mã phòng: ${currentOnlineRoom}`);
                    });
                }
            });
        }

        const onlineGoCodeBtn = document.getElementById('online-go-code-btn');
        if (onlineGoCodeBtn) {
            onlineGoCodeBtn.addEventListener('click', () => {
                hideOnlineModal();
            });
        }

        const onlineReadyBtn = document.getElementById('online-ready-btn');
        if (onlineReadyBtn) onlineReadyBtn.addEventListener('click', submitOnlineCode);

        const leaveRoomBtn = document.getElementById('online-leave-room-btn');
        if (leaveRoomBtn) leaveRoomBtn.addEventListener('click', exitOnlineRoom);

        // Export & Import Bot Code
        const exportBlue = document.getElementById('export-blue-btn');
        if (exportBlue) {
            exportBlue.addEventListener('click', () => {
                const code = editorBlue ? editorBlue.getValue() : '';
                const ext = blueLang === 'cpp' ? 'cpp' : (blueLang === 'python' ? 'py' : 'js');
                downloadFile(`BlueBot.${ext}`, code);
            });
        }
        const exportRed = document.getElementById('export-red-btn');
        if (exportRed) {
            exportRed.addEventListener('click', () => {
                const code = editorRed ? editorRed.getValue() : '';
                const ext = redLang === 'cpp' ? 'cpp' : (redLang === 'python' ? 'py' : 'js');
                downloadFile(`RedBot.${ext}`, code);
            });
        }

        const importBlue = document.getElementById('import-blue-file');
        if (importBlue) {
            importBlue.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const name = file.name.toLowerCase();
                    if (name.endsWith('.cpp')) setEditorLanguage(1, 'cpp');
                    else if (name.endsWith('.py')) setEditorLanguage(1, 'python');
                    else if (name.endsWith('.js')) setEditorLanguage(1, 'javascript');

                    const reader = new FileReader();
                    reader.onload = (evt) => setEditorCode(1, evt.target.result);
                    reader.readAsText(file);
                }
            });
        }
        const importRed = document.getElementById('import-red-file');
        if (importRed) {
            importRed.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const name = file.name.toLowerCase();
                    if (name.endsWith('.cpp')) setEditorLanguage(2, 'cpp');
                    else if (name.endsWith('.py')) setEditorLanguage(2, 'python');
                    else if (name.endsWith('.js')) setEditorLanguage(2, 'javascript');

                    const reader = new FileReader();
                    reader.onload = (evt) => setEditorCode(2, evt.target.result);
                    reader.readAsText(file);
                }
            });
        }

        // Console Filters & Clear
        document.querySelectorAll('.console-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.console-filter-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                activeConsoleFilter = e.currentTarget.dataset.filter;
                renderConsole();
            });
        });

        const clearConsoleBtn = document.getElementById('clear-console-btn');
        if (clearConsoleBtn) {
            clearConsoleBtn.addEventListener('click', () => {
                botLogs = [];
                renderConsole();
            });
        }

        // Benchmark Modal Trigger
        const benchBtn = document.getElementById('open-benchmark-btn');
        const benchModal = document.getElementById('sim-modal');
        const closeBenchBtn = document.getElementById('close-sim-btn');
        const startSimBtn = document.getElementById('start-sim-btn');

        if (benchBtn) {
            benchBtn.addEventListener('click', () => {
                if (benchModal) benchModal.style.display = 'flex';
            });
        }
        if (closeBenchBtn) {
            closeBenchBtn.addEventListener('click', () => {
                if (benchModal) benchModal.style.display = 'none';
            });
        }
        if (startSimBtn) {
            startSimBtn.addEventListener('click', () => {
                const countSel = document.getElementById('sim-matches-count');
                const count = countSel ? parseInt(countSel.value, 10) : 50;
                runBatchSimulation(count);
            });
        }

        // Win Modal Reset & Online Rematch
        const winDismiss = document.querySelector('.win-dismiss');
        if (winDismiss) {
            winDismiss.addEventListener('click', () => {
                if (currentOnlineRoom && socket) {
                    socket.emit('request_rematch');
                    hideWinModal();
                } else {
                    resetBattle();
                }
            });
        }
    }

    function downloadFile(filename, text) {
        const element = document.createElement('a');
        element.setAttribute('href', 'data:text/javascript;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }

    function updateRoleUI() {
        const blueLabel = document.getElementById('blue-name-label');
        const redLabel = document.getElementById('red-name-label');
        if (blueLabel) {
            blueLabel.textContent = `Đội Xanh (${getControllerTitle(controllers.blue)})`;
        }
        if (redLabel) {
            redLabel.textContent = `Đội Đỏ (${getControllerTitle(controllers.red)})`;
        }
        const blueGoalEl = document.getElementById('blue-goal-label');
        const redGoalEl = document.getElementById('red-goal-label');
        if (blueGoalEl) {
            blueGoalEl.textContent = toNotation(BLUE_GOAL.r, BLUE_GOAL.c);
        }
        if (redGoalEl) {
            redGoalEl.textContent = toNotation(RED_GOAL.r, RED_GOAL.c);
        }
    }

    function getControllerTitle(ctrl) {
        switch (ctrl) {
            case 'custom': return 'Code Bot';
            case 'human': return 'Người chơi';
            case 'random': return 'Random AI';
            case 'rusher': return 'Rusher AI';
            case 'hunter': return 'Hunter AI';
            case 'tactical': return 'Tactical AI';
            default: return 'Bot';
        }
    }

    // ===== Dynamic UI Generation from GameConfig =====

    function renderRulesRibbon() {
        const ribbon = document.getElementById('rules-ribbon');
        if (!ribbon) return;
        const rules = [];
        for (const [typeId, info] of Object.entries(GameConfig.pieceTypes)) {
            for (const beatenId of info.beats) {
                const beatenInfo = GameConfig.pieceTypes[beatenId];
                if (beatenInfo) {
                    rules.push(`<span>${info.emoji} <strong>${info.name.split(' (')[0]}</strong> ăn ${beatenInfo.emoji} <strong>${beatenInfo.name.split(' (')[0]}</strong></span>`);
                }
            }
        }
        ribbon.innerHTML = rules.join('<span class="rule-divider">•</span>');
    }

    function renderBoardLabels() {
        const root = document.documentElement;
        const maxDim = Math.max(ROWS, COLS);
        const cellSizeVal = `calc(var(--board-max-size) / ${maxDim})`;
        const boardWidthVal = `calc(${cellSizeVal} * ${COLS})`;
        const boardHeightVal = `calc(${cellSizeVal} * ${ROWS})`;

        root.style.setProperty('--board-cols', COLS);
        root.style.setProperty('--board-rows', ROWS);
        root.style.setProperty('--cell-size', cellSizeVal);
        root.style.setProperty('--board-width', boardWidthVal);
        root.style.setProperty('--board-height', boardHeightVal);

        const viewportEl = document.querySelector('.board-viewport');
        if (viewportEl) {
            viewportEl.style.gridTemplateColumns = `24px ${boardWidthVal}`;
            viewportEl.style.gridTemplateRows = `${boardHeightVal} 24px`;
        }

        // Update rank labels (row numbers)
        const ranksEl = document.getElementById('ranks');
        if (ranksEl) {
            ranksEl.innerHTML = '';
            ranksEl.style.height = boardHeightVal;
            ranksEl.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
            for (let r = 0; r < ROWS; r++) {
                const label = document.createElement('div');
                label.classList.add('label');
                label.textContent = ROWS - r;
                ranksEl.appendChild(label);
            }
        }

        // Update file labels (column letters)
        const filesEl = document.getElementById('files');
        if (filesEl) {
            filesEl.innerHTML = '';
            filesEl.style.width = boardWidthVal;
            filesEl.style.height = '24px';
            filesEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
            for (let c = 0; c < COLS; c++) {
                const label = document.createElement('div');
                label.classList.add('label');
                label.textContent = toColumnName(c);
                filesEl.appendChild(label);
            }
        }

        // Update CSS grid to match board dimensions
        const boardEl = document.getElementById('board');
        if (boardEl) {
            boardEl.style.width = boardWidthVal;
            boardEl.style.height = boardHeightVal;
            boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
            boardEl.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
        }
    }

    // ===== App Startup =====

    function init() {
        renderBoardLabels();
        renderRulesRibbon();
        initTheme();
        initBoard();
        initAceEditors();
        initPlayerProfile();
        drawBoard();
        updateTurnIndicator();
        updateMaterialPanels();
        updateBattleButtons();
        updateRoleUI();
        setupEventListeners();
        initOnlineSocket();
        renderConsole();
        updateStatusTicker("Sẵn sàng! Lập trình bot và bấm 'Bắt đầu đấu'.");
    }

    // Auto-init on DOM loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose global for debugging if needed
    window.OTTArena = {
        GameConfig,
        toColumnName,
        toNotation,
        fromNotation,
        initBoard,
        startBattle,
        pauseBattle,
        resetBattle,
        stepBattle,
        executeMove,
        getLegalMoves,
        checkWin,
        runBatchSimulation
    };

})();
