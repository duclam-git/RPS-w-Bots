'use strict';
// Hostile bots. For every sandbox tier available on this machine, an "attack" bot tries to read a host
// secret, write to the host, run programs, open sockets and eat resources; the tests assert the HOST is untouched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { execSync } = require('node:child_process');
const runner = require('../runner');
const sandbox = require('../sandbox');
const mp = require('../matchplay');
const E = require('../engine');

const PROJECT = path.join(__dirname, '..');
const TMP = os.tmpdir();
const SECRET = path.join(TMP, `ott-secret-${process.pid}.txt`);
const MARK1 = path.join(TMP, `ott-pwn1-${process.pid}`);
const MARK2 = path.join(TMP, `ott-pwn2-${process.pid}`);
const PROJECT_MARK = path.join(PROJECT, `ott-pwn-${process.pid}.txt`);
const hasPy = !!sandbox.which('python3') || !!sandbox.which('python');
const hasGpp = !!sandbox.which('g++');
let listener, connections = 0, PORT;

const state = () => {
    const board = E.createInitialBoard();
    return { board, myPlayer: 1, legalMoves: E.getLegalMoves(1, board), myGoal: { r: 0, c: 8 }, moveHistory: [] };
};
const cleanHost = () => { for (const f of [MARK1, MARK2, PROJECT_MARK]) { try { fs.unlinkSync(f); } catch (e) {} } };
const hostPolluted = () => [MARK1, MARK2, PROJECT_MARK].filter(f => fs.existsSync(f));

async function attack(lang, code, timeoutMs = 4000) {
    const prep = await runner.prepareBot(`sbx_${lang}_${Math.random().toString(36).slice(2, 8)}`, lang, code);
    assert.ok(prep.success, prep.error);
    const t0 = Date.now();
    const res = await runner.executeBotMove(prep.botHandler, state(), timeoutMs);
    res.wall = Date.now() - t0;
    res.handler = prep.botHandler;
    return res;
}
const done = (res) => runner.cleanupBot(res.handler);

const JS_ATTACK = `
const fs = require('fs');
function tryIt(name, fn) { try { const v = fn(); console.error('ESCAPED:' + name + ':' + String(v).slice(0, 50)); } catch (e) { console.error('BLOCKED:' + name); } }
function getNextMove(s, h, log) {
  tryIt('read-secret', () => fs.readFileSync(${JSON.stringify(SECRET)}, 'utf8'));
  tryIt('read-source', () => fs.readdirSync(${JSON.stringify(PROJECT)}).includes('server.js') ? 'saw server.js' : (() => { throw 0; })());
  tryIt('write-project', () => { fs.writeFileSync(${JSON.stringify(PROJECT_MARK)}, 'x'); return 'wrote'; });
  tryIt('write-tmp', () => { fs.writeFileSync(${JSON.stringify(MARK1)}, 'x'); return 'wrote'; });
  tryIt('spawn', () => require('child_process').execSync('id > ${MARK2}'));
  tryIt('env', () => { if (process.env.ADMIN_KEY === undefined) throw 0; return process.env.ADMIN_KEY; });
  const sock = require('net').connect(${'${PORT}'}, '127.0.0.1');
  sock.on('connect', () => { console.error('ESCAPED:net'); sock.destroy(); });
  sock.on('error', () => console.error('BLOCKED:net'));
  return s.legalMoves[0];
}`;

const PY_ATTACK = `
import sys, json, os
s = json.loads(sys.stdin.read())
def attempt(name, fn):
    try:
        v = fn(); sys.stderr.write('ESCAPED:%s:%s\\n' % (name, str(v)[:50]))
    except BaseException:
        sys.stderr.write('BLOCKED:%s\\n' % name)
def w(path):
    open(path, 'w').write('x'); return 'wrote'
def need(cond):
    if not cond: raise RuntimeError('no')
    return 'yes'
attempt('read-secret', lambda: open(${JSON.stringify(SECRET)}).read())
attempt('read-source', lambda: need('server.js' in os.listdir(${JSON.stringify(PROJECT)})))
attempt('write-project', lambda: w(${JSON.stringify(PROJECT_MARK)}))
attempt('write-tmp', lambda: w(${JSON.stringify(MARK1)}))
attempt('spawn', lambda: os.system('id > ${MARK2}'))
attempt('subprocess', lambda: __import__('subprocess').check_output(['id']))
attempt('ctypes', lambda: __import__('ctypes').CDLL(None))
attempt('env', lambda: need(os.environ.get('ADMIN_KEY') is not None))
attempt('net', lambda: __import__('socket').create_connection(('127.0.0.1', ${'${PORT}'}), 1))
m = s['legalMoves'][0]
print(json.dumps({'from': m['from'], 'to': m['to']}))
`;

