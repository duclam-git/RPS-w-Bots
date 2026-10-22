// ===== OTTv2 Code Arena - Realtime Multiplayer, Tournaments & Multi-Language Server =====

require('./loadenv').load();          // optional .env file (see .env.example)

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
const guard = require('./netguard');
const { saveMatch } = require('./db');
const tournament = require('./tournament');
const backup = require('./backup');
const { db } = require('./db');
const api = require('./api');

const app = express();
app.disable('x-powered-by');
// Behind nginx/Caddy set TRUST_PROXY=1 so rate limits see the real client IP (never trust X-Forwarded-For otherwise)
app.set('trust proxy', guard.trustProxyHops());
app.use(guard.securityHeaders);
app.use(cors(guard.corsOptions()));       // no CORS headers unless ALLOWED_ORIGINS lists the origin
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

// Liveness / readiness probe for load balancers, Docker, systemd, uptime monitors (no secrets in it)
app.get('/healthz', (req, res) => {
    try {
        db.prepare('SELECT 1').get();
        res.set('Cache-Control', 'no-store').json({ ok: true, uptime: Math.round(process.uptime()) });
    } catch (err) {
        res.status(503).json({ ok: false });
    }
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
    maxHttpBufferSize: 256 * 1024,                       // code is capped at 100KB; nothing legitimate is bigger
    // Cookies are now a credential, so a hostile web page must not be able to open a WebSocket to us
    // with the visitor's session (cross-site WebSocket hijacking): same-origin or ALLOWED_ORIGINS only.
    allowRequest: (req, cb) => cb(null, guard.originAllowed(req))
});

const PORT = process.env.PORT || 3000;

// Game rules live in engine.js (shared by online rooms, tournaments and replay validation).
const rules = engine.resolveRules();

// ===== Online rooms =====
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
    res.json({ users, tournaments: { open: tournaments.open || 0, total: tournaments.total }, submissions,
        matches: onlineMatches + tournament.liveGameCount() });
});

const MAX_ROOMS = parseInt(process.env.MAX_ROOMS, 10) || 200;
const MAX_ROOM_CODE_BYTES = 100 * 1024;
const LANGS = ['javascript', 'python', 'cpp'];
const normLang = (l, d) => (LANGS.includes(l) ? l : d);

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'OTT-';
    for (let i = 0; i < 4; i++) code += chars.charAt(crypto.randomInt(chars.length));
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
    const name = guard.str(requested, 24, '') || fallback;
    const taken = auth.leaderboard().some(p => p.name.toLowerCase() === name.toLowerCase());
    return taken ? `${name} (khách)` : name;
}

const eventLimiter = guard.createEventLimiter();

function cleanupRoomBots(room) {
    for (const seat of [room.blue, room.red]) {
        if (seat && seat.handler) { runner.cleanupBot(seat.handler); seat.handler = null; }
    }
}

function newSeat(socket, name, fallback, lang, defaultLang) {
    return {
        socketId: socket.id,
        name: seatName(socket, name, fallback),
        userId: socket.data.user ? socket.data.user.id : null,
        lang: normLang(lang, defaultLang),
        code: '',
        ready: false,
        handler: null
    };
}

