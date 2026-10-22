'use strict';
// The shipped nginx config (deploy/nginx-ott.conf) in front of the real server - not a mock.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const NGINX = ['/usr/sbin/nginx', '/usr/bin/nginx', '/usr/local/bin/nginx', '/usr/local/nginx/sbin/nginx'].find(p => fs.existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const APP_PORT = 4900 + Math.floor(Math.random() * 40);
const NGX_PORT = APP_PORT + 50;
const children = [];
let work;

async function startAll() {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-nginx-'));
    for (const d of ['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) fs.mkdirSync(path.join(work, d));
    const site = fs.readFileSync(path.join(ROOT, 'deploy', 'nginx-ott.conf'), 'utf8')
        .replace('listen 80;', `listen 127.0.0.1:${NGX_PORT};`)
        .replace('server 127.0.0.1:3000;', `server 127.0.0.1:${APP_PORT};`);
    fs.writeFileSync(path.join(work, 'site.conf'), site);
    fs.writeFileSync(path.join(work, 'nginx.conf'), `
${process.getuid && process.getuid() === 0 ? 'user root;' : ''}
daemon off; pid ${work}/nginx.pid; error_log ${work}/error.log warn;
events { worker_connections 64; }
http {
  access_log off;
  client_body_temp_path ${work}/body; proxy_temp_path ${work}/proxy; fastcgi_temp_path ${work}/fastcgi;
  uwsgi_temp_path ${work}/uwsgi; scgi_temp_path ${work}/scgi;
  include ${work}/site.conf;
}`);
    const check = spawn(NGINX, ['-t', '-p', work, '-c', path.join(work, 'nginx.conf')], { stdio: 'pipe' });
    let out = ''; check.stderr.on('data', d => out += d);
    const code = await new Promise(r => check.on('exit', r));
    assert.strictEqual(code, 0, `nginx -t failed: ${out}`);

    const app = spawn(process.execPath, ['server.js'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(APP_PORT), DB_PATH: path.join(work, 'app.db'), LEADERBOARD_PATH: path.join(work, 'lb.json'), ADMIN_KEY: 'k', TRUST_PROXY: '1', BACKUP_INTERVAL_HOURS: '0' }
    });
    children.push(app);
    await new Promise(r => { let o = ''; app.stdout.on('data', d => { o += d; if (o.includes('running at')) r(); }); });
    const ngx = spawn(NGINX, ['-p', work, '-c', path.join(work, 'nginx.conf')], { stdio: 'pipe' });
    children.push(ngx);
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${NGX_PORT}/healthz`)).ok) return; } catch (e) { /* not yet */ } await sleep(100); }
    throw new Error('nginx did not come up: ' + fs.readFileSync(path.join(work, 'error.log'), 'utf8'));
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
test.after(async () => {
    // nginx: graceful quit (master tells its workers), then the whole process group as a fallback
    const ngx = children.find(c => c.spawnfile === NGINX);
    if (ngx) {
        try { process.kill(ngx.pid, 'SIGQUIT'); } catch (e) { /* gone */ }
        for (let i = 0; i < 50 && alive(ngx.pid); i++) await sleep(100);
        try { process.kill(-ngx.pid, 'SIGKILL'); } catch (e) { /* gone */ }
    }
    for (const c of children) {
        if (c === ngx) continue;
        try { c.kill('SIGKILL'); } catch (e) { /* gone */ }
        // release our end of the pipes so nothing can keep this process alive
        if (c.stdout) c.stdout.destroy();
        if (c.stderr) c.stderr.destroy();
    }
    await sleep(200);
    if (work) fs.rmSync(work, { recursive: true, force: true });
});

test('shipped nginx config: HTTP, WebSockets (Host with a port), origin guard, real client IP, body limit', { skip: !NGINX && 'nginx not installed' }, async () => {
    await startAll();
    const base = `http://127.0.0.1:${NGX_PORT}`;

    assert.deepStrictEqual(Object.keys(await (await fetch(base + '/healthz')).json()).sort(), ['ok', 'uptime']);
    assert.strictEqual((await fetch(base + '/')).status, 200);

    // WebSocket through the proxy. Origin includes the port, so this only works if nginx forwards Host WITH the port.
    const ws = io(base, { transports: ['websocket'], reconnection: false, extraHeaders: { origin: base } });
    await new Promise((res, rej) => { ws.once('connect', res); ws.once('connect_error', rej); });
    ws.emit('create_room', { playerName: 'ProxyTest' });
    const created = await new Promise(res => ws.once('room_created', res));
    assert.match(created.roomCode, /^OTT-/);
    ws.close();

    // polling transport (the Upgrade-less path) works too
    const poll = io(base, { transports: ['polling'], reconnection: false, extraHeaders: { origin: base } });
    await new Promise((res, rej) => { poll.once('connect', res); poll.once('connect_error', rej); });
    poll.close();

    // a foreign site still cannot hijack a socket through the proxy
    const evil = io(base, { transports: ['websocket'], reconnection: false, extraHeaders: { origin: 'http://evil.example' } });
    await assert.rejects(new Promise((res, rej) => { evil.once('connect', res); evil.once('connect_error', rej); }));
    evil.close();

    // the client's own X-Forwarded-For is worthless: nginx appends the real address, the app trusts only the last hop
    const statuses = [];
    for (let i = 0; i < 30; i++) {
        const r = await fetch(base + '/api/auth/login', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.8.${i}` },
            body: JSON.stringify({ username: `ghost${i}x${process.pid}`, password: 'wrong-password' })
        });
        statuses.push(r.status);
    }
    assert.ok(statuses.includes(429), 'a spoofed X-Forwarded-For must not dodge the rate limit behind nginx');

    // oversized bodies are cut at the proxy
    const big = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(3 * 1024 * 1024) }) });
    assert.strictEqual(big.status, 413);
});
