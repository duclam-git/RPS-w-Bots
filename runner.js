// ===== OTTv2 Code Arena - Multi-Language Code Runner =====
// Supports C++ (g++), Python 3 (python), and JavaScript (Node.js) via Standard JSON I/O

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, 'temp_bots');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Prepares and compiles/verifies a bot before match begins.
 * @param {string} playerId Unique identifier
 * @param {string} lang 'javascript' | 'python' | 'cpp'
 * @param {string} code Source code string
 * @returns {Promise<{ success: boolean, error?: string, botHandler?: object }>}
 */
async function prepareBot(playerId, lang, code) {
    const safeId = playerId.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (lang === 'cpp') {
        const srcPath = path.join(TEMP_DIR, `bot_${safeId}.cpp`);
        const exePath = path.join(TEMP_DIR, `bot_${safeId}.exe`);
        fs.writeFileSync(srcPath, code, 'utf-8');

        // Compile with g++
        return new Promise((resolve) => {
            const compileCmd = `g++ -O2 -std=c++17 "${srcPath}" -o "${exePath}"`;
            exec(compileCmd, { timeout: 15000 }, (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        success: false,
                        error: `Lỗi biên dịch C++:\n${stderr || stdout || error.message}`
                    });
                } else {
                    resolve({
                        success: true,
                        botHandler: {
                            lang: 'cpp',
                            exePath,
                            srcPath
                        }
                    });
                }
            });
        });
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
        const wrapperCode = `
const fs = require('fs');
${code}

try {
    const input = fs.readFileSync(0, 'utf-8');
    if (input.trim()) {
        const state = JSON.parse(input);
        const helpers = {
            distance: (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)),
            canCapture: (a, b) => {
                const beats = { rock: ['scissors'], paper: ['rock'], scissors: ['paper'] };
                return beats[a] && beats[a].includes(b);
            }
        };
        const log = (...args) => {};
        if (typeof getNextMove === 'function') {
            const move = getNextMove(state, helpers, log);
            if (move && move.from && move.to) {
                console.log(JSON.stringify({ from: move.from, to: move.to }));
            }
        }
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
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
        let cmd = '';
        let args = [];

        if (botHandler.lang === 'cpp') {
            cmd = botHandler.exePath;
            args = [];
        } else if (botHandler.lang === 'python') {
            cmd = 'python';
            args = [botHandler.scriptPath];
        } else if (botHandler.lang === 'javascript') {
            cmd = 'node';
            args = [botHandler.scriptPath];
        }

        let child;
        try {
            child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
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

        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            const elapsed = Date.now() - startTime;

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
            resolve({
                move: null,
                log: '',
                elapsed: Date.now() - startTime,
                error: `Lỗi tiến trình: ${err.message}`
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

module.exports = {
    prepareBot,
    executeBotMove,
    cleanupBot
};
