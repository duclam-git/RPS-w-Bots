// ===== OTTv2 Code Arena - Multi-Language Code Runner =====
// Supports C++ (g++), Python 3 (python), and JavaScript (Node.js) via Standard JSON I/O

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, 'temp_bots');
const PYTHON_CMD = process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python' : 'python3');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const os = require('os');
const sandbox = require('./sandbox');
const { Semaphore } = require('./semaphore');

// ALL bot processes of the whole server (online rooms + tournaments + practice) share this cap, so the
// machine cannot be flooded no matter how many games run at once. The wait for a slot is NOT charged to the bot.
const botSlots = new Semaphore(parseInt(process.env.MAX_BOT_PROCS, 10) || Math.max(2, os.cpus().length));
const liveChildren = new Set();

const MAX_BOT_OUTPUT_BYTES = 1024 * 1024;   // a bot that spams stdout/stderr is killed instead of eating RAM

/**
 * Environment given to bot processes. Deliberately minimal: bots are untrusted code and must NOT
 * inherit the server's secrets (ADMIN_KEY, session secrets, ...). Python is forced to UTF-8 because
 * on Windows a piped Python defaults to a legacy codepage and crashes when a bot logs Vietnamese text.
 */
function childEnv() {
    const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'];
    const env = {};
    for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
    return env;
}

// ----- which languages can this server actually run? -----
const toolchains = {
    javascript: { ok: true, version: process.version },
    python: { ok: null, version: '', hint: '' },
    cpp: { ok: null, version: '', hint: '' }
};
const HINTS = {
    python: `Máy chủ chưa có Python 3 (lệnh "${PYTHON_CMD}"). Hãy cài Python 3 và thêm vào PATH, hoặc đặt biến môi trường PYTHON_CMD.`,
    cpp: 'Máy chủ chưa có trình biên dịch g++ (C++17). Windows: cài MSYS2/MinGW-w64; Linux: apt install build-essential; macOS: xcode-select --install. Nhớ thêm vào PATH.'
};

function probe(cmd) {
    return new Promise((resolve) => {
        exec(cmd, { timeout: 8000, env: childEnv() }, (err, stdout, stderr) => {
            const out = `${stdout || ''}${stderr || ''}`.trim().split('\n')[0] || '';
            resolve(err ? { ok: false, version: '' } : { ok: true, version: out });
        });
    });
}

/** Run once at boot (cached in `toolchains`). Never throws. */
async function detectToolchains() {
    const [py, cpp] = await Promise.all([probe(`${PYTHON_CMD} --version`), probe('g++ --version')]);
    // The Windows Store "python" alias prints nothing useful -> require the real "Python 3.x" banner
    const pyOk = py.ok && /Python\s+3/i.test(py.version);
    toolchains.python = { ok: pyOk, version: pyOk ? py.version : '', hint: pyOk ? '' : HINTS.python };
    toolchains.cpp = { ok: cpp.ok, version: cpp.ok ? cpp.version : '', hint: cpp.ok ? '' : HINTS.cpp };
    await sandbox.detect({ pythonCmd: PYTHON_CMD });
    return toolchains;
}
const getToolchains = () => toolchains;

/**
 * Prepares and compiles/verifies a bot before match begins.
 * @param {string} playerId Unique identifier
 * @param {string} lang 'javascript' | 'python' | 'cpp'
 * @param {string} code Source code string
 * @returns {Promise<{ success: boolean, error?: string, botHandler?: object }>}
 */
/**
 * @param {object} [opts]  { game } - the game the bot will play (its engine file is what JS bots get as `helpers`)
 */
