// ===== OTTv2 Code Arena - REST API (match history + tournaments) =====

'use strict';

const express = require('express');
const engine = require('./engine');
const games = require('./games');
const { saveMatch, listMatches, getMatch } = require('./db');
const tournament = require('./tournament');

const { HttpError } = tournament;

const auth = require('./auth');
const { requireAdmin } = auth;

// ---------- tiny in-memory rate limiter (per IP) ----------
function rateLimit({ windowMs, max }) {
    const hits = new Map();
    setInterval(() => hits.clear(), windowMs).unref();
    return (req, res, next) => {
        if (process.env.DISABLE_RATE_LIMIT === '1') return next();   // used by the test-suite
        const key = req.ip;
        const n = (hits.get(key) || 0) + 1;
        hits.set(key, n);
        if (n > max) return res.status(429).json({ error: 'Gửi quá nhanh, vui lòng thử lại sau.' });
        next();
    };
}

// Handlers may throw synchronously (HttpError from validation) or reject asynchronously - both end up
// as a JSON { error } the UI can show. (A plain Promise.resolve(fn()) would miss synchronous throws.)
const wrap = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (err) {
        if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
        console.error('[api]', err);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
};

const idParam = (v) => {
    const n = parseInt(v, 10);
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'ID không hợp lệ');
    return n;
};

const router = express.Router();
router.use(auth.createRouter({ rateLimit }));

// Rules editor support: the defaults, and a pure validator (same code the server applies on save)
const gameParam = (req) => {
    const g = games.get(String(req.query.game || games.DEFAULT_GAME));
    if (!g) throw new HttpError(400, 'Trò chơi không tồn tại');
    return g;
};
router.get('/games', (req, res) => res.json(games.list()));
router.get('/rules/default', wrap((req, res) => {
    const g = gameParam(req);
    res.json(g.id === 'rps' ? g.DEFAULT_RULES : g.resolveRules({}));
}));
router.post('/rules/validate', wrap((req, res) => {
    const v = gameParam(req).validateRules(req.body || {});
    res.json({ ok: v.ok, errors: v.errors });
}));

// Admin: how well are untrusted bots confined on this server?
router.get('/admin/sandbox', requireAdmin, (req, res) => {
    const runner = require('./runner');
    res.json({ sandbox: runner.getSandboxStatus(), toolchains: runner.getToolchains(), load: runner.getStats() });
});

// Admin: backups (SQLite online backup; the file contains password hashes + bot code -> admin only)
const backup = require('./backup');
router.get('/admin/backups', requireAdmin, (req, res) => res.json({ enabled: backup.available(), backups: backup.list() }));
router.post('/admin/backups', requireAdmin, wrap(async (req, res) => {
    if (!backup.available()) throw new HttpError(409, 'Cơ sở dữ liệu trong bộ nhớ không thể sao lưu');
    res.status(201).json(await backup.backupNow());
}));
router.get('/admin/backups/:name', requireAdmin, (req, res) => {
    const file = backup.resolve(req.params.name);
    if (!file) return res.status(404).json({ error: 'Không tìm thấy bản sao lưu' });
    res.download(file, req.params.name);
});

// Which languages can this server run? (the editor greys out the ones that are missing)
router.get('/languages', (req, res) => res.json(require('./runner').getToolchains()));

// =====================================================================
// Match history & replay (issue #3)
// =====================================================================

router.get('/matches', wrap((req, res) => {
    const { kind, tournament: tid, player, limit, offset, mine, user, game } = req.query;
    if (game && !games.has(String(game))) throw new HttpError(400, 'Trò chơi không tồn tại');
    let userId;
    if (mine === '1') {
        if (!req.user) throw new HttpError(401, 'Bạn cần đăng nhập');
        userId = req.user.id;
    } else if (user) {
        const row = require('./db').db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(String(user));
        userId = row ? row.id : -1;
    }
    if (kind && !['online', 'local', 'tournament'].includes(kind)) throw new HttpError(400, 'kind không hợp lệ');
    res.json(listMatches({
        kind, player, limit, offset, userId, game,
        tournamentId: tid ? idParam(tid) : undefined
    }));
}));

// Remove a history record (tournament games are protected: they feed the series score)
router.delete('/matches/:id', requireAdmin, wrap((req, res) => {
    const info = require('./db').db.prepare(`DELETE FROM matches WHERE id = ? AND kind != 'tournament'`).run(idParam(req.params.id));
    if (!info.changes) throw new HttpError(404, 'Không tìm thấy trận (hoặc là trận giải đấu — hãy dùng "Đấu lại" ở cặp đấu)');
    res.json({ ok: true });
}));

router.get('/matches/:id', wrap((req, res) => {
    const m = getMatch(idParam(req.params.id));
    if (!m) throw new HttpError(404, 'Không tìm thấy trận đấu');
    // initial position is derived from the stored rules snapshot, so replay never depends on current code
    m.initialBoard = (games.get(m.game) || games.get(games.DEFAULT_GAME)).createInitialBoard(m.rules);
    res.json(m);
}));

/**
 * Browser-vs-bot practice games (played entirely client-side) are uploaded here so they also appear
 * in the history. The server NEVER trusts the client: it re-plays every move with the engine and
 * derives the winner itself. Stored as kind 'local' (unrated).
 */
