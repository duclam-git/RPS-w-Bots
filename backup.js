// ===== OTTv2 Code Arena - SQLite backups =====
// Uses SQLite's online backup API (consistent snapshot while the server keeps running, WAL-safe).
//   BACKUP_DIR              default <data dir>/backups
//   BACKUP_INTERVAL_HOURS   default 24 (0 = no scheduled backups)
//   BACKUP_KEEP             default 14 newest backups kept
// A backup contains EVERYTHING (accounts' password hashes, bot source code): keep it private.

'use strict';

const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const NAME_RE = /^ott-\d{8}-\d{6}-\d{3}(-\d+)?\.db$/;
const keep = () => Math.max(1, parseInt(process.env.BACKUP_KEEP, 10) || 14);
const dir = () => process.env.BACKUP_DIR || path.join(path.dirname(db.name), 'backups');
const available = () => !!db.name && db.name !== ':memory:' && !db.memory;

function stamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    // milliseconds included: after pruning, two backups in the same second must still get different names
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function list() {
    if (!available() || !fs.existsSync(dir())) return [];
    return fs.readdirSync(dir()).filter(f => NAME_RE.test(f)).map(f => {
        const st = fs.statSync(path.join(dir(), f));
        return { name: f, size: st.size, createdAt: st.mtimeMs };
    }).sort((a, b) => b.createdAt - a.createdAt);
}

function prune() {
    for (const b of list().slice(keep())) { try { fs.unlinkSync(path.join(dir(), b.name)); } catch (e) { /* ignore */ } }
}

async function backupNow() {
    if (!available()) throw new Error('Cơ sở dữ liệu trong bộ nhớ không thể sao lưu');
    fs.mkdirSync(dir(), { recursive: true });
    const base = stamp();
    let name = `ott-${base}.db`;
    for (let i = 1; fs.existsSync(path.join(dir(), name)); i++) name = `ott-${base}-${i}.db`;
    const dest = path.join(dir(), name);
    try { await db.backup(dest); }
    catch (err) { try { fs.unlinkSync(dest); } catch (e) { /* partial file */ } throw err; }
    try { fs.chmodSync(dest, 0o600); } catch (e) { /* not supported on Windows */ }
    prune();
    return { name, size: fs.statSync(dest).size, createdAt: Date.now() };
}

/** Absolute path of a backup, or null if the name is not a real backup file (no path tricks). */
function resolve(name) {
    if (!NAME_RE.test(String(name || ''))) return null;
    const p = path.join(dir(), name);
    return fs.existsSync(p) ? p : null;
}

let timer = null;
function startSchedule() {
    const hours = process.env.BACKUP_INTERVAL_HOURS === undefined ? 24 : parseFloat(process.env.BACKUP_INTERVAL_HOURS);
    if (!available() || !(hours > 0)) return;
    const every = hours * 3600_000;
    const run = () => backupNow().then(b => console.log(`💾 Đã sao lưu CSDL: ${b.name}`)).catch(e => console.error('[backup]', e.message));
    const newest = list()[0];
    if (!newest || Date.now() - newest.createdAt > every) setTimeout(run, 60_000).unref();   // first one a minute after boot
    timer = setInterval(run, every);
    timer.unref();
}
function stopSchedule() { if (timer) clearInterval(timer); timer = null; }

module.exports = { backupNow, list, resolve, startSchedule, stopSchedule, available, dir };