async function prepareBot(playerId, lang, code, opts = {}) {
    const enginePathHost = (opts.game && opts.game.enginePath) || path.join(__dirname, 'engine.js');
    const safeId = playerId.replace(/[^a-zA-Z0-9_-]/g, '_');

    if ((lang === 'python' || lang === 'cpp') && toolchains[lang].ok === false) {
        return { success: false, error: toolchains[lang].hint };
    }
    const refused = sandbox.guard(lang);
    if (refused) return { success: false, error: refused };

    if (lang === 'cpp') {
        const srcPath = path.join(TEMP_DIR, `bot_${safeId}.cpp`);
        const exePath = path.join(TEMP_DIR, `bot_${safeId}.exe`);
        fs.writeFileSync(srcPath, code, 'utf-8');

        const bad = sandbox.scanCppSource(code);
        if (bad) { try { fs.unlinkSync(srcPath); } catch (e) {} return { success: false, error: `Lỗi biên dịch C++:\n${bad}` }; }

        // g++ runs inside the sandbox too (limits + no network / no host files on the strong tier)
        const out = await sandbox.compileCpp(srcPath, exePath);
        if (!out.ok) {
            try { fs.unlinkSync(srcPath); } catch (e) {}
            if (out.code === 127 || (/not recognized|not found|ENOENT/i.test(out.text) && !/error:/i.test(out.text))) {
                return { success: false, error: HINTS.cpp };
            }
            return { success: false, error: `Lỗi biên dịch C++:\n${out.text || 'biên dịch thất bại (quá thời gian hoặc hết bộ nhớ)'}` };
        }
        return { success: true, botHandler: { lang: 'cpp', exePath, srcPath, enginePath: enginePathHost } };
    }

    if (lang === 'python') {
        const scriptPath = path.join(TEMP_DIR, `bot_${safeId}.py`);
        fs.writeFileSync(scriptPath, code, 'utf-8');
        return {
            success: true,
            botHandler: {
                lang: 'python',
                scriptPath,
                enginePath: enginePathHost
            }
        };
    }

    if (lang === 'javascript') {
        // The bot's code becomes the body of a function that runs once per move, so every move starts from a
        // fresh scope exactly as when each move was a new process (and as in the browser, bot_worker.js).
        // The wrapper is a small line server: one JSON state per stdin line, one framed answer per move.
        const enginePath = JSON.stringify(enginePathHost);
        const wrapperCode = `function __ottBot(state, helpers, log) {
${code}
;if (typeof getNextMove !== 'function') { throw new Error('Không tìm thấy hàm getNextMove(state, helpers, log)'); }
return getNextMove(state, helpers, log);
}
;(function __ottServe() {
    const __E = require(${enginePath});
    const fmt = (args) => args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    let logs = [];
    const log = (...args) => { logs.push(fmt(args)); };
    // console output of the bot is part of its log (it used to be printed by the bot's own process)
    console.log = console.info = console.debug = console.error = console.warn = log;
    const helpersFor = (rules) => {
        // Helpers come from the GAME's own engine file; the rules of this game travel inside state.rules
        const helpers = {
            distance: (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)),
            randomChoice: (arr) => arr[Math.floor(Math.random() * arr.length)]
        };
        const bind = (name, fn) => { if (typeof __E[name] === 'function') helpers[name] = fn; };
        bind('canCapture', (a, b) => __E.canCapture(a, b, rules));
        bind('simulateMove', (board, move, player) => __E.simulateMove(board, move, player, rules));
        bind('getLegalMoves', (player, board) => __E.getLegalMoves(player, board, rules));
        bind('toNotation', (r, c) => __E.toNotation(r, c, rules));
        bind('fromNotation', (s) => __E.fromNotation(s, rules));
        bind('checkWin', (board) => __E.checkWin(board, rules));
        if (typeof __E.countPieces === 'function') helpers.getPieceCounts = (player, board) => __E.countPieces(player, board);
        if (typeof __E.getPieces === 'function') helpers.getPieces = (player, board) => __E.getPieces(player, board);
        return helpers;
    };
    function answer(line) {
        let out = '';
        try {
            const state = JSON.parse(line);
            const move = __ottBot(state, helpersFor(state.rules), log);
            if (move && move.to) out = JSON.stringify(move.from ? { from: move.from, to: move.to } : { to: move.to });
        } catch (e) {
            logs.push(e && e.stack ? e.stack : String(e));
        }
        const err = logs.join('\\n');
        logs = [];
        process.stdout.write('\\u0001OTT ' + JSON.stringify({ out, err }) + '\\n');
    }
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => {
        buf += d;
        for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (line.trim()) answer(line);
        }
    });
})();
`;
        const scriptPath = path.join(TEMP_DIR, `bot_${safeId}.js`);
        fs.writeFileSync(scriptPath, wrapperCode, 'utf-8');
        return {
            success: true,
            botHandler: {
                lang: 'javascript',
                scriptPath,
                enginePath: enginePathHost      // mounted read-only in the sandbox: the wrapper requires it for helpers
            }
        };
    }

    return { success: false, error: `Ngôn ngữ không được hỗ trợ: ${lang}` };
}

