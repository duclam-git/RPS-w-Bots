// ===== OTTv2 Code Arena - Realtime Multiplayer & Multi-Language Server =====

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const runner = require('./runner');
const storage = require('./storage');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

// Direct API endpoint to run a bot move (used in local mode for Python & C++)
app.post('/api/run-bot-move', async (req, res) => {
    try {
        const { botId, lang, code, state } = req.body;
        if (!lang || !code || !state) {
            return res.status(400).json({ error: 'Thiếu thông số lang, code hoặc state' });
        }
        const prep = await runner.prepareBot(botId || 'local_bot', lang, code);
        if (!prep.success) {
            return res.json({ success: false, error: prep.error });
        }
        const result = await runner.executeBotMove(prep.botHandler, state, 2500);
        runner.cleanupBot(prep.botHandler);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Game Rules & Configurations (mirrors logic.js)
const ROWS = 9;
const COLS = 9;
const BLUE_GOAL = { r: 0, c: 8 };
const RED_GOAL = { r: 8, c: 0 };
const BEATS = {
    rock: ['scissors'],
    paper: ['rock'],
    scissors: ['paper']
};

function canCapture(a, b) {
    return BEATS[a] && BEATS[a].includes(b);
}

function getInitialPieces() {
    return {
        p1: [
            { r: 4, c: 1, t: 'paper' },
            { r: 4, c: 2, t: 'scissors' },
            { r: 5, c: 1, t: 'rock' },
            { r: 5, c: 2, t: 'paper' },
            { r: 5, c: 3, t: 'scissors' },
            { r: 6, c: 2, t: 'rock' },
            { r: 6, c: 3, t: 'paper' },
            { r: 6, c: 4, t: 'scissors' },
            { r: 7, c: 3, t: 'rock' },
            { r: 7, c: 4, t: 'paper' }
        ],
        p2: [
            { r: 4, c: 6, t: 'scissors' },
            { r: 4, c: 7, t: 'paper' },
            { r: 3, c: 5, t: 'scissors' },
            { r: 3, c: 6, t: 'paper' },
            { r: 3, c: 7, t: 'rock' },
            { r: 2, c: 4, t: 'scissors' },
            { r: 2, c: 5, t: 'paper' },
            { r: 2, c: 6, t: 'rock' },
            { r: 1, c: 4, t: 'paper' },
            { r: 1, c: 5, t: 'rock' }
        ]
    };
}

function createInitialBoard() {
    const b = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
    const { p1, p2 } = getInitialPieces();
    p1.forEach(p => b[p.r][p.c] = { player: 1, type: p.t });
    p2.forEach(p => b[p.r][p.c] = { player: 2, type: p.t });
    return b;
}

function toNotation(r, c) {
    const colName = String.fromCharCode(65 + c);
    return `${colName}${ROWS - r}`;
}

function getLegalMoves(player, board) {
    const moves = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = board[r][c];
            if (p && p.player === player) {
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                            const target = board[nr][nc];
                            let valid = false;
                            if (!target) valid = true;
                            else if (target.player !== player && canCapture(p.type, target.type)) valid = true;

                            if (valid) {
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
    }
    return moves;
}

function checkWin(board) {
    const atBlueGoal = board[BLUE_GOAL.r][BLUE_GOAL.c];
    if (atBlueGoal && atBlueGoal.player === 1) {
        return { winner: 1, reason: `Đội Xanh đã chiếm ô đích ${toNotation(BLUE_GOAL.r, BLUE_GOAL.c)}!` };
    }
    const atRedGoal = board[RED_GOAL.r][RED_GOAL.c];
    if (atRedGoal && atRedGoal.player === 2) {
        return { winner: 2, reason: `Đội Đỏ đã chiếm ô đích ${toNotation(RED_GOAL.r, RED_GOAL.c)}!` };
    }

    let count1 = 0, count2 = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = board[r][c];
            if (p) {
                if (p.player === 1) count1++;
                else count2++;
            }
        }
    }
    if (count1 === 0) return { winner: 2, reason: 'Đội Xanh đã bị bắt hết toàn bộ quân!' };
    if (count2 === 0) return { winner: 1, reason: 'Đội Đỏ đã bị bắt hết toàn bộ quân!' };

    const moves1 = getLegalMoves(1, board);
    const moves2 = getLegalMoves(2, board);
    if (moves1.length === 0 && moves2.length === 0) return { winner: 'draw', reason: 'Cả hai đội đều hết nước đi (Hòa)!' };
    if (moves1.length === 0) return { winner: 2, reason: 'Đội Xanh không còn nước đi hợp lệ!' };
    if (moves2.length === 0) return { winner: 1, reason: 'Đội Đỏ không còn nước đi hợp lệ!' };

    return { winner: null, reason: '' };
}

// Room Management
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'OTT-';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

io.on('connection', (socket) => {
    // Send current leaderboard
    socket.emit('leaderboard_data', storage.getLeaderboard());

    // 1. Create Room
    socket.on('create_room', ({ playerName, lang }) => {
        let roomCode = generateRoomCode();
        while (rooms.has(roomCode)) {
            roomCode = generateRoomCode();
        }

        const room = {
            code: roomCode,
            hostId: socket.id,
            blue: {
                socketId: socket.id,
                name: playerName || 'Người chơi 1',
                lang: lang || 'javascript',
                code: '',
                ready: false,
                handler: null
            },
            red: null,
            spectators: [],
            gameActive: false,
            board: null,
            currentPlayer: 1,
            turnCount: 1,
            moveHistory: [],
            capturedByBlue: [],
            capturedByRed: [],
            stepTimer: null
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit('room_created', {
            roomCode,
            slot: 'blue',
            roomState: getRoomPublicState(room)
        });
    });

    // 2. Join Room
    socket.on('join_room', ({ roomCode, playerName, lang }) => {
        const cleanCode = (roomCode || '').trim().toUpperCase();
        const room = rooms.get(cleanCode);

        if (!room) {
            return socket.emit('join_error', 'Mã phòng không tồn tại hoặc phòng đã đóng.');
        }

        if (room.gameActive) {
            return socket.emit('join_error', 'Trận đấu trong phòng này đang diễn ra!');
        }

        let slot = 'spectator';
        if (!room.red) {
            slot = 'red';
            room.red = {
                socketId: socket.id,
                name: playerName || 'Người chơi 2',
                lang: lang || 'python',
                code: '',
                ready: false,
                handler: null
            };
        } else {
            room.spectators.push({ socketId: socket.id, name: playerName });
        }

        socket.join(cleanCode);
        socket.roomCode = cleanCode;

        socket.emit('room_joined', {
            roomCode: cleanCode,
            slot,
            roomState: getRoomPublicState(room)
        });

        io.to(cleanCode).emit('room_updated', getRoomPublicState(room));
    });

    // 3. Player Ready & Code Submission
    socket.on('player_ready', async ({ code, lang, name }) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms.has(roomCode)) return;
        const room = rooms.get(roomCode);

        let isBlue = room.blue && room.blue.socketId === socket.id;
        let isRed = room.red && room.red.socketId === socket.id;

        if (isBlue) {
            room.blue.code = code;
            room.blue.lang = lang;
            if (name) room.blue.name = name;
            room.blue.ready = true;
            io.to(roomCode).emit('player_submitted', { player: 'blue', name: room.blue.name });
        } else if (isRed) {
            room.red.code = code;
            room.red.lang = lang;
            if (name) room.red.name = name;
            room.red.ready = true;
            io.to(roomCode).emit('player_submitted', { player: 'red', name: room.red.name });
        }

        io.to(roomCode).emit('room_updated', getRoomPublicState(room));

        // ONLY when BOTH players have submitted code, begin compilation and battle
        if (room.blue && room.blue.ready && room.red && room.red.ready && !room.gameActive) {
            io.to(roomCode).emit('match_preparing', '⏳ Cả 2 người chơi đã nộp code! Đang kiểm tra cú pháp và biên dịch code...');

            // Prepare Blue bot
            const bluePrep = await runner.prepareBot(roomCode + '_blue', room.blue.lang, room.blue.code);
            if (!bluePrep.success) {
                room.blue.ready = false;
                io.to(roomCode).emit('room_updated', getRoomPublicState(room));
                return io.to(roomCode).emit('match_code_error', {
                    player: 'blue',
                    name: room.blue.name,
                    error: bluePrep.error
                });
            }
            room.blue.handler = bluePrep.botHandler;

            // Prepare Red bot
            const redPrep = await runner.prepareBot(roomCode + '_red', room.red.lang, room.red.code);
            if (!redPrep.success) {
                room.red.ready = false;
                io.to(roomCode).emit('room_updated', getRoomPublicState(room));
                return io.to(roomCode).emit('match_code_error', {
                    player: 'red',
                    name: room.red.name,
                    error: redPrep.error
                });
            }
            room.red.handler = redPrep.botHandler;

            // Both bots compiled successfully! Notify countdown then start battle
            io.to(roomCode).emit('match_validated', '✅ Code của cả 2 bên hợp lệ! Chuẩn bị thi đấu trong 3 giây...');
            setTimeout(() => {
                if (rooms.has(roomCode) && room.gameActive === false) {
                    startOnlineMatch(room);
                }
            }, 2500);
        }
    });

    // 4. Request Rematch (Reset submission state for new round)
    socket.on('request_rematch', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms.has(roomCode)) return;
        const room = rooms.get(roomCode);

        room.gameActive = false;
        if (room.stepTimer) clearTimeout(room.stepTimer);
        if (room.blue) room.blue.ready = false;
        if (room.red) room.red.ready = false;

        io.to(roomCode).emit('room_updated', getRoomPublicState(room));
        io.to(roomCode).emit('rematch_ready', 'Ván đấu mới sẵn sàng! Hãy chỉnh sửa code và bấm "Nộp Code" để thi đấu lại.');
    });

    // 5. Leave Room
    socket.on('leave_room', () => {
        handleUserLeave(socket);
    });

    socket.on('disconnect', () => {
        handleUserLeave(socket);
    });
});

