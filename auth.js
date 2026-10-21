// ===== OTTv2 Code Arena - Accounts, Sessions & Ladder (issue #2) =====
//
//  - passwords: scrypt (Node built-in, no native dependency), per-user random salt
//  - sessions : random 256-bit token in an HttpOnly SameSite=Lax cookie; only its SHA-256 is stored,
//               so a leaked database cannot be replayed as logins
//  - sockets  : Socket.io handshakes carry the same cookie -> the server knows WHO is playing
//  - ladder   : Elo lives in the `users` table and moves only for rated games
//               (online, both players logged in, different accounts)

'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { db } = require('./db');
const storage = require('./storage');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'ott_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------------------------------------------------------------------
// Admin key (bootstrap / scripting). A logged-in user can also be promoted to role "admin"
// by presenting the key once (POST /api/auth/claim-admin); after that the key is not needed.
// ---------------------------------------------------------------------
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(9).toString('base64url');
const ADMIN_KEY_IS_GENERATED = !process.env.ADMIN_KEY;

function safeEqual(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const validAdminKey = (key) => safeEqual(key, ADMIN_KEY);

// ---------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------
async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
    const [alg, n, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
    return crypto.timingSafeEqual(key, expected);
}

// Used to burn the same time when the username does not exist (no user enumeration by timing)
const DUMMY_HASH_PROMISE = hashPassword('dummy-password-for-timing');

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
    const out = {};
    String(header || '').split(';').forEach(part => {
        const i = part.indexOf('=');
        if (i < 0) return;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
}

function createSession(userId, userAgent) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
        .run(sha256(token), userId, now, now + SESSION_TTL_MS, String(userAgent || '').slice(0, 200));
    return token;
}

const USER_COLUMNS = 'u.id, u.username, u.role, u.elo, u.matches, u.wins, u.losses, u.draws, u.preferred_lang, u.created_at';

function userFromToken(token) {
    if (!token) return null;
    return db.prepare(`
        SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(sha256(token), Date.now()) || null;
}

/** For Socket.io handshakes: header string -> user row (or null = guest). */
function userFromCookieHeader(header) {
    return userFromToken(parseCookies(header)[SESSION_COOKIE]);
}

function setSessionCookie(req, res, token) {
    const secure = req.secure || req.get('x-forwarded-proto') === 'https' || process.env.COOKIE_SECURE === '1';
    res.append('Set-Cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
    res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

setInterval(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 60 * 60 * 1000).unref();
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

const publicUser = (u) => u && ({
    id: u.id, username: u.username, role: u.role, elo: u.elo,
    matches: u.matches, wins: u.wins, losses: u.losses, draws: u.draws,
    lang: u.preferred_lang || null, createdAt: u.created_at
});

// ---------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------

/** Sets req.user (row or null) for every request. */
function attachUser(req, res, next) {
    req.sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
    req.user = userFromToken(req.sessionToken);
    next();
}

const isAdminReq = (req) => (req.user && req.user.role === 'admin') || validAdminKey(req.get('x-admin-key'));

function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Bạn cần đăng nhập' });
    next();
}
function requireAdmin(req, res, next) {
    if (!isAdminReq(req)) return res.status(401).json({ error: 'Cần quyền admin' });
    next();
}

/**
 * CSRF guard for state-changing requests: browsers always send Origin on cross-site POST/PUT/DELETE,
 * so a foreign Origin is rejected (SameSite=Lax cookies are the second layer). Non-browser clients send
 * no Origin and are unaffected.
 */
function sameOriginOnly(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin');
    if (origin) {
        let host = '';
        try { host = new URL(origin).host; } catch (e) { /* invalid origin */ }
        if (host !== req.get('host')) return res.status(403).json({ error: 'Origin không hợp lệ' });
    }
    next();
}

// ---------------------------------------------------------------------
// Brute-force protection: per-IP rate limit + progressive delay per username
// ---------------------------------------------------------------------
const failures = new Map();   // username(lower) -> { count, until }
function lockedFor(username) {
    const f = failures.get(username.toLowerCase());
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function noteFailure(username) {
    const k = username.toLowerCase();
    const f = failures.get(k) || { count: 0, until: 0 };
    f.count++;
    if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (f.count - 5));
    failures.set(k, f);
}
setInterval(() => {
    const now = Date.now();
    for (const [k, f] of failures) if (f.until < now && now - f.until > 3_600_000) failures.delete(k);
}, 600_000).unref();

// ---------------------------------------------------------------------
// Ladder (Elo) - rated games only
// ---------------------------------------------------------------------
const K_FACTOR = 32;

/**
 * Applies Elo + W/L/D to two ACCOUNTS (atomic). winner: 1 | 2 | 'draw'.
 * Returns the same `eloOutcome` shape the browser already renders.
 */
function applyRatedResult(blueId, redId, winner) {
    return db.transaction(() => {
        const blue = db.prepare('SELECT * FROM users WHERE id = ?').get(blueId);
        const red = db.prepare('SELECT * FROM users WHERE id = ?').get(redId);
        const scoreBlue = winner === 1 ? 1 : winner === 'draw' ? 0.5 : 0;
        const expectedBlue = 1 / (1 + Math.pow(10, (red.elo - blue.elo) / 400));
        const deltaBlue = Math.round(K_FACTOR * (scoreBlue - expectedBlue));
        const newBlue = Math.max(100, blue.elo + deltaBlue);
        const newRed = Math.max(100, red.elo - deltaBlue);
        const col = (w) => (winner === 'draw' ? 'draws' : w ? 'wins' : 'losses');
        db.prepare(`UPDATE users SET elo = ?, matches = matches + 1, ${col(winner === 1)} = ${col(winner === 1)} + 1 WHERE id = ?`).run(newBlue, blueId);
        db.prepare(`UPDATE users SET elo = ?, matches = matches + 1, ${col(winner === 2)} = ${col(winner === 2)} + 1 WHERE id = ?`).run(newRed, redId);
        return {
            blue: { name: blue.username, oldElo: blue.elo, newElo: newBlue, delta: newBlue - blue.elo },
            red: { name: red.username, oldElo: red.elo, newElo: newRed, delta: newRed - red.elo },
            updatedLeaderboard: leaderboard()
        };
    })();
}

/** Accounts + the built-in reference AIs from leaderboard.json (read-only). Same shape the UI already uses. */
function leaderboard() {
    const users = db.prepare(`SELECT username AS name, elo, matches, wins, losses, draws, preferred_lang AS lang FROM users`).all()
        .map(u => ({ ...u, lang: u.lang || 'js', isBot: false }));
    const bots = storage.getLeaderboard().filter(p => p.isBot);
    return [...users, ...bots].sort((a, b) => b.elo - a.elo);
}

const reservedNames = () => new Set(storage.getLeaderboard().filter(p => p.isBot).map(p => p.name.toLowerCase()));

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------
function createRouter({ rateLimit }) {
    const router = express.Router();
    const loginLimit = rateLimit({ windowMs: 60_000, max: 20 });
    const registerLimit = rateLimit({ windowMs: 60 * 60_000, max: 15 });

    const wrap = (fn) => async (req, res) => {
        try { await fn(req, res); } catch (err) {
            console.error('[auth]', err);
            res.status(500).json({ error: 'Lỗi máy chủ' });
        }
    };

    const startSession = (req, res, userId) => {
        const token = createSession(userId, req.get('user-agent'));
        setSessionCookie(req, res, token);
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), userId);
        return token;
    };
    const userById = (id) => db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`).get(id);

    router.post('/auth/register', registerLimit, wrap(async (req, res) => {
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
            return res.status(400).json({ error: 'Tên đăng nhập 3–20 ký tự: chữ, số, dấu . _ -' });
        }
        if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
            return res.status(400).json({ error: 'Mật khẩu phải từ 8 đến 128 ký tự' });
        }
        if (reservedNames().has(username.toLowerCase())) {
            return res.status(409).json({ error: 'Tên này được dành riêng cho bot hệ thống' });
        }
        const hash = await hashPassword(password);
        let id;
        try {
            id = Number(db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
                .run(username, hash, Date.now()).lastInsertRowid);
        } catch (err) {
            if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
            throw err;
        }
        startSession(req, res, id);
        res.status(201).json({ user: publicUser(userById(id)) });
    }));

    router.post('/auth/login', loginLimit, wrap(async (req, res) => {
        const { username, password, adminKey } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
        }
        const wait = lockedFor(username);
        if (wait) return res.status(429).json({ error: `Sai quá nhiều lần. Thử lại sau ${wait} giây.` });

        const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
        const ok = row ? await verifyPassword(password, row.password_hash)
            : (await verifyPassword(password, await DUMMY_HASH_PROMISE), false);
        if (!ok) {
            noteFailure(username);
            return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
        }
        if (row.role === 'admin' && !validAdminKey(adminKey)) {
            return res.status(403).json({ error: 'Tài khoản admin cần ADMIN_KEY hợp lệ' });
        }
        failures.delete(username.toLowerCase());
        startSession(req, res, row.id);
        res.json({ user: publicUser(userById(row.id)) });
    }));

    router.post('/auth/logout', (req, res) => {
        if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(req.sessionToken));
        clearSessionCookie(res);
        res.json({ ok: true });
    });

    router.get('/auth/me', (req, res) => {
        res.json({ user: publicUser(req.user), isAdmin: !!isAdminReq(req) });
    });

    // Present the ADMIN_KEY once while logged in -> account becomes admin permanently.
    router.post('/auth/claim-admin', requireUser, loginLimit, (req, res) => {
        if (!validAdminKey((req.body || {}).key)) return res.status(403).json({ error: 'Sai khóa admin' });
        db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(req.user.id);
        res.json({ ok: true });
    });

    router.post('/auth/password', requireUser, loginLimit, wrap(async (req, res) => {
        const { oldPassword, newPassword } = req.body || {};
        if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
            return res.status(400).json({ error: 'Mật khẩu mới phải từ 8 đến 128 ký tự' });
        }
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        if (!(await verifyPassword(String(oldPassword || ''), row.password_hash))) {
            return res.status(401).json({ error: 'Mật khẩu cũ không đúng' });
        }
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), row.id);
        // sign out every other device
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(row.id, sha256(req.sessionToken));
        res.json({ ok: true });
    }));

    router.post('/auth/lang', requireUser, (req, res) => {
        const lang = ['javascript', 'python', 'cpp', 'js', 'py'].includes((req.body || {}).lang) ? req.body.lang : null;
        db.prepare('UPDATE users SET preferred_lang = ? WHERE id = ?').run(lang, req.user.id);
        res.json({ ok: true });
    });

    // ----- user administration (admins only) -----
    router.get('/admin/users', requireAdmin, (req, res) => {
        const rows = db.prepare(`
            SELECT id, username, role, elo, matches, wins, losses, draws, created_at AS createdAt, last_login_at AS lastLoginAt
            FROM users ORDER BY created_at DESC`).all();
        res.json(rows);
    });

    router.post('/admin/users/:id/role', requireAdmin, (req, res) => {
        const id = parseInt(req.params.id, 10);
        const role = (req.body || {}).role;
        if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'role phải là user hoặc admin' });
        const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
        if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
        if (target.role === 'admin' && role === 'user' &&
            db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get().n <= 1) {
            return res.status(409).json({ error: 'Không thể bỏ quyền của admin cuối cùng' });
        }
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
        res.json({ ok: true });
    });

    // Forgotten password (typical in a class): admin sets a new one, every session of that user is revoked
    router.post('/admin/users/:id/password', requireAdmin, wrap(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const pw = (req.body || {}).password;
        if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) {
            return res.status(400).json({ error: 'Mật khẩu phải từ 8 đến 128 ký tự' });
        }
        if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        failures.clear();
        res.json({ ok: true });
    }));

    router.get('/leaderboard', (req, res) => res.json(leaderboard()));

    router.get('/users/:username', (req, res) => {
        const u = db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.username = ? COLLATE NOCASE`).get(req.params.username);
        if (!u) return res.status(404).json({ error: 'Không tìm thấy người chơi' });

        const record = {};
        db.prepare(`
            SELECT kind,
                   SUM(CASE WHEN (blue_user_id = @u AND winner = 'blue') OR (red_user_id = @u AND winner = 'red') THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN winner = 'draw' THEN 1 ELSE 0 END) AS draws,
                   SUM(CASE WHEN (blue_user_id = @u AND winner = 'red') OR (red_user_id = @u AND winner = 'blue') THEN 1 ELSE 0 END) AS losses,
                   COUNT(*) AS games
            FROM matches WHERE blue_user_id = @u OR red_user_id = @u GROUP BY kind
        `).all({ u: u.id }).forEach(r => { record[r.kind] = { games: r.games, wins: r.wins, losses: r.losses, draws: r.draws }; });

        const tournaments = db.prepare(`
            SELECT t.id, t.name, t.status, t.format, (t.champion_entry_id = e.id) AS champion
            FROM entries e JOIN tournaments t ON t.id = e.tournament_id
            WHERE e.user_id = ? ORDER BY t.id DESC
        `).all(u.id).map(t => ({ ...t, champion: !!t.champion }));

        const rank = db.prepare('SELECT COUNT(*) + 1 AS r FROM users WHERE elo > ?').get(u.elo).r;
        res.json({ user: { ...publicUser(u), rank }, record, tournaments });
    });

    return router;
}

module.exports = {
    ADMIN_KEY, ADMIN_KEY_IS_GENERATED, validAdminKey, isAdminReq,
    attachUser, requireUser, requireAdmin, sameOriginOnly,
    userFromCookieHeader, applyRatedResult, leaderboard, createRouter, publicUser,
    // exposed for tests
    hashPassword, verifyPassword
};