// ----- warm bot processes -----
// Starting a bot process costs more CPU than most bots spend thinking (Node ~25ms, Python ~20ms, plus the
// sandbox), and it used to happen on EVERY move. JavaScript and Python bots now run as small line servers
// (see the JS wrapper above and sandbox_py.py --serve): a process stays "warm" after a move and answers the
// next one of the same bot. Each move still starts from a fresh scope, so nothing changes for bot authors.
// C++ bots are already compiled programs that start in about a millisecond: they keep one process per move.
//   WARM_BOTS=0                 turn it off (one process per move, as before)
//   WARM_BOTS_MEM_MB            RAM the idle + busy warm processes may use (default 40% of the machine)
//   WARM_BOTS_IDLE_SEC (30)     an unused warm process is stopped after this
//   WARM_BOTS_MAX_MOVES (100)   a process is replaced after this many moves (bounded memory / CPU budget)
// When the budget is full, only a process that has been idle for a while (WARM_BOTS_EVICT_SEC) gives up its
// place; otherwise the move runs in a one-off process, exactly as before. Evicting a process that is between
// two moves of a live game would cost as much as it saves, which is what happens when more games run than the
// budget holds, so the server degrades to the old speed instead of thrashing.
const WARM_ENABLED = process.env.WARM_BOTS !== '0';
const WARM_MEM_MB = parseInt(process.env.WARM_BOTS_MEM_MB, 10) || Math.floor(os.totalmem() / 1048576 * 0.4);
const WARM_IDLE_MS = (parseInt(process.env.WARM_BOTS_IDLE_SEC, 10) || 30) * 1000;
const WARM_MAX_MOVES = parseInt(process.env.WARM_BOTS_MAX_MOVES, 10) || 100;
const WARM_EVICT_MS = (parseInt(process.env.WARM_BOTS_EVICT_SEC, 10) || 5) * 1000;
const WARM_COST_MB = { javascript: 48, python: 16 };     // measured resident size of an idle bot process
const FRAME = '\u0001OTT ';
const warm = { usedMB: 0, alive: new Set(), idle: new Set(), started: 0, reused: 0, oneOff: 0, evicted: 0 };