function handleUserLeave(socket) {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    const room = rooms.get(roomCode);

    if (room.blue && room.blue.socketId === socket.id) {
        room.blue = null;
    } else if (room.red && room.red.socketId === socket.id) {
        room.red = null;
    } else {
        room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
    }

    if (!room.blue && !room.red) {
        if (room.stepTimer) clearTimeout(room.stepTimer);
        rooms.delete(roomCode);
    } else {
        if (room.gameActive) {
            room.gameActive = false;
            if (room.stepTimer) clearTimeout(room.stepTimer);
            io.to(roomCode).emit('match_error', 'Đối thủ đã rời phòng. Trận đấu kết thúc!');
        }
        io.to(roomCode).emit('room_updated', getRoomPublicState(room));
    }
}

function getRoomPublicState(room) {
    return {
        roomCode: room.code,
        gameActive: room.gameActive,
        blue: room.blue ? { name: room.blue.name, lang: room.blue.lang, ready: room.blue.ready } : null,
        red: room.red ? { name: room.red.name, lang: room.red.lang, ready: room.red.ready } : null,
        spectatorsCount: room.spectators.length
    };
}

function startOnlineMatch(room) {
    room.gameActive = true;
    room.board = createInitialBoard();
    room.currentPlayer = 1;
    room.turnCount = 1;
    room.moveHistory = [];
    room.capturedByBlue = [];
    room.capturedByRed = [];

    io.to(room.code).emit('match_started', {
        board: room.board,
        blue: { name: room.blue.name, lang: room.blue.lang },
        red: { name: room.red.name, lang: room.red.lang }
    });

    runOnlineStep(room);
}

