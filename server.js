// ===== OTTv2 Code Arena - Realtime Multiplayer, Tournaments & Multi-Language Server =====

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const engine = require('./engine');
const matchplay = require('./matchplay');
const runner = require('./runner');
const auth = require('./auth');
const { db, saveMatch } = require('./db');
const tournament = require('./tournament');
const api = require('./api');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(auth.attachUser);                 // req.user = logged-in account (or null)
app.use('/api', auth.sameOriginOnly);     // CSRF guard for state-changing API calls

// Only the browser-facing files are public. The project folder also holds the SQLite database
// (which contains submitted bot source code), server code and temp bot files - never serve those.
const PUBLIC_FILES = new Set([
    'index.html', 'style.css', 'logic.js', 'bots.js', 'bot_templates.js', 'elo.js',
    'arena.html', 'arena.css', 'arena.js', 'auth-gate.js'
]);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const file = req.path.replace(/^\//, '');
    if (PUBLIC_FILES.has(file)) return res.sendFile(path.join(__dirname, file));
    next();
});

// Code editor (Ace) served from this server so the arena also works on a LAN without internet.
const ACE_DIR = path.join(path.dirname(require.resolve('ace-builds/package.json')), 'src-min-noconflict');
const ACE_FILES = /^(ace|theme-monokai|mode-javascript|mode-python|mode-c_cpp|worker-javascript)\.js$/;
app.get('/vendor/ace/:file', (req, res) => {
    if (!ACE_FILES.test(req.params.file)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(ACE_DIR, req.params.file));
});

// Match history + tournaments REST API
app.use('/api', api.router);

// Direct API endpoint to run a bot move (used in local practice mode for Python & C++).
// NOTE: this executes code sent by the browser. Set ALLOW_LOCAL_RUN=0 on any publicly reachable
// deployment (local practice then falls back to the in-browser JavaScript bots only).
const localBotCache = new Map();         // sha1(lang+code) -> { promise, lastUsed, busy }
const LOCAL_CACHE_MAX = 8;
const MAX_LOCAL_CODE_BYTES = 100 * 1024;

function evictLocalBots() {
    const now = Date.now();
    for (const [key, e] of localBotCache) {
        const idle = now - e.lastUsed > 10 * 60 * 1000;
        const overflow = localBotCache.size > LOCAL_CACHE_MAX && now - e.lastUsed > 30 * 1000;
        if (e.busy === 0 && (idle || overflow)) {
            localBotCache.delete(key);
            e.promise.then(p => { if (p.success) runner.cleanupBot(p.botHandler); });
        }
    }
}
setInterval(evictLocalBots, 60 * 1000).unref();

/** Compile once per distinct code (C++ used to be recompiled on EVERY move: seconds per move). */
function acquireLocalBot(lang, code) {
    const key = crypto.createHash('sha1').update(`${lang}\0${code}`).digest('hex').slice(0, 16);
    let e = localBotCache.get(key);
    if (!e) {
        e = { promise: runner.prepareBot(`local_${key}`, lang, code), lastUsed: Date.now(), busy: 0 };
        localBotCache.set(key, e);
        e.promise.then(p => { if (!p.success) localBotCache.delete(key); });   // don't cache failures
        evictLocalBots();
    }
    e.lastUsed = Date.now();
    e.busy++;
    return { entry: e, release: () => { e.busy--; e.lastUsed = Date.now(); } };
}