io.on('connection', (socket) => {
    const ip = guard.socketIp(socket);
    socket.data.ip = ip;

    // One IP cannot hold hundreds of sockets
    if (!guard.connections.acquire(ip)) {
        socket.emit('join_error', 'Quá nhiều kết nối từ địa chỉ của bạn.');
        return socket.disconnect(true);
    }
    socket.once('disconnect', () => { guard.connections.release(ip); eventLimiter.forget(socket.id); });

    // Flood control: drop (and tell the client) instead of doing work
    socket.use((packet, next) => {
        if (eventLimiter.allow(socket.id, ip, packet[0])) return next();
        socket.emit('rate_limited', { event: String(packet[0]).slice(0, 40) });
    });

    /**
     * Registers a handler that can NEVER take the process down: the payload is coerced to a plain
     * object (a bare `emit('x')` or `emit('x', null)` used to crash the server on destructuring) and
     * every sync/async error is caught.
     */
    const on = (event, fn, { raw = false } = {}) => socket.on(event, async (payload) => {
        try { await fn(raw ? payload : guard.obj(payload)); }
        catch (err) {
            console.error(`[socket ${event}]`, err);
            socket.emit('server_error', { event });
        }
    });

    socket.emit('leaderboard_data', auth.leaderboard());

    // Tournament spectating: join the tournament's room to receive bracket updates + live games
    on('watch_tournament', (tid) => {
        const id = parseInt(tid, 10);
        if (!Number.isInteger(id)) return;
        socket.join(`t:${id}`);
        socket.emit('live_snapshot', { tournamentId: id, games: tournament.liveForTournament(id) });
    }, { raw: true });
    on('unwatch_tournament', (tid) => {
        const id = parseInt(tid, 10);
        if (Number.isInteger(id)) socket.leave(`t:${id}`);
    }, { raw: true });

    // 1. Create Room
    on('create_room', ({ playerName, lang }) => {
        if (socket.roomCode) handleUserLeave(socket);                 // one room at a time
        if (rooms.size >= MAX_ROOMS) return socket.emit('join_error', 'Máy chủ đang có quá nhiều phòng, hãy thử lại sau ít phút.');
        let roomCode;
        do { roomCode = generateRoomCode(); } while (rooms.has(roomCode));

        const room = {
            code: roomCode,
            hostId: socket.id,
            phase: 'lobby',                 // lobby -> preparing -> countdown -> playing -> lobby
            blue: newSeat(socket, playerName, 'Người chơi 1', lang, 'javascript'),
            red: null,
            spectators: [],
            gameActive: false,
            board: null,
            moveHistory: [],
            signal: null,
            startTimer: null
        };
        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.emit('room_created', { roomCode, slot: 'blue', roomState: getRoomPublicState(room) });
    });

    // 2. Join Room
    on('join_room', ({ roomCode, playerName, lang }) => {
        const cleanCode = guard.str(roomCode, 12).toUpperCase();
        const room = rooms.get(cleanCode);
        if (!room) return socket.emit('join_error', 'Mã phòng không tồn tại hoặc phòng đã đóng.');
        if (room.gameActive) return socket.emit('join_error', 'Trận đấu trong phòng này đang diễn ra!');
        if (socket.roomCode === cleanCode) return;                    // already inside
        if (socket.roomCode) handleUserLeave(socket);

        let slot = 'spectator';
        if (!room.red) {
            slot = 'red';
            room.red = newSeat(socket, playerName, 'Người chơi 2', lang, 'python');
        } else if (!room.blue) {
            slot = 'blue';
            room.blue = newSeat(socket, playerName, 'Người chơi 1', lang, 'javascript');
        } else {
            room.spectators.push({ socketId: socket.id, name: seatName(socket, playerName, 'Khán giả') });
        }
        socket.join(cleanCode);
        socket.roomCode = cleanCode;
        socket.emit('room_joined', { roomCode: cleanCode, slot, roomState: getRoomPublicState(room) });
        io.to(cleanCode).emit('room_updated', getRoomPublicState(room));
    });

    // 3. Player Ready & Code Submission
    on('player_ready', async ({ code, lang, name }) => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.phase !== 'lobby') return;                  // not while compiling / counting down / playing
        const side = room.blue && room.blue.socketId === socket.id ? 'blue'
            : room.red && room.red.socketId === socket.id ? 'red' : null;
        if (!side) return;                                            // spectators cannot submit
        const seat = room[side];

        if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code, 'utf-8') > MAX_ROOM_CODE_BYTES) {
            return socket.emit('match_code_error', { player: side, name: seat.name, error: 'Code trống hoặc quá lớn (tối đa 100KB).' });
        }
        seat.code = code;
        seat.lang = normLang(lang, seat.lang);
        if (name && !seat.userId) seat.name = seatName(socket, name, seat.name);
        seat.ready = true;
        io.to(room.code).emit('player_submitted', { player: side, name: seat.name });
        io.to(room.code).emit('room_updated', getRoomPublicState(room));

        // ONLY when BOTH players have submitted code, begin compilation and battle
        if (room.blue && room.blue.ready && room.red && room.red.ready) await prepareAndStart(room);
    });

    // 4. Request Rematch (Reset submission state for new round)
    on('request_rematch', () => {
        const room = rooms.get(socket.roomCode);
        if (!room) return;
        resetRoom(room);
        io.to(room.code).emit('room_updated', getRoomPublicState(room));
        io.to(room.code).emit('rematch_ready', 'Ván đấu mới sẵn sàng! Hãy chỉnh sửa code và bấm "Nộp Code" để thi đấu lại.');
    });

    // 5. Leave Room
    on('leave_room', () => handleUserLeave(socket));
    socket.on('disconnect', () => { try { handleUserLeave(socket); } catch (err) { console.error('[disconnect]', err); } });
});