/** One bot process speaking the line protocol. request() never rejects. */
class BotProcess {
    constructor(handler, isWarm) {
        this.handler = handler;
        this.warm = isWarm;
        this.cost = isWarm ? WARM_COST_MB[handler.lang] || 48 : 0;
        this.moves = 0;
        this.dead = false;
        this.pending = null;
        this.buf = '';
        this.strayErr = '';
        this.idleTimer = null;
        const spec = sandbox.wrapRun(handler, { pythonCmd: PYTHON_CMD, warm: isWarm });
        try {
            this.child = spawn(spec.cmd, spec.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...childEnv(), ...spec.env }, windowsHide: true });
        } catch (err) {
            this.child = null;
            this.dead = true;
            this.spawnError = err;
            return;
        }
        liveChildren.add(this.child);
        if (isWarm) { warm.usedMB += this.cost; warm.alive.add(this); }
        this.child.stdout.on('data', (d) => this.onOut(d));
        this.child.stderr.on('data', (d) => this.onErr(d));
        this.child.stdin.on('error', () => { /* the bot died: reported by 'close' */ });
        this.child.on('error', (err) => { this.spawnError = err; this.onExit(); });
        this.child.on('close', () => this.onExit());
    }

    request(state, timeoutMs) {
        return new Promise((resolve) => {
            if (this.dead) return resolve({ dead: true, out: '', err: '', spawnError: this.spawnError });
            this.setRef(true);
            const p = { resolve, out: '', err: this.strayErr, bytes: 0, timer: null };
            this.strayErr = '';
            p.timer = setTimeout(() => { p.timedOut = true; this.kill(); }, timeoutMs);
            this.pending = p;
            try { this.child.stdin.write(JSON.stringify(state) + '\n'); } catch (e) { /* see 'close' */ }
        });
    }

    count(p, n) {
        p.bytes += n;
        if (p.bytes > MAX_BOT_OUTPUT_BYTES) { p.tooBig = true; this.kill(); return false; }
        return true;
    }

    onOut(d) {
        const p = this.pending;
        const text = d.toString();
        if (!p) { this.buf = ''; return; }                      // output between moves: ignored
        if (!this.count(p, text.length)) return;
        this.buf += text;
        for (let i = this.buf.indexOf('\n'); i >= 0 && this.pending; i = this.buf.indexOf('\n')) {
            const line = this.buf.slice(0, i);
            this.buf = this.buf.slice(i + 1);
            if (line.startsWith(FRAME)) {
                let frame = null;
                try { frame = JSON.parse(line.slice(FRAME.length)); } catch (e) { /* treated as plain output */ }
                if (frame && typeof frame === 'object') {
                    this.settle({ out: p.out + String(frame.out || ''), err: p.err + String(frame.err || '') });
                    continue;
                }
            }
            p.out += line + '\n';                               // the bot wrote to the real stdout itself
        }
    }

    onErr(d) {
        const text = d.toString();
        const p = this.pending;
        if (!p) { this.strayErr = (this.strayErr + text).slice(-65536); return; }   // late logs go with the next move
        if (this.count(p, text.length)) p.err += text;
    }

    onExit() {
        if (this.exited) return;                                // 'error' and 'close' can both arrive
        this.exited = true;
        this.dead = true;
        if (this.child) liveChildren.delete(this.child);
        this.release();
        const p = this.pending;
        if (p) this.settle({ dead: true, out: p.out + this.buf, err: p.err, timedOut: p.timedOut, tooBig: p.tooBig, spawnError: this.spawnError });
    }

    settle(result) {
        const p = this.pending;
        if (!p) return;
        clearTimeout(p.timer);
        this.pending = null;
        this.moves++;
        p.resolve(result);
    }

    setRef(on) {
        if (!this.child) return;
        // an idle warm process must not keep the server (or a test run) alive
        for (const x of [this.child, this.child.stdin, this.child.stdout, this.child.stderr]) {
            try { if (on) x.ref(); else x.unref(); } catch (e) { /* not supported */ }
        }
    }

    release() {
        clearTimeout(this.idleTimer);
        warm.idle.delete(this);
        if (this.handler.warmIdle) this.handler.warmIdle.delete(this);
        if (warm.alive.delete(this)) warm.usedMB -= this.cost;
    }

    kill() {
        if (this.child && !this.dead) { try { this.child.kill('SIGKILL'); } catch (e) { /* gone */ } }
        this.release();
    }

    park() {
        this.parkedAt = Date.now();
        this.setRef(false);
        this.handler.warmIdle.add(this);
        warm.idle.add(this);
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.kill(), WARM_IDLE_MS);
        this.idleTimer.unref();
    }
}

/** A warm slot for one more process of this language, taking the place of long-idle ones if needed. */
function warmRoom(lang) {
    if (!WARM_ENABLED) return false;
    const need = WARM_COST_MB[lang] || 48;
    const stale = Date.now() - WARM_EVICT_MS;
    for (const p of warm.idle) {                                  // oldest idle first
        if (warm.usedMB + need <= WARM_MEM_MB) break;
        if (p.parkedAt > stale) break;                            // still in use by a live game: leave it alone
        p.kill();
        warm.evicted++;
    }
    return warm.usedMB + need <= WARM_MEM_MB;
}

