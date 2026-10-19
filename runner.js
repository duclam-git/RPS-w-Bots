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

const sandbox = require('./sandbox');

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
async function prepareBot(playerId, lang, code) {
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
        return { success: true, botHandler: { lang: 'cpp', exePath, srcPath } };
    }

    if (lang === 'python') {
        const scriptPath = path.join(TEMP_DIR, `bot_${safeId}.py`);
        fs.writeFileSync(scriptPath, code, 'utf-8');
        return {
            success: true,
            botHandler: {
                lang: 'python',
                scriptPath
            }
        };
    }

    if (lang === 'javascript') {
        // Wrap JS code into a runner script that handles stdin/stdout JSON
        const enginePath = JSON.stringify(path.join(__dirname, 'engine.js'));
        const wrapperCode = `
${code}

;(function __ottMain() {
    try {
        const __fs = require('fs');
        const __E = require(${enginePath});
        const input = __fs.readFileSync(0, 'utf-8');
        if (!input.trim()) return;
        const state = JSON.parse(input);
        const helpers = {
            distance: (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)),
            canCapture: (a, b) => __E.canCapture(a, b),
            simulateMove: (board, move) => __E.simulateMove(board, move),
            getLegalMoves: (player, board) => __E.getLegalMoves(player, board),
            toNotation: (r, c) => __E.toNotation(r, c),
            fromNotation: (s) => __E.fromNotation(s),
            randomChoice: (arr) => arr[Math.floor(Math.random() * arr.length)],
            getPieceCounts: (player, board) => __E.countPieces(player, board),
            getPieces: (player, board) => __E.getPieces(player, board)
        };
        const log = (...args) => { console.error(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); };
        if (typeof getNextMove === 'function') {
            const move = getNextMove(state, helpers, log);
            if (move && move.from && move.to) {
                console.log(JSON.stringify({ from: move.from, to: move.to }));
            }
        } else {
            console.error('Không tìm thấy hàm getNextMove(state, helpers, log)');
            process.exit(1);
        }
    } catch (e) {
        console.error(e && e.stack ? e.stack : String(e));
        process.exit(1);
    }
})();
`;
        const scriptPath = path.join(TEMP_DIR, `bot_${safeId}.js`);
        fs.writeFileSync(scriptPath, wrapperCode, 'utf-8');
        return {
            success: true,
            botHandler: {
                lang: 'javascript',
                scriptPath
            }
        };
    }

    return { success: false, error: `Ngôn ngữ không được hỗ trợ: ${lang}` };
}

/**
 * Executes a prepared bot to calculate its move for current board state.
 * @param {object} botHandler
 * @param {object} state JSON state object
 * @param {number} timeoutMs Execution timeout in ms
 * @returns {Promise<{ move: object|null, log: string, elapsed: number, error?: string }>}
 */
function executeBotMove(botHandler, state, timeoutMs = 2500) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const spec = sandbox.wrapRun(botHandler, { pythonCmd: PYTHON_CMD });
        const cmd = spec.cmd;
        const args = spec.args;

        let child;
        try {
            child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv(), windowsHide: true });
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

        child.on('close', (code) => {
            clearTimeout(timer);
            const elapsed = Date.now() - startTime;

            if (outputTooBig) {
                return resolve({
                    move: null,
                    log: stderrData.slice(0, 500),
                    elapsed,
                    error: 'Bot in ra quá nhiều dữ liệu (>1MB) nên bị dừng'
                });
            }

            if (isTimedOut) {
                return resolve({
                    move: null,
                    log: stderrData,
                    elapsed,
                    error: `Quá thời gian quy định (${timeoutMs}ms)`
                });
            }

            try {
                // Find JSON move object in stdout
                const lines = stdoutData.trim().split('\n');
                let foundMove = null;
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i].trim();
                    if (line.startsWith('{') && line.endsWith('}')) {
                        const parsed = JSON.parse(line);
                        if (parsed.from && parsed.to && parsed.from.r !== undefined && parsed.to.r !== undefined) {
                            foundMove = parsed;
                            break;
                        }
                    }
                }

                if (foundMove) {
                    resolve({
                        move: foundMove,
                        log: stderrData || stdoutData,
                        elapsed
                    });
                } else {
                    resolve({
                        move: null,
                        log: stderrData || stdoutData,
                        elapsed,
                        error: `Bot không in ra nước đi hợp lệ dưới dạng JSON: ${stdoutData.slice(0, 150)}`
                    });
                }
            } catch (err) {
                resolve({
                    move: null,
                    log: stderrData || stdoutData,
                    elapsed,
                    error: `Lỗi đọc output: ${err.message}`
                });
            }
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            const missing = err.code === 'ENOENT' && botHandler.lang === 'python' ? HINTS.python : null;
            resolve({
                move: null,
                log: '',
                elapsed: Date.now() - startTime,
                error: missing || `Lỗi tiến trình: ${err.message}`
            });
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

module.exports = {
    detectToolchains,
    getToolchains,
    getSandboxStatus: sandbox.getStatus,
    cleanupTempDir,
    prepareBot,
    executeBotMove,
    cleanupBot
};