const CPP_ATTACK = `
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <iterator>
#include <string>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
int main() {
    std::string in((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    if (FILE* f = fopen(${JSON.stringify(SECRET)}, "r")) { char b[64] = {0}; size_t n = fread(b, 1, 63, f); (void)n; fprintf(stderr, "ESCAPED:read-secret:%s\\n", b); fclose(f); }
    else fprintf(stderr, "BLOCKED:read-secret\\n");
    if (FILE* f = fopen(${JSON.stringify(PROJECT_MARK)}, "w")) { fputs("x", f); fclose(f); fprintf(stderr, "WROTE:project\\n"); } else fprintf(stderr, "BLOCKED:write-project\\n");
    if (FILE* f = fopen("/etc/passwd", "r")) { fprintf(stderr, "ESCAPED:etc-passwd\\n"); fclose(f); } else fprintf(stderr, "BLOCKED:etc-passwd\\n");
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(${'${PORT}'}); inet_pton(AF_INET, "127.0.0.1", &a.sin_addr);
    if (connect(sock, (sockaddr*)&a, sizeof a) == 0) fprintf(stderr, "ESCAPED:net\\n"); else fprintf(stderr, "BLOCKED:net\\n");
    return 0;
}`;
const withPort = (code) => code.replace(/\$\{PORT\}/g, String(PORT));

test.before(async () => {
    fs.writeFileSync(SECRET, 'TOP-SECRET-VALUE');
    cleanHost();
    process.env.ADMIN_KEY = 'must-not-leak';
    await new Promise(r => { listener = net.createServer((c) => { connections++; c.destroy(); }).listen(0, '127.0.0.1', () => { PORT = listener.address().port; r(); }); });
    await runner.detectToolchains();
});
test.after(() => { listener.close(); cleanHost(); try { fs.unlinkSync(SECRET); } catch (e) {} });

// the tiers this machine can actually exercise
const TIERS = [{ name: 'builtin', mode: 'builtin' }];
test('sandbox status reports what is available', async () => {
    await sandbox.detect({ pythonCmd: 'python3' });
    const st = sandbox.getStatus();
    console.log('# sandbox:', JSON.stringify({ driver: st.driver, levels: st.levels, nodePermission: st.nodePermission, notes: st.notes }));
    if (st.driver === 'bwrap') TIERS.push({ name: 'strong (bubblewrap)', mode: 'auto' });
    assert.ok(['bwrap', 'builtin'].includes(st.driver));
});

async function inTier(tier, fn) {
    sandbox.configure({ mode: tier.mode, strict: false });
    await sandbox.detect({ pythonCmd: 'python3' });
    cleanHost(); connections = 0;
    try { await fn(); } finally { sandbox.configure({ mode: 'auto', strict: false }); }
}
const expectNoLeak = (res) => {
    assert.ok(!/TOP-SECRET-VALUE/.test(res.log), `secret leaked: ${res.log}`);
    assert.ok(!/ESCAPED:read-source/.test(res.log), `project listing leaked: ${res.log}`);
    assert.ok(!/ESCAPED:env/.test(res.log), `environment leaked: ${res.log}`);
    assert.deepStrictEqual(hostPolluted(), [], `host files were created: ${hostPolluted()}`);
};

test('JavaScript attack bot cannot touch the host (every tier)', async () => {
    for (const tier of TIERS) await inTier(tier, async () => {
        const res = await attack('javascript', withPort(JS_ATTACK));
        await new Promise(r => setTimeout(r, 300));
        expectNoLeak(res);
        assert.match(res.log, /BLOCKED:read-secret/, `${tier.name}: ${res.log}`);
        if (tier.mode === 'builtin') assert.ok(!/ESCAPED:spawn/.test(res.log), 'child_process blocked by --permission');
        if (tier.mode !== 'builtin') assert.strictEqual(connections, 0, 'no network on the strong tier');
        done(res);
    });
});

test('Python attack bot cannot touch the host (every tier)', { skip: !hasPy && 'python missing' }, async () => {
    for (const tier of TIERS) await inTier(tier, async () => {
        const res = await attack('python', withPort(PY_ATTACK));
        expectNoLeak(res);
        for (const name of ['read-secret', 'spawn', 'subprocess', 'ctypes', 'net']) {
            assert.match(res.log, new RegExp(`BLOCKED:${name}`), `${tier.name}: ${name} -> ${res.log}`);
        }
        assert.strictEqual(connections, 0);
        assert.ok(res.move, 'a well-behaved part of the bot still answers');
        done(res);
    });
});

test('C++ attack bot is confined by the strong tier (no network, no host files)', { skip: !hasGpp && 'g++ missing' }, async (t) => {
    if (!TIERS.some(x => x.mode === 'auto')) return t.skip('bubblewrap not available here');
    await inTier(TIERS.find(x => x.mode === 'auto'), async () => {
        const res = await attack('cpp', withPort(CPP_ATTACK));
        expectNoLeak(res);
        assert.match(res.log, /BLOCKED:read-secret/);
        assert.match(res.log, /BLOCKED:etc-passwd/);
        assert.match(res.log, /BLOCKED:net/);
        assert.strictEqual(connections, 0);
        done(res);
    });
});