/** Back to the lobby: stop a running match / pending start, forget compiled bots and submissions. */
function resetRoom(room) {
    if (room.startTimer) { clearTimeout(room.startTimer); room.startTimer = null; }
    if (room.signal) room.signal.aborted = true;
    room.gameActive = false;
    room.phase = 'lobby';
    for (const seat of [room.blue, room.red]) if (seat) seat.ready = false;
    cleanupRoomBots(room);
}

/** Compile both bots, then start the match after a short countdown. Safe against players leaving at any point. */
async function prepareAndStart(room) {
    if (room.phase !== 'lobby') return;                               // two submissions racing must start ONE match
    room.phase = 'preparing';
    const code = room.code;
    io.to(code).emit('match_preparing', '⏳ Cả 2 người chơi đã nộp code! Đang kiểm tra cú pháp và biên dịch code...');

    try {
        for (const side of ['blue', 'red']) {
            const seat = room[side];
            if (!seat) return abandonPreparation(room);
            const prep = await runner.prepareBot(`${code}_${side}`, seat.lang, seat.code);
            // somebody may have left (or the room died) while we were compiling
            if (rooms.get(code) !== room || !room.blue || !room.red || room.phase !== 'preparing') {
                if (prep.success) runner.cleanupBot(prep.botHandler);
                return abandonPreparation(room);
            }
            if (!prep.success) {
                seat.ready = false;
                room.phase = 'lobby';
                cleanupRoomBots(room);
                io.to(code).emit('room_updated', getRoomPublicState(room));
                return io.to(code).emit('match_code_error', { player: side, name: seat.name, error: prep.error });
            }
            seat.handler = prep.botHandler;
        }
    } catch (err) {
        console.error('[prepare]', err);
        resetRoom(room);
        io.to(code).emit('room_updated', getRoomPublicState(room));
        return io.to(code).emit('match_error', 'Lỗi máy chủ khi chuẩn bị trận đấu. Hãy nộp lại code.');
    }

    io.to(code).emit('match_validated', '✅ Code của cả 2 bên hợp lệ! Chuẩn bị thi đấu trong 3 giây...');
    room.phase = 'countdown';
    room.startTimer = setTimeout(() => {
        room.startTimer = null;
        if (rooms.get(code) !== room || room.phase !== 'countdown' || !room.blue || !room.red) return abandonPreparation(room);
        startOnlineMatch(room).catch(err => {
            console.error('[match]', err);
            resetRoom(room);
            io.to(code).emit('room_updated', getRoomPublicState(room));
            io.to(code).emit('match_error', 'Lỗi máy chủ trong trận đấu.');
        });
    }, 2500);
}