function takeWarm(handler) {
    if (!handler.warmIdle) handler.warmIdle = new Set();
    for (const p of handler.warmIdle) {
        handler.warmIdle.delete(p);
        warm.idle.delete(p);
        clearTimeout(p.idleTimer);
        if (!p.dead) return p;
    }
    return null;
}

/**
 * Executes a prepared bot to calculate its move for current board state.
 * @param {object} botHandler
 * @param {object} state JSON state object
 * @param {number} timeoutMs Execution timeout in ms
 * @returns {Promise<{ move: object|null, log: string, elapsed: number, error?: string }>}
 */
async function executeBotMove(botHandler, state, timeoutMs = 2500) {
    await botSlots.acquire();
    try {
        if (botHandler.lang === 'javascript' || botHandler.lang === 'python') return await runServed(botHandler, state, timeoutMs);
        return await runBotOnce(botHandler, state, timeoutMs);
    } finally { botSlots.release(); }
}

async function runServed(handler, state, timeoutMs) {
    const startTime = Date.now();
    let proc = takeWarm(handler);
    const reused = !!proc;
    if (reused) warm.reused++;
    else {
        const isWarm = !handler.closed && warmRoom(handler.lang);
        proc = new BotProcess(handler, isWarm);
        if (isWarm) warm.started++; else warm.oneOff++;
    }
    let r = await proc.request(state, timeoutMs);
    if (r.dead && reused && !r.timedOut && !r.tooBig && !r.out && !r.err) {
        // a warm process that dies without a word (its CPU budget ran out, killed meanwhile...) is not the
        // bot's fault: the move runs again in a fresh process, within the time that is left
        const left = timeoutMs - (Date.now() - startTime);
        if (left > 50) { proc = new BotProcess(handler, false); warm.oneOff++; r = await proc.request(state, left); }
    }
    const keep = proc.warm && !r.dead && !handler.closed && proc.moves < WARM_MAX_MOVES;
    if (keep) proc.park(); else proc.kill();
    return toResult(r, Date.now() - startTime, timeoutMs, handler);
}

function toResult(r, elapsed, timeoutMs, handler) {
    if (r.spawnError) {
        const missing = r.spawnError.code === 'ENOENT' && handler.lang === 'python' ? HINTS.python : null;
        return { move: null, log: '', elapsed, error: missing || `Lỗi tiến trình: ${r.spawnError.message}` };
    }
    if (r.tooBig) return { move: null, log: r.err.slice(0, 500), elapsed, error: 'Bot in ra quá nhiều dữ liệu (>1MB) nên bị dừng' };
    if (r.timedOut) return { move: null, log: r.err, elapsed, error: `Quá thời gian quy định (${timeoutMs}ms)` };
    return parseOutput(r.out, r.err, elapsed);
}

/** The bot's move = the last JSON line of its stdout with a `to` (and, in games where pieces move, a `from`). */
function parseOutput(stdoutData, stderrData, elapsed) {
    try {
        const lines = stdoutData.trim().split('\n');
        let foundMove = null;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.startsWith('{') && line.endsWith('}')) {
                const parsed = JSON.parse(line);
                // `to` is always required; `from` only exists in games where pieces move (the game checks it)
                if (parsed.to && parsed.to.r !== undefined && parsed.to.c !== undefined &&
                    (parsed.from === undefined || (parsed.from && parsed.from.r !== undefined))) {
                    foundMove = parsed.from ? { from: parsed.from, to: parsed.to } : { to: parsed.to };
                    break;
                }
            }
        }
        if (foundMove) return { move: foundMove, log: stderrData || stdoutData, elapsed };
        return {
            move: null,
            log: stderrData || stdoutData,
            elapsed,
            error: `Bot không in ra nước đi hợp lệ dưới dạng JSON: ${stdoutData.slice(0, 150)}`
        };
    } catch (err) {
        return { move: null, log: stderrData || stdoutData, elapsed, error: `Lỗi đọc output: ${err.message}` };
    }
}

