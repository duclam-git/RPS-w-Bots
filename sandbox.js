// ===== OTTv2 Code Arena - Sandbox for untrusted bot code =====
//
// Bots are code written by other people and run on this machine. Two tiers:
//
//  STRONG  (Linux + bubblewrap)  every bot runs in fresh namespaces: no network, no view of the host
//          filesystem (only the bot's own file + read-only system libraries), read-only system, empty
//          tmpfs, own PID space (killing the launcher kills every descendant), CPU / memory / file limits.
//          Works for JavaScript, Python AND C++ (native code cannot escape a namespace).
//
//  BASIC   (every OS, always available)
//          JavaScript  Node's permission model (--permission): no child processes, no file writes,
//                      reads limited to the bot + engine.js
//          Python      sandbox_py.py: audit hook (no processes / sockets / ctypes / writes / foreign
//                      reads) + rlimits
//          C++         POSIX rlimits only. A compiled program can still do anything the server's user
//                      can -> NOT confined. Use the strong tier (or don't accept untrusted C++).
//
// Config (environment):
//   SANDBOX=auto|bwrap|builtin|off   default auto (strongest available).  bwrap = demand the strong tier.
//   SANDBOX_STRICT=1                 refuse to run a language unless it is confined by the STRONG tier
//   SANDBOX_MEM_MB (512)  SANDBOX_CPU_SEC (10)  SANDBOX_COMPILE_MEM_MB (2048)

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const IS_LINUX = process.platform === 'linux';
const IS_WIN = process.platform === 'win32';
const MEM_MB = parseInt(process.env.SANDBOX_MEM_MB, 10) || 512;
const CPU_SEC = parseInt(process.env.SANDBOX_CPU_SEC, 10) || 10;
const COMPILE_MEM_MB = parseInt(process.env.SANDBOX_COMPILE_MEM_MB, 10) || 2048;
const NODE_HEAP_MB = 128;
const LAUNCHER = path.join(__dirname, 'sandbox_py.py');
const ENGINE = path.join(__dirname, 'engine.js');
const SYS_ROOTS = ['/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32'];

const state = {
    mode: String(process.env.SANDBOX || 'auto').toLowerCase(),
    strict: process.env.SANDBOX_STRICT === '1',
    detected: false,
    driver: 'builtin',                   // bwrap | builtin | off
    bwrapPath: null,
    bwrapVersion: '',
    nodeFlag: null,                      // --permission | --experimental-permission | null
    prlimit: false,
    levels: { javascript: 'none', python: 'none', cpp: 'none' },   // strong | basic | weak | none
    notes: []
};

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
function which(cmd) {
    if (!cmd) return null;
    if (cmd.includes('/') || cmd.includes('\\')) return fs.existsSync(cmd) ? path.resolve(cmd) : null;
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        const p = path.join(dir, cmd);
        try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch (e) { /* next */ }
    }
    return null;
}

const underSys = (p) => SYS_ROOTS.some(r => p === r || p.startsWith(r + '/'));

/** Read-only mounts so a tool living outside /usr (nvm, pyenv, /opt…) still runs inside the sandbox. */
function toolMounts(abs) {
    const out = [];
    const seen = new Set();
    let real = abs;
    try { real = fs.realpathSync(abs); } catch (e) { /* keep abs */ }
    for (const p of [abs, real]) {
        if (underSys(p)) continue;
        const prefix = path.dirname(path.dirname(p));
        if (prefix === '/' || seen.has(prefix)) continue;
        seen.add(prefix);
        out.push('--ro-bind', prefix, prefix);
    }
    return out;
}

function systemMounts() {
    const args = [];
    for (const p of SYS_ROOTS) {
        let st;
        try { st = fs.lstatSync(p); } catch (e) { continue; }
        if (st.isSymbolicLink()) args.push('--symlink', fs.readlinkSync(p), p);
        else args.push('--ro-bind', p, p);
    }
    for (const p of ['/etc/alternatives', '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d']) {
        if (fs.existsSync(p)) args.push('--ro-bind', p, p);
    }
    return args;
}