function abandonPreparation(room) {
    if (rooms.get(room.code) === room) { room.phase = 'lobby'; }
    cleanupRoomBots(room);
}

function handleUserLeave(socket) {
    const roomCode = socket.roomCode;
    socket.roomCode = null;
    socket.leave(roomCode);
    const room = rooms.get(roomCode);
    if (!room) return;

    const seat = room.blue && room.blue.socketId === socket.id ? room.blue
        : room.red && room.red.socketId === socket.id ? room.red : null;
    const wasSeated = !!seat;
    if (seat) {
        // clean the leaver's compiled bot BEFORE the seat is emptied (resetRoom can no longer see it afterwards)
        if (seat.handler) { runner.cleanupBot(seat.handler); seat.handler = null; }
        if (seat === room.blue) room.blue = null; else room.red = null;
    } else {
        room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
    }

    if (!room.blue && !room.red) {
        resetRoom(room);
        rooms.delete(roomCode);
        return;
    }
    if (wasSeated) {
        const wasPlaying = room.gameActive;
        resetRoom(room);
        if (wasPlaying) io.to(roomCode).emit('match_error', 'Đối thủ đã rời phòng. Trận đấu kết thúc!');
    }
    io.to(roomCode).emit('room_updated', getRoomPublicState(room));
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
    room.phase = 'playing';
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
    if (blue.handler) { runner.cleanupBot(blue.handler); blue.handler = null; }
    if (red.handler) { runner.cleanupBot(red.handler); red.handler = null; }

    if (result.aborted) { if (room.phase === 'playing') room.phase = 'lobby'; return; }   // a player left / rematch requested
    finishOnlineMatch(room, result, blueInfo, redInfo, rated);
}

function finishOnlineMatch(room, result, blueInfo, redInfo, rated) {
    room.gameActive = false;
    room.phase = 'lobby';

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
backup.startSchedule();


// ===== Graceful shutdown =====
// SIGTERM/SIGINT (Ctrl+C, systemd, Docker): stop taking traffic, stop the schedulers (tournaments resume on the
// next boot), abort running matches, kill bot processes, remove temp files, flush SQLite, exit.
let shuttingDown = false;
async function shutdown(reason, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n⏹  Đang tắt máy chủ (${reason})…`);
    setTimeout(() => process.exit(exitCode || 1), 12_000).unref();       // never hang on shutdown
    try {
        server.close();
        io.emit('server_shutdown', { message: 'Máy chủ đang khởi động lại. Hãy tải lại trang sau giây lát.' });
        backup.stopSchedule();
        await tournament.shutdown();
        rooms.forEach(room => resetRoom(room));
        runner.killAll();
        runner.cleanupTempDir();
        io.close();
        db.close();
    } catch (err) {
        console.error('[shutdown]', err);
    }
    process.exit(exitCode);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); shutdown('uncaughtException', 1); });

auth.ensureDefaultAdmin().then((created) => {
    if (created) console.log('Tài khoản admin mặc định đã được tạo. Đăng nhập bằng admin / adminadmin và đổi mật khẩu ngay.');
    server.listen(PORT, () => {
        console.log(`⚔️ OTTv2 Code Arena Server running at http://localhost:${PORT}`);
        console.log(`🏆 Giải đấu & lịch sử trận:  http://localhost:${PORT}/arena.html`);
        if (auth.ADMIN_KEY_IS_GENERATED) {
            console.log(`🔑 ADMIN_KEY (tự sinh, đổi mỗi lần chạy): ${auth.ADMIN_KEY}`);
            console.log('   Đặt biến môi trường ADMIN_KEY để dùng khóa cố định. Tài khoản admin cần khóa này khi đăng nhập.');
        }
    });
}).catch((err) => {
    console.error('Không thể khởi tạo tài khoản admin mặc định:', err);
    process.exitCode = 1;
});