/** C++: one process per move (a compiled program starts in about a millisecond). */
function runBotOnce(botHandler, state, timeoutMs) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const spec = sandbox.wrapRun(botHandler, { pythonCmd: PYTHON_CMD });

        let child;
        try {
            child = spawn(spec.cmd, spec.args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv(), windowsHide: true });
        } catch (err) {
            return resolve({
                move: null,
                log: '',
                elapsed: Date.now() - startTime,
                error: `Không thể khởi chạy tiến trình: ${err.message}`
            });
        }

        let stdoutData = '';
        let stderrData = '';
        let isTimedOut = false;

        const timer = setTimeout(() => {
            isTimedOut = true;
            try { child.kill('SIGKILL'); } catch (e) {}
        }, timeoutMs);

        liveChildren.add(child);
        let outputTooBig = false;
        const capture = (data, which) => {
            if (outputTooBig) return;
            if (which === 'out') stdoutData += data.toString(); else stderrData += data.toString();
            if (stdoutData.length + stderrData.length > MAX_BOT_OUTPUT_BYTES) {
                outputTooBig = true;
                try { child.kill('SIGKILL'); } catch (e) {}
            }
        };
        child.stdout.on('data', (d) => capture(d, 'out'));
        child.stderr.on('data', (d) => capture(d, 'err'));
        child.stdin.on('error', () => { /* bot exited without reading stdin (EPIPE) - handled by 'close' */ });

        child.on('close', () => {
            liveChildren.delete(child);
            clearTimeout(timer);
            const elapsed = Date.now() - startTime;
            if (outputTooBig) {
                return resolve({ move: null, log: stderrData.slice(0, 500), elapsed, error: 'Bot in ra quá nhiều dữ liệu (>1MB) nên bị dừng' });
            }
            if (isTimedOut) {
                return resolve({ move: null, log: stderrData, elapsed, error: `Quá thời gian quy định (${timeoutMs}ms)` });
            }
            resolve(parseOutput(stdoutData, stderrData, elapsed));
        });

        child.on('error', (err) => {
            liveChildren.delete(child);
            clearTimeout(timer);
            resolve({ move: null, log: '', elapsed: Date.now() - startTime, error: `Lỗi tiến trình: ${err.message}` });
        });

        // Send state to stdin
        try {
            child.stdin.write(JSON.stringify(state));
            child.stdin.end();
        } catch (e) {
            // Write error
        }
    });
}

function cleanupBot(botHandler) {
    botHandler.closed = true;                  // a process still answering a move is stopped when it is done
    if (botHandler.warmIdle) { for (const p of [...botHandler.warmIdle]) p.kill(); }
    try {
        if (botHandler.exePath && fs.existsSync(botHandler.exePath)) fs.unlinkSync(botHandler.exePath);
        if (botHandler.srcPath && fs.existsSync(botHandler.srcPath)) fs.unlinkSync(botHandler.srcPath);
        if (botHandler.scriptPath && fs.existsSync(botHandler.scriptPath)) fs.unlinkSync(botHandler.scriptPath);
    } catch (e) {}
}

/** Remove leftovers from a previous run (crashes / kill -9). */
function cleanupTempDir() {
    try {
        for (const f of fs.readdirSync(TEMP_DIR)) {
            if (/^bot_.*\.(js|py|cpp|exe)$/.test(f)) {
                try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch (e) {}
            }
        }
    } catch (e) {}
}

/** Kill every bot process that is still running (graceful shutdown). */
function killAll() {
    for (const p of [...warm.alive]) p.kill();
    for (const c of liveChildren) { try { c.kill('SIGKILL'); } catch (e) { /* already gone */ } }
    liveChildren.clear();
}
const getStats = () => ({
    bots: botSlots.stats(),
    compiles: sandbox.getCompileStats(),
    warm: {
        enabled: WARM_ENABLED, alive: warm.alive.size, idle: warm.idle.size, memMB: warm.usedMB, memBudgetMB: WARM_MEM_MB,
        started: warm.started, reused: warm.reused, oneOff: warm.oneOff, evicted: warm.evicted
    }
});

module.exports = {
    killAll,
    getStats,
    detectToolchains,
    getToolchains,
    getSandboxStatus: sandbox.getStatus,
    cleanupTempDir,
    prepareBot,
    executeBotMove,
    cleanupBot
};
