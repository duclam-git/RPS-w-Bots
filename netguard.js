// ===== OTTv2 Code Arena - network guard =====
// Everything about the exposed network surface that is not game logic:
//   - who is the client? (real IP behind a reverse proxy, TRUST_PROXY)
//   - which origins may talk to us? (ALLOWED_ORIGINS; blocks cross-site WebSocket hijacking)
//   - security headers (CSP, nosniff, frame-ancestors, HSTS on HTTPS)
//   - Socket.io abuse limits (connections per IP, event rate per socket / per IP)
//   - safe handling of untrusted socket payloads (a malformed packet must never crash the server)

'use strict';

// ---------------------------------------------------------------------------------------------
// Proxy / client IP
// ---------------------------------------------------------------------------------------------

/**
 * TRUST_PROXY: number of reverse-proxy hops in front of us (e.g. 1 for nginx/Caddy), or empty/0 for none.
 * Without it we must NOT believe X-Forwarded-For (anybody could spoof their IP and dodge every limit).
 */
function trustProxyHops() {
    const v = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
    if (!v || v === '0' || v === 'false') return 0;
    if (v === 'true') return 1;
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n > 0 ? n : 0;
}

function socketIp(socket) {
    const hops = trustProxyHops();
    const xff = String(socket.request.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (hops && xff.length) return xff[Math.max(0, xff.length - hops)];
    return socket.handshake.address || 'unknown';
}

// ---------------------------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------------------------
const allowedOrigins = () => String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

/**
 * Same-origin (Origin host == Host header) or explicitly allowed. Requests without an Origin header
 * (curl, native clients, server-to-server) are not browsers and are not subject to cross-site attacks.
 */
function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    let host;
    try { host = new URL(origin).host; } catch (e) { return false; }
    if (host === req.headers.host) return true;
    return allowedOrigins().includes(origin.replace(/\/$/, ''));
}

/** `cors` package options: no CORS headers at all unless the origin is explicitly allowed. */
function corsOptions() {
    return {
        origin: (origin, cb) => cb(null, !!origin && allowedOrigins().includes(origin.replace(/\/$/, ''))),
        credentials: true
    };
}

// ---------------------------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------------------------
// The pages use a few inline scripts/styles (Ace loader, theme), hence 'unsafe-inline'; everything
// user-controlled is escaped on output and the rest of the policy still blocks foreign scripts,
// plugins, framing and form posts elsewhere.
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
].join('; ');

function securityHeaders(req, res, next) {
    res.set({
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
    });
    const https = req.secure || req.get('x-forwarded-proto') === 'https' || process.env.COOKIE_SECURE === '1';
    if (https) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
}

// ---------------------------------------------------------------------------------------------
// Rate limiting primitives
// ---------------------------------------------------------------------------------------------

/** Token bucket: `capacity` burst, refilled at `perSecond`. */
class Bucket {
    constructor(capacity, perSecond) { this.capacity = capacity; this.perSecond = perSecond; this.tokens = capacity; this.t = Date.now(); }
    take(n = 1) {
        const now = Date.now();
        this.tokens = Math.min(this.capacity, this.tokens + ((now - this.t) / 1000) * this.perSecond);
        this.t = now;
        if (this.tokens < n) return false;
        this.tokens -= n;
        return true;
    }
}

/** Keyed buckets with periodic cleanup of idle keys. */
class BucketMap {
    constructor(capacity, perSecond) { this.capacity = capacity; this.perSecond = perSecond; this.map = new Map(); }
    allow(key) {
        let b = this.map.get(key);
        if (!b) { b = new Bucket(this.capacity, this.perSecond); this.map.set(key, b); }
        return b.take();
    }
    sweep(idleMs = 10 * 60_000) {
        const now = Date.now();
        for (const [k, b] of this.map) if (now - b.t > idleMs) this.map.delete(k);
    }
}

/** Count of concurrent sockets per IP. */
const connections = {
    counts: new Map(),
    limit() { return parseInt(process.env.MAX_SOCKETS_PER_IP, 10) || 40; },
    acquire(ip) {
        const n = this.counts.get(ip) || 0;
        if (n >= this.limit()) return false;
        this.counts.set(ip, n + 1);
        return true;
    },
    release(ip) {
        const n = (this.counts.get(ip) || 1) - 1;
        if (n <= 0) this.counts.delete(ip); else this.counts.set(ip, n);
    }
};

/**
 * Socket event limiter. Every event costs from a general per-socket bucket; "heavy" events (compiling
 * code, creating rooms) have their own small per-socket and per-IP buckets.
 */
function createEventLimiter() {
    const disabled = process.env.DISABLE_RATE_LIMIT === '1';
    const general = new BucketMap(60, 30);                     // 60 burst, 30 events/s sustained
    const HEAVY = {
        create_room: { perSocket: [5, 5 / 60], perIp: [30, 30 / 60] },
        join_room: { perSocket: [20, 20 / 60], perIp: [120, 120 / 60] },
        player_ready: { perSocket: [8, 8 / 60], perIp: [40, 40 / 60] }
    };
    const heavySocket = {}, heavyIp = {};
    for (const [ev, c] of Object.entries(HEAVY)) {
        heavySocket[ev] = new BucketMap(...c.perSocket);
        heavyIp[ev] = new BucketMap(...c.perIp);
    }
    setInterval(() => { general.sweep(); Object.values(heavySocket).forEach(m => m.sweep()); Object.values(heavyIp).forEach(m => m.sweep()); }, 5 * 60_000).unref();
    return {
        allow(socketId, ip, event) {
            if (disabled) return true;
            if (!general.allow(socketId)) return false;
            if (HEAVY[event]) return heavySocket[event].allow(socketId) && heavyIp[event].allow(ip);
            return true;
        },
        forget(socketId) { general.map.delete(socketId); Object.values(heavySocket).forEach(m => m.map.delete(socketId)); }
    };
}

// ---------------------------------------------------------------------------------------------
// Untrusted payload helpers
// ---------------------------------------------------------------------------------------------
/** Anything that is not a plain object becomes {} - destructuring it can never throw. */
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v, max, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);

module.exports = {
    trustProxyHops, socketIp, originAllowed, corsOptions, securityHeaders,
    Bucket, BucketMap, connections, createEventLimiter, obj, str, CSP
};