function bwrapBase(extra) {
    return [
        '--unshare-all',                 // user, ipc, pid, net (NO network), uts, cgroup
        '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
        '--setenv', 'PATH', '/usr/bin:/bin',
        '--setenv', 'HOME', '/tmp',
        '--setenv', 'LANG', 'C.UTF-8',
        '--setenv', 'PYTHONIOENCODING', 'utf-8', '--setenv', 'PYTHONUTF8', '1',
        '--setenv', 'OTT_MEM_MB', String(MEM_MB), '--setenv', 'OTT_CPU_SEC', String(CPU_SEC),
        ...systemMounts(),
        '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
        ...extra
    ];
}

/** prlimit prefix: CPU seconds, no files, no core. RLIMIT_AS is skipped for Node (V8 reserves huge address space). */
function limitPrefix({ addressSpace }) {
    if (!state.prlimit) return [];
    const p = ['prlimit', `--cpu=${CPU_SEC}`, '--nofile=64', '--core=0', '--fsize=0'];
    if (addressSpace) p.push(`--as=${MEM_MB * 1024 * 1024}`);
    p.push('--');
    return p;
}

function run(cmd, args, timeoutMs = 8000) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true }, (err, stdout, stderr) => {
            resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

// ---------------------------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------------------------
async function detect({ pythonCmd = 'python3' } = {}) {
    state.notes = [];
    state.bwrapPath = null; state.bwrapVersion = '';
    state.levels = { javascript: 'none', python: 'none', cpp: 'none' };

    if (state.mode === 'off') {
        state.driver = 'off';
        state.notes.push('SANDBOX=off: bot chạy không có lớp bảo vệ nào ngoài giới hạn thời gian/dung lượng output.');
        state.detected = true;
        return getStatus();
    }

    // Node permission model
    state.nodeFlag = null;
    for (const flag of ['--permission', '--experimental-permission']) {
        const r = await run(process.execPath, [flag, '-e', '0'], 8000);
        if (r.ok) { state.nodeFlag = flag; break; }
    }
    state.prlimit = IS_LINUX && !!which('prlimit');

    // bubblewrap
    let strong = { javascript: false, python: false, cpp: false };
    if (state.mode !== 'builtin') {
        if (!IS_LINUX) {
            state.notes.push('Sandbox mạnh (bubblewrap) chỉ có trên Linux; hệ điều hành này dùng tầng cơ bản.');
        } else {
            const bwrap = which('bwrap');
            if (!bwrap) {
                state.notes.push('Chưa cài bubblewrap (apt install bubblewrap) → chỉ có tầng cơ bản.');
            } else {
                const ver = await run(bwrap, ['--version']);
                state.bwrapVersion = ver.stdout.trim();
                state.bwrapPath = bwrap;
                const probes = {
                    javascript: [process.execPath, ['-e', '0']],
                    python: [which(pythonCmd), ['-c', 'pass']],
                    cpp: [which('g++'), ['--version']]
                };
                for (const [lang, [bin, args]] of Object.entries(probes)) {
                    if (!bin) continue;        // toolchain missing: nothing to confine (runner reports it)
                    const r = await run(bwrap, [...bwrapBase(toolMounts(bin)), '--', bin, ...args]);
                    strong[lang] = r.ok;
                    if (!r.ok) {
                        state.notes.push(`bubblewrap không chạy được ${lang}: ${r.stderr.trim().split('\n')[0] || 'lỗi không rõ'}` +
                            (/namespace|permission|operation not permitted/i.test(r.stderr) ? ' (kernel/AppArmor có thể đang chặn user namespace)' : ''));
                    }
                }
            }
        }
    }

    state.driver = Object.values(strong).some(Boolean) ? 'bwrap' : 'builtin';
    state.levels.javascript = strong.javascript ? 'strong' : state.nodeFlag ? 'basic' : 'none';
    state.levels.python = strong.python ? 'strong' : 'basic';
    state.levels.cpp = strong.cpp ? 'strong' : (IS_WIN ? 'none' : 'weak');
    if (!state.nodeFlag && !strong.javascript) state.notes.push('Node này chưa có mô hình quyền (--permission, cần Node ≥ 20): JavaScript chưa được cách ly.');
    if (state.levels.cpp !== 'strong') state.notes.push('C++ KHÔNG được cách ly ở tầng cơ bản — chỉ nên nhận C++ từ người tin cậy, hoặc bật bubblewrap.');
    if (state.mode === 'bwrap' && state.driver !== 'bwrap') state.notes.push('SANDBOX=bwrap nhưng bubblewrap không khả dụng: bot sẽ bị từ chối.');
    state.detected = true;
    return getStatus();
}

const requireStrong = () => state.strict || state.mode === 'bwrap';

/** null when the language may run, otherwise the reason it is refused (strict deployments). */
function guard(lang) {
    if (state.mode === 'off' || !requireStrong()) return null;
    if (state.levels[lang] === 'strong') return null;
    return 'Máy chủ này yêu cầu sandbox mạnh (Linux + bubblewrap) cho mọi code bot nhưng nó chưa khả dụng, nên ngôn ngữ ' +
        `${lang} bị từ chối. Quản trị viên: xem trang Quản trị → Bảo mật.`;
}

function getStatus() {
    return {
        mode: state.mode, strict: requireStrong(), driver: state.driver,
        bwrap: state.bwrapPath ? { path: state.bwrapPath, version: state.bwrapVersion } : null,
        nodePermission: state.nodeFlag, levels: { ...state.levels }, notes: [...state.notes],
        limits: { memoryMB: MEM_MB, cpuSeconds: CPU_SEC, nodeHeapMB: NODE_HEAP_MB }
    };
}

// ---------------------------------------------------------------------------------------------
// running a bot
// ---------------------------------------------------------------------------------------------

/**
 * @param {{lang:string, scriptPath?:string, exePath?:string}} handler
 * @param {{pythonCmd:string}} ctx
 * @returns {{cmd:string, args:string[], tier:string}}
 */
function wrapRun(handler, { pythonCmd }) {
    const lang = handler.lang;
    const level = state.mode === 'off' ? 'none' : state.levels[lang];

    // ---- strong tier ----
    if (level === 'strong' && state.bwrapPath) {
        let inner, binds;
        if (lang === 'javascript') {
            binds = ['--ro-bind', handler.scriptPath, '/bot/bot.js', '--ro-bind', ENGINE, ENGINE, ...toolMounts(process.execPath)];
            inner = [...limitPrefix({ addressSpace: false }), process.execPath, `--max-old-space-size=${NODE_HEAP_MB}`, '/bot/bot.js'];
        } else if (lang === 'python') {
            const py = which(pythonCmd);
            binds = ['--ro-bind', handler.scriptPath, '/bot/bot.py', '--ro-bind', LAUNCHER, '/bot/launcher.py', ...toolMounts(py)];
            inner = [...limitPrefix({ addressSpace: true }), py, '-X', 'utf8', '-B', '/bot/launcher.py', '/bot/bot.py'];
        } else {
            binds = ['--ro-bind', handler.exePath, '/bot/bot.exe'];
            inner = [...limitPrefix({ addressSpace: true }), '/bot/bot.exe'];
        }
        return { cmd: state.bwrapPath, args: [...bwrapBase(binds), '--', ...inner], tier: 'strong' };
    }

    // ---- basic tier / off ----
    if (lang === 'javascript') {
        if (level === 'basic' && state.nodeFlag) {
            return {
                cmd: process.execPath, tier: 'basic',
                args: [state.nodeFlag, `--allow-fs-read=${handler.scriptPath}`, `--allow-fs-read=${ENGINE}`,
                    `--max-old-space-size=${NODE_HEAP_MB}`, handler.scriptPath]
            };
        }
        return { cmd: process.execPath, args: [handler.scriptPath], tier: 'none' };
    }
    if (lang === 'python') {
        if (state.mode === 'off') return { cmd: pythonCmd, args: [handler.scriptPath], tier: 'none' };
        return { cmd: pythonCmd, args: ['-X', 'utf8', '-B', LAUNCHER, handler.scriptPath], tier: 'basic' };
    }
    // cpp
    if (level === 'weak' && !IS_WIN) {
        return {
            cmd: 'sh', tier: 'weak',
            args: ['-c', `ulimit -c 0 -t ${CPU_SEC} -n 64 -f 0 2>/dev/null; ulimit -v ${MEM_MB * 1024} 2>/dev/null; exec "$0"`, handler.exePath]
        };
    }
    return { cmd: handler.exePath, args: [], tier: 'none' };
}

// ---------------------------------------------------------------------------------------------
// compiling C++ (the compiler is the other thing that touches untrusted input)
// ---------------------------------------------------------------------------------------------

/** Cheap, mode-independent: refuse the classic "make the compiler read a host file" tricks. */
function scanCppSource(code) {
    if (/^\s*#\s*(include|include_next|embed)\s*[<"]\s*(\/|\.\.|[A-Za-z]:[\\/]|~)/m.test(code) || /__has_embed|#\s*embed\b/.test(code)) {
        return 'Không cho phép #include / #embed đường dẫn tuyệt đối hoặc ".." (chỉ dùng thư viện chuẩn).';
    }
    if (/^\s*#\s*(include|include_next)\s*[<"][^>"]*\.\.[/\\]/m.test(code)) return 'Không cho phép #include có "../".';
    return null;
}

/**
 * Compile srcPath -> exePath. Resolves { ok, text } (text = compiler output with paths scrubbed).
 */
function compileCpp(srcPath, exePath, timeoutMs = 15000) {
    return new Promise((resolve) => {
        const gpp = which('g++') || 'g++';
        const flags = ['-O2', '-std=c++17'];
        const finish = (r, scrub) => {
            let text = `${r.stderr}${r.stdout}`.trim();
            for (const s of scrub) text = text.split(s).join('bot.cpp');
            resolve({ ok: r.ok, code: r.code, text: text.slice(0, 4000) });
        };

        if (state.mode !== 'off' && state.levels.cpp === 'strong' && state.bwrapPath) {
            let work;
            try { work = fs.mkdtempSync(path.join(path.dirname(exePath), 'cc_')); fs.copyFileSync(srcPath, path.join(work, 'bot.cpp')); }
            catch (e) { return resolve({ ok: false, code: 1, text: `Không chuẩn bị được thư mục biên dịch: ${e.message}` }); }
            const lim = state.prlimit
                ? ['prlimit', `--cpu=${Math.ceil(timeoutMs / 1000) + 5}`, `--as=${COMPILE_MEM_MB * 1024 * 1024}`, '--fsize=268435456', '--nofile=256', '--core=0', '--'] : [];
            const args = [...bwrapBase(['--bind', work, '/work', '--chdir', '/work', ...toolMounts(gpp)]), '--', ...lim, gpp, ...flags, 'bot.cpp', '-o', 'bot.exe'];
            return execFile(state.bwrapPath, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
                let ok = !err;
                if (ok) { try { fs.renameSync(path.join(work, 'bot.exe'), exePath); } catch (e) { ok = false; stderr += String(e.message); } }
                try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* ignore */ }
                finish({ ok, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }, ['/work/bot.cpp', 'bot.cpp']);
            });
        }

        // basic tier: same as before + POSIX resource limits for the compiler
        const posix = !IS_WIN && state.mode !== 'off';
        const cmd = posix ? 'sh' : gpp;
        const args = posix
            ? ['-c', `ulimit -t ${Math.ceil(timeoutMs / 1000) + 5} -v ${COMPILE_MEM_MB * 1024} -f 262144 2>/dev/null; exec "$0" "$@"`, gpp, ...flags, srcPath, '-o', exePath]
            : [...flags, srcPath, '-o', exePath];
        execFile(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1 << 20, windowsHide: true }, (err, stdout, stderr) => {
            finish({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }, [srcPath]);
        });
    });
}

module.exports = {
    detect, getStatus, guard, wrapRun, compileCpp, scanCppSource, which,
    // tests may force a mode before detect()
    configure(opts = {}) {
        if (opts.mode) state.mode = String(opts.mode).toLowerCase();
        if (opts.strict !== undefined) state.strict = !!opts.strict;
    }
};
