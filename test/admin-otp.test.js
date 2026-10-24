'use strict';
// Admin login with ADMIN_KEY_MODE=console (the default without ADMIN_KEY): every login prints a fresh
// one-time code on the server console; nothing else opens an admin session.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 4700 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `ott-otp-${process.pid}.db`);
const LB = path.join(os.tmpdir(), `ott-otp-${process.pid}-lb.json`);
let server = null;
let out = '';

class Client {
    constructor() { this.cookie = ''; }
    async call(method, url, body) {
        const res = await fetch(BASE + url, {
            method,
            headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
        for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
            const [pair] = c.split(';');
            const [k, v] = pair.split('=');
            this.cookie = /Max-Age=0/i.test(c) || v === '' ? '' : `${k}=${v}`;
        }
        return { status: res.status, json: await res.json().catch(() => ({})) };
    }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** The newest code the server printed (waits a moment for the console line). */
async function lastCode(before) {
    for (let i = 0; i < 40; i++) {
        const codes = [...out.slice(before).matchAll(/Mã đăng nhập admin cho "admin": (\d{6})/g)];
        if (codes.length) return codes[codes.length - 1][1];
        await sleep(50);
    }
    throw new Error('no admin code printed');
}
async function startLogin() {
    const c = new Client();
    const mark = out.length;
    const r = await c.call('POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.needAdminKey, true);
    assert.strictEqual(r.json.keyMode, 'console');
    return { c, code: await lastCode(mark) };
}

test.before(async () => {
    const env = { ...process.env, PORT: String(PORT), DB_PATH: DB, DISABLE_RATE_LIMIT: '1', ADMIN_PASSWORD: 'admin-pass-123', LEADERBOARD_PATH: LB, BACKUP_INTERVAL_HOURS: '0' };
    delete env.ADMIN_KEY; delete env.ADMIN_KEY_MODE; delete env.ADMIN_KEY_HEADER;
    server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', d => { out += String(d); });
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start')), 15000);
        server.stdout.on('data', () => { if (out.includes('running at')) { clearTimeout(t); resolve(); } });
        server.on('exit', c => reject(new Error('server exited ' + c)));
    });
    for (let i = 0; i < 60 && !out.includes('Đăng nhập admin:'); i++) await sleep(50);   // the rest of the boot log
});
test.after(() => {
    if (server) server.kill();
    for (const f of [DB, DB + '-wal', DB + '-shm', LB]) { try { fs.unlinkSync(f); } catch (e) {} }
});

test('console mode: each admin login gets its own one-time code from the server console', async () => {
    assert.match(out, /ADMIN_KEY_MODE=console/);
    assert.doesNotMatch(out, /ADMIN_KEY \(tự sinh/, 'no fixed key is printed in console mode');

    const a = await startLogin();
    const wrong = a.code === '000000' ? '000001' : '000000';
    const bad = await a.c.call('POST', '/api/auth/admin-verify', { key: wrong });
    assert.strictEqual(bad.status, 403);
    assert.match(bad.json.error, /mã admin/);

    // a second login prints a different code; codes are bound to their own login
    const b = await startLogin();
    if (b.code !== a.code) assert.strictEqual((await b.c.call('POST', '/api/auth/admin-verify', { key: a.code })).status, 403);

    const ok = await a.c.call('POST', '/api/auth/admin-verify', { key: ` ${a.code} ` });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
    assert.strictEqual((await a.c.call('GET', '/api/auth/me')).json.isAdmin, true);

    // used once: the same code cannot open a second session
    const again = new Client();
    again.cookie = '';
    assert.strictEqual((await again.call('POST', '/api/auth/admin-verify', { key: a.code })).status, 401);
});