async function runOnlineStep(room) {
    if (!room.gameActive) return;

    const player = room.currentPlayer;
    const botHandler = player === 1 ? room.blue.handler : room.red.handler;
    const legalMoves = getLegalMoves(player, room.board);

    if (legalMoves.length === 0) {
        const winResult = checkWin(room.board);
        return finishOnlineMatch(room, winResult.winner, winResult.reason);
    }

    const state = {
        board: room.board,
        myPlayer: player,
        opponentPlayer: player === 1 ? 2 : 1,
        myGoal: player === 1 ? BLUE_GOAL : RED_GOAL,
        opponentGoal: player === 1 ? RED_GOAL : BLUE_GOAL,
        legalMoves,
        turnNumber: Math.ceil(room.turnCount / 2),
        moveHistory: room.moveHistory
    };

    const res = await runner.executeBotMove(botHandler, state, 2500);

    let finalMove = null;
    if (res.move) {
        finalMove = legalMoves.find(m =>
            m.from.r === res.move.from.r &&
            m.from.c === res.move.from.c &&
            m.to.r === res.move.to.r &&
            m.to.c === res.move.to.c
        );
    }

    // Fallback if invalid or crashed
    if (!finalMove) {
        finalMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    // Apply move to board
    const fromPiece = room.board[finalMove.from.r][finalMove.from.c];
    const targetPiece = room.board[finalMove.to.r][finalMove.to.c];
    const isCapture = !!targetPiece;

    if (isCapture) {
        if (player === 1) room.capturedByBlue.push(targetPiece.type);
        else room.capturedByRed.push(targetPiece.type);
    }

    room.board[finalMove.to.r][finalMove.to.c] = fromPiece;
    room.board[finalMove.from.r][finalMove.from.c] = null;

    const moveRecord = {
        turn: room.turnCount,
        player,
        notation: finalMove.notation,
        from: finalMove.from,
        to: finalMove.to,
        capture: finalMove.capture,
        pieceType: finalMove.pieceType,
        elapsed: `${res.elapsed}ms`,
        log: res.log
    };
    room.moveHistory.push(moveRecord);

    io.to(room.code).emit('online_move_made', {
        moveRecord,
        board: room.board,
        turnCount: room.turnCount,
        capturedByBlue: room.capturedByBlue,
        capturedByRed: room.capturedByRed,
        currentPlayer: player === 1 ? 2 : 1
    });

    // Check Win
    const winResult = checkWin(room.board);
    if (winResult.winner !== null) {
        return finishOnlineMatch(room, winResult.winner, winResult.reason);
    }

    if (room.turnCount >= 200) {
        return finishOnlineMatch(room, 'draw', 'Trận đấu kết thúc hòa sau 200 nước đi!');
    }

    room.currentPlayer = player === 1 ? 2 : 1;
    room.turnCount++;

    room.stepTimer = setTimeout(() => {
        runOnlineStep(room);
    }, 450);
}

function finishOnlineMatch(room, winner, reason) {
    room.gameActive = false;
    if (room.stepTimer) clearTimeout(room.stepTimer);

    // Update Elo
    const eloOutcome = storage.updateMatchResult({
        blueName: room.blue.name,
        redName: room.red.name,
        blueLang: room.blue.lang,
        redLang: room.red.lang,
        winner
    });

    io.to(room.code).emit('online_match_finished', {
        winner,
        reason,
        turnCount: room.turnCount,
        eloOutcome
    });

    // Broadcast updated leaderboard to all connected users
    io.emit('leaderboard_data', eloOutcome.updatedLeaderboard);

    // Reset readiness
    if (room.blue) room.blue.ready = false;
    if (room.red) room.red.ready = false;
    io.to(room.code).emit('room_updated', getRoomPublicState(room));

    // Cleanup temp files
    if (room.blue && room.blue.handler) runner.cleanupBot(room.blue.handler);
    if (room.red && room.red.handler) runner.cleanupBot(room.red.handler);
}

server.listen(PORT, () => {
    console.log(`⚔️ OTTv2 Code Arena Server running at http://localhost:${PORT}`);
});