router.post('/matches/local', rateLimit({ windowMs: 60_000, max: 30 }), wrap((req, res) => {
    const { blue, red, moves, mine } = req.body || {};
    const g = games.get(String((req.body || {}).game || games.DEFAULT_GAME));
    if (!g) throw new HttpError(400, 'Trò chơi không tồn tại');
    if (!Array.isArray(moves) || moves.length === 0 || moves.length > 2000) throw new HttpError(400, 'Danh sách nước đi không hợp lệ');
    // sides the (logged-in) player controlled, so the game shows up in "my matches"
    const mySides = Array.isArray(mine) ? mine : [];
    const cleanSide = (s, fallback, side) => ({
        name: String((s && s.name) || fallback).trim().slice(0, 40) || fallback,
        lang: String((s && s.lang) || '').slice(0, 20),
        userId: req.user && mySides.includes(side) ? req.user.id : null
    });
    let rules;
    if (g.id === 'rps') rules = engine.resolveRules({ maxPlies: 2000 });
    else {
        // Caro practice: the player picks the board; the game's own validator decides what is acceptable
        const raw = (req.body || {}).rules || {};
        const v = g.validateRules({ size: raw.size, winLength: raw.winLength });
        if (!v.ok) throw new HttpError(400, v.errors.join('; '));
        rules = g.resolveRules(v.rules);
    }
    const check = g.replayAndValidate(moves.map(m => ({
        player: m && m.player, from: m && m.from, to: m && m.to
    })), rules);
    if (!check.ok) throw new HttpError(422, check.error);

    const id = saveMatch({
        game: g.id,
        kind: 'local',
        blue: cleanSide(blue, 'Xanh', 'blue'),
        red: cleanSide(red, 'Đỏ', 'red'),
        winner: check.winner,
        reason: check.reason,
        rules
    }, check.moves);
    res.status(201).json({ id });
}));

// =====================================================================
// Tournaments (issue #5)
// =====================================================================

router.post('/admin/check', requireAdmin, (req, res) => res.json({ ok: true }));

router.get('/tournaments', wrap((req, res) => res.json(tournament.listTournaments())));

router.get('/tournaments/:id', wrap((req, res) => {
    const d = tournament.getTournamentDetail(idParam(req.params.id));
    if (!d) throw new HttpError(404, 'Không tìm thấy giải đấu');
    res.json(d);
}));

router.post('/tournaments', requireAdmin, wrap((req, res) => {
    const t = tournament.createTournament(req.body || {});
    res.status(201).json({ id: t.id });
}));

router.delete('/tournaments/:id', requireAdmin, wrap((req, res) => {
    tournament.deleteTournament(idParam(req.params.id));
    res.json({ ok: true });
}));

// Registration: players need an account by default (tournament.config.requireLogin).
// Rate-limited because each submission compiles and runs the bot once.
router.post('/tournaments/:id/entries', rateLimit({ windowMs: 60_000, max: 30 }), wrap(async (req, res) => {
    const out = await tournament.registerEntry(idParam(req.params.id), req.body || {}, req.user);
    res.status(201).json(out);
}));

router.put('/tournaments/:id/entries/:eid', rateLimit({ windowMs: 60_000, max: 30 }), wrap(async (req, res) => {
    const out = await tournament.updateEntry(
        idParam(req.params.id), idParam(req.params.eid), req.user, req.get('x-entry-token'), req.body || {});
    res.json(out);
}));

// admins remove anyone; players can withdraw their own entry
router.delete('/tournaments/:id/entries/:eid', wrap((req, res) => {
    tournament.removeEntry(idParam(req.params.id), idParam(req.params.eid), { user: req.user, isAdmin: !!auth.isAdminReq(req) });
    res.json({ ok: true });
}));

router.patch('/tournaments/:id', requireAdmin, wrap((req, res) => {
    tournament.updateTournament(idParam(req.params.id), req.body || {});
    res.json({ ok: true });
}));

// Fix a result by hand: replay a pairing, or decide it (disqualification / no-show)
router.post('/tournaments/:id/series/:sid/reset', requireAdmin, wrap(async (req, res) => {
    await tournament.resetSeries(idParam(req.params.id), idParam(req.params.sid));
    res.json({ ok: true });
}));
router.post('/tournaments/:id/series/:sid/result', requireAdmin, wrap(async (req, res) => {
    await tournament.setSeriesResult(idParam(req.params.id), idParam(req.params.sid), (req.body || {}).winner);
    res.json({ ok: true });
}));

router.post('/tournaments/:id/start', requireAdmin, wrap((req, res) => {
    const t = tournament.startTournament(idParam(req.params.id), req.body || {});
    res.json({ ok: true, status: t.status });
}));

router.post('/tournaments/:id/run', requireAdmin, wrap((req, res) => {
    const mode = req.body && req.body.mode === 'next' ? 'next' : 'all';
    res.json(tournament.run(idParam(req.params.id), mode));
}));

router.post('/tournaments/:id/pause', requireAdmin, wrap((req, res) => {
    res.json(tournament.pause(idParam(req.params.id)));
}));

module.exports = { router, rateLimit };