test('basic tier is honest: C++ is NOT confined without bubblewrap (documented weakness)', { skip: !hasGpp && 'g++ missing' }, async () => {
    await inTier({ name: 'builtin', mode: 'builtin' }, async () => {
        assert.notStrictEqual(sandbox.getStatus().levels.cpp, 'strong');
        // the status must say so, so admins are not misled
        assert.ok(sandbox.getStatus().notes.some(n => /C\+\+ KHÔNG được cách ly/.test(n)));
    });
});

test('runaway bots are killed on time and leave no process behind (every tier)', async () => {
    for (const tier of TIERS) await inTier(tier, async () => {
        const cases = [['javascript', 'function getNextMove() { for (;;) {} }']];
        if (hasPy) cases.push(['python', 'import sys\nsys.stdin.read()\nwhile True: pass']);
        if (hasGpp) cases.push(['cpp', '#include <iostream>\nint main(){ std::cin.get(); for(;;){} }']);
        for (const [lang, code] of cases) {
            const res = await attack(lang, code, 1200);
            assert.match(res.error || '', /Quá thời gian/, `${tier.name}/${lang}: ${res.error}`);
            assert.ok(res.wall < 3500, `${tier.name}/${lang} took ${res.wall}ms`);
            await new Promise(r => setTimeout(r, 300));
            const id = path.basename(res.handler.scriptPath || res.handler.exePath);
            const left = execSync(`ps -eo args | grep -F "${id}" | grep -v grep | wc -l`).toString().trim();
            assert.strictEqual(left, '0', `${tier.name}/${lang}: ${left} process(es) survived`);
            done(res);
        }
    });
});

test('memory bombs fail fast instead of eating the machine (every tier)', async () => {
    for (const tier of TIERS) await inTier(tier, async () => {
        const cases = [['javascript', 'function getNextMove() { const a = []; for (;;) a.push(new Array(1e6).fill(0)); }']];
        if (hasPy) cases.push(['python', 'import sys\nsys.stdin.read()\nx = bytearray(4 << 30)\nprint("alloc ok")']);
        if (hasGpp) cases.push(['cpp', '#include <cstdlib>\n#include <cstring>\n#include <iostream>\nint main(){ std::cin.get(); for(int i=0;i<64;i++){ char* p=(char*)malloc(256u<<20); if(!p) return 3; memset(p,1,256u<<20);} return 0; }']);
        for (const [lang, code] of cases) {
            const res = await attack(lang, code, 6000);
            assert.strictEqual(res.move, null, `${tier.name}/${lang} should not produce a move`);
            assert.ok(res.wall < 5500, `${tier.name}/${lang}: ${res.wall}ms`);
            assert.ok(!/alloc ok/.test(res.log || ''), `${tier.name}/${lang} allocated 4GB`);
            done(res);
        }
    });
});

test('well-behaved bots of all languages play a full game under every tier', async () => {
    for (const tier of TIERS) await inTier(tier, async () => {
        const rush = 'function getNextMove(s, h) { let b = null, d = 1e9; for (const m of s.legalMoves) { const x = h.distance(m.to.r, m.to.c, s.myGoal.r, s.myGoal.c) - (m.capture ? .5 : 0); if (x < d) { d = x; b = m; } } return b; }';
        global.window = {}; delete require.cache[require.resolve('../bot_templates.js')]; require('../bot_templates.js');
        const T = global.window.MULTI_LANG_TEMPLATES;
        const langs = [['javascript', rush]];
        if (hasPy) langs.push(['python', T.python.red]);
        if (hasGpp) langs.push(['cpp', T.cpp.blue]);
        const bots = [];
        for (const [lang, code] of langs) { const p = await runner.prepareBot(`full_${lang}`, lang, code); assert.ok(p.success, p.error); bots.push({ name: lang, lang, handler: p.botHandler }); }
        for (let i = 0; i < bots.length; i++) {
            const blue = bots[i], red = bots[(i + 1) % bots.length];
            const res = await mp.playMatch({ blue, red, rules: E.resolveRules({ maxPlies: 60 }) });
            assert.deepStrictEqual(res.fallbacks, { blue: 0, red: 0 }, `${tier.name}: ${blue.name} vs ${red.name} used fallbacks`);
        }
        bots.forEach(b => runner.cleanupBot(b.handler));
    });
});

test('strict mode refuses languages that are not confined by the strong tier', async () => {
    sandbox.configure({ mode: 'builtin', strict: true });
    await sandbox.detect({ pythonCmd: 'python3' });
    const p = await runner.prepareBot('strict_js', 'javascript', 'function getNextMove(){}');
    assert.strictEqual(p.success, false);
    assert.match(p.error, /sandbox mạnh/);
    sandbox.configure({ mode: 'auto', strict: false });
    await sandbox.detect({ pythonCmd: 'python3' });
});

test('C++ sources that try to make the compiler read host files are rejected', async () => {
    const r = await runner.prepareBot('inc1', 'cpp', '#include "/etc/passwd"\nint main(){}');
    assert.strictEqual(r.success, false);
    assert.match(r.error, /đường dẫn tuyệt đối/);
    const r2 = await runner.prepareBot('inc2', 'cpp', '#include "../../server.js"\nint main(){}');
    assert.strictEqual(r2.success, false);
});