const localRunLimiter = api.rateLimit({ windowMs: 60_000, max: 900 });
app.post('/api/run-bot-move', localRunLimiter, async (req, res) => {
    if (process.env.ALLOW_LOCAL_RUN === '0') {
        return res.status(403).json({ success: false, error: 'Máy chủ này đã tắt chế độ chạy code Python/C++ cục bộ.' });
    }
    const { lang, code, state } = req.body || {};
    if (!lang || !code || !state) {
        return res.status(400).json({ error: 'Thiếu thông số lang, code hoặc state' });
    }
    if (!['python', 'cpp', 'javascript'].includes(lang) || typeof code !== 'string' || Buffer.byteLength(code) > MAX_LOCAL_CODE_BYTES) {
        return res.status(400).json({ success: false, error: 'Ngôn ngữ không hợp lệ hoặc code quá lớn (tối đa 100KB)' });
    }
    const { entry, release } = acquireLocalBot(lang, code);
    try {
        const prep = await entry.promise;
        if (!prep.success) return res.json({ success: false, error: prep.error });
        const result = await runner.executeBotMove(prep.botHandler, state, 2500);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    } finally {
        release();
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Game rules live in engine.js (shared by online rooms, tournaments and replay validation).
const rules = engine.resolveRules();

// Room Management
const rooms = new Map();

// Admin overview combines persisted totals with live game state held in memory.
app.get('/api/admin/overview', auth.requireAdmin, (req, res) => {
    const users = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
    const tournaments = db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status IN ('registration', 'running') THEN 1 ELSE 0 END) AS open
        FROM tournaments
    `).get();
    const submissions = db.prepare('SELECT COUNT(*) AS total FROM entries WHERE user_id IS NOT NULL').get().total;
    const onlineMatches = [...rooms.values()].filter(room => room.gameActive).length;
    res.json({
        users,
        tournaments: { open: tournaments.open || 0, total: tournaments.total },
        submissions,
        matches: onlineMatches + tournament.liveGameCount()
    });
});

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'OTT-';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Who is on the other end of this socket? (same HttpOnly session cookie as the REST API)
io.use((socket, next) => {
    socket.data.user = auth.userFromCookieHeader(socket.request.headers.cookie);
    next();
});

/** Display name inside a room: the account name for logged-in users; guests can't pose as accounts/bots. */
function seatName(socket, requested, fallback) {
    const user = socket.data.user;
    if (user) return user.username;
    const name = String(requested || fallback).trim().slice(0, 24) || fallback;
    const taken = auth.leaderboard().some(p => p.name.toLowerCase() === name.toLowerCase());
    return taken ? `${name} (khách)` : name;
}

io.on('connection', (socket) => {
    // Send current leaderboard
    socket.emit('leaderboard_data', auth.leaderboard());

    // Tournament spectating: join the tournament's room to receive bracket updates + live games
    socket.on('watch_tournament', (tid) => {
        const id = parseInt(tid, 10);
        if (!Number.isInteger(id)) return;
        socket.join(`t:${id}`);
        socket.emit('live_snapshot', { tournamentId: id, games: tournament.liveForTournament(id) });
    });
    socket.on('unwatch_tournament', (tid) => {
        const id = parseInt(tid, 10);
        if (Number.isInteger(id)) socket.leave(`t:${id}`);
    });

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
                name: seatName(socket, playerName, 'Người chơi 1'),
                userId: socket.data.user ? socket.data.user.id : null,
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
            signal: null
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
                name: seatName(socket, playerName, 'Người chơi 2'),
                userId: socket.data.user ? socket.data.user.id : null,
                lang: lang || 'python',
                code: '',
                ready: false,
                handler: null
            };
        } else {
            room.spectators.push({ socketId: socket.id, name: seatName(socket, playerName, 'Khán giả') });
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
            if (name && !room.blue.userId) room.blue.name = seatName(socket, name, room.blue.name);
            room.blue.ready = true;
            io.to(roomCode).emit('player_submitted', { player: 'blue', name: room.blue.name });
        } else if (isRed) {
            room.red.code = code;
            room.red.lang = lang;
            if (name && !room.red.userId) room.red.name = seatName(socket, name, room.red.name);
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
        if (room.signal) room.signal.aborted = true;
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
        if (room.signal) room.signal.aborted = true;
        rooms.delete(roomCode);
    } else {
        if (room.gameActive) {
            room.gameActive = false;
            if (room.signal) room.signal.aborted = true;
            io.to(roomCode).emit('match_error', 'Đối thủ đã rời phòng. Trận đấu kết thúc!');
        }
        io.to(roomCode).emit('room_updated', getRoomPublicState(room));
    }
}

function isRated(room) {
    return !!(room.blue && room.red && room.blue.userId && room.red.userId && room.blue.userId !== room.red.userId);
}

function getRoomPublicState(room) {
    return {
        roomCode: room.code,
        gameActive: room.gameActive,
        blue: room.blue ? { name: room.blue.name, lang: room.blue.lang, ready: room.blue.ready, account: !!room.blue.userId } : null,
        red: room.red ? { name: room.red.name, lang: room.red.lang, ready: room.red.ready, account: !!room.red.userId } : null,
        spectatorsCount: room.spectators.length,
        // rated = both seats are different logged-in accounts -> Elo moves
        rated: isRated(room)
    };
}


// ===== Online match (authoritative server loop, shared with tournaments via matchplay.js) =====

async function startOnlineMatch(room) {
    room.gameActive = true;
    room.signal = { aborted: false };
    room.moveHistory = [];
    const signal = room.signal;
    const blue = room.blue;     // keep references: room.blue / room.red become null if a player leaves
    const red = room.red;
    const blueInfo = { name: blue.name, lang: blue.lang, userId: blue.userId };
    const redInfo = { name: red.name, lang: red.lang, userId: red.userId };
    const rated = isRated(room);

    const result = await matchplay.playMatch({
        blue: { ...blueInfo, handler: blue.handler },
        red: { ...redInfo, handler: red.handler },
        rules,
        delayMs: 450,
        signal,
        onStart: (board) => {
            room.board = board;
            io.to(room.code).emit('match_started', {
                board, rated,
                blue: { name: blueInfo.name, lang: blueInfo.lang },
                red: { name: redInfo.name, lang: redInfo.lang }
            });
        },
        onMove: ({ move, board, capturedByBlue, capturedByRed, nextPlayer }) => {
            room.board = board;
            const moveRecord = {
                turn: move.ply,
                player: move.player,
                notation: move.notation,
                from: move.from,
                to: move.to,
                capture: move.capture,
                pieceType: move.pieceType,
                elapsed: `${move.elapsedMs}ms`,
                log: move.log
            };
            room.moveHistory.push(moveRecord);
            io.to(room.code).emit('online_move_made', {
                moveRecord,
                board,
                turnCount: move.ply,
                capturedByBlue,
                capturedByRed,
                currentPlayer: nextPlayer
            });
        }
    });

    // Temp files of the (re)compiled bots are no longer needed, whatever the outcome
    if (blue.handler) runner.cleanupBot(blue.handler);
    if (red.handler) runner.cleanupBot(red.handler);

    if (result.aborted) return;   // a player left / rematch requested - handled by the caller
    finishOnlineMatch(room, result, blueInfo, redInfo, rated);
}

function finishOnlineMatch(room, result, blueInfo, redInfo, rated) {
    room.gameActive = false;

    // Elo + W/L/D live in the accounts table and move only for rated games
    // (two different logged-in players). Guest games are recorded but never touch the ladder.
    const eloOutcome = rated ? auth.applyRatedResult(blueInfo.userId, redInfo.userId, result.winner) : null;

    // Persist the whole game so it can be replayed later
    let matchId = null;
    try {
        matchId = saveMatch({
            kind: 'online',
            blue: blueInfo,
            red: redInfo,
            winner: result.winner,
            reason: result.reason,
            rules,
            durationMs: result.durationMs
        }, result.moves);
    } catch (err) {
        console.error('Không lưu được lịch sử trận đấu:', err);
    }

    io.to(room.code).emit('online_match_finished', {
        winner: result.winner,
        reason: result.reason,
        turnCount: result.moves.length,
        eloOutcome,
        rated,
        matchId
    });

    if (eloOutcome) io.emit('leaderboard_data', eloOutcome.updatedLeaderboard);

    if (room.blue) room.blue.ready = false;
    if (room.red) room.red.ready = false;
    io.to(room.code).emit('room_updated', getRoomPublicState(room));
}

// Last-resort error handler: always JSON, never an HTML page with a stack trace
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    let message = 'Lỗi máy chủ';
    if (err.type === 'entity.too.large') message = 'Dữ liệu gửi lên quá lớn';
    else if (err.type === 'entity.parse.failed') message = 'Dữ liệu JSON không hợp lệ';
    else if (status < 500) message = 'Yêu cầu không hợp lệ';
    if (status >= 500) console.error('[server]', err);
    res.status(status).json({ error: message });
});

// ===== Boot =====

tournament.setIO(io);
runner.cleanupTempDir();
runner.detectToolchains().then(t => {
    const line = (name, x) => `${x.ok ? '✅' : '❌'} ${name}${x.ok ? ` (${x.version})` : ` — ${x.hint}`}`;
    console.log(line('JavaScript', t.javascript));
    console.log(line('Python', t.python));
    console.log(line('C++', t.cpp));
    const sb = runner.getSandboxStatus();
    const icon = { strong: '🛡️ mạnh', basic: '🟡 cơ bản', weak: '🟠 yếu', none: '🔴 KHÔNG' };
    console.log(`Sandbox (${sb.driver}${sb.strict ? ', strict' : ''}): JS ${icon[sb.levels.javascript]} · Python ${icon[sb.levels.python]} · C++ ${icon[sb.levels.cpp]}`);
    sb.notes.forEach(n => console.log(`   ⚠ ${n}`));
});
tournament.recoverOnBoot();

auth.ensureDefaultAdmin().then((created) => {
    if (created) console.log('Tài khoản admin mặc định đã được tạo. Đăng nhập bằng admin / adminadmin và đổi mật khẩu ngay.');
    server.listen(PORT, () => {
        console.log(`⚔️ OTTv2 Code Arena Server running at http://localhost:${PORT}`);
        console.log(`🏆 Giải đấu & lịch sử trận:  http://localhost:${PORT}/arena.html`);
        if (auth.ADMIN_KEY_IS_GENERATED) {
            console.log(`🔑 ADMIN_KEY (tự sinh, đổi mỗi lần chạy): ${auth.ADMIN_KEY}`);
            console.log('   Đặt biến môi trường ADMIN_KEY để giữ khóa ổn định. Tài khoản có role admin cần khóa này mỗi lần đăng nhập.');
        }
    });
}).catch((err) => {
    console.error('Không thể khởi tạo tài khoản admin mặc định:', err);
    process.exitCode = 1;
});
