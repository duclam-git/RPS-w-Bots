// ===== OTTv2 Code Arena - Tournament Manager =====
// Formats:
//   single_elim      knockout bracket (byes for non power-of-two, optional 3rd-place match)
//   round_robin      one table, everybody plays everybody
//   groups_knockout  N groups (round robin) -> top K of each group -> knockout bracket
//
// A "series" is one pairing played as best-of-N games (sides alternate every game).
// Every game is played by the server, stored in SQLite, and streamed live over Socket.io.

'use strict';

const crypto = require('crypto');
const { db, saveMatch } = require('./db');
const engine = require('./engine');
const games = require('./games');
const runner = require('./runner');
const matchplay = require('./matchplay');

const LANGS = { javascript: 'javascript', js: 'javascript', python: 'python', py: 'python', cpp: 'cpp', 'c++': 'cpp' };
const FORMATS = ['single_elim', 'round_robin', 'groups_knockout'];
const MAX_SUDDEN_DEATH = 4;          // extra games allowed when a knockout series is tied
const MAX_CODE_BYTES = 100 * 1024;
const MAX_PARALLEL_VALIDATIONS = 4;

// =====================================================================
// Pure helpers (unit-tested in test/tournament.test.js)
// =====================================================================

function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

/** Standard bracket seeding order, e.g. 8 -> [1,8,4,5,2,7,3,6] (top seeds meet as late as possible). */
function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
        const next = order.length * 2 + 1;
        order = order.flatMap(s => [s, next - s]);
    }
    return order;
}

/** Circle method. Returns rounds -> [[a,b],...]; a bye is represented by omitting the pair. */
function roundRobinRounds(ids) {
    const list = ids.slice();
    if (list.length % 2) list.push(null);
    const n = list.length;
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
        const pairs = [];
        for (let i = 0; i < n / 2; i++) {
            let a = list[i];
            let b = list[n - 1 - i];
            if (a !== null && b !== null) {
                if ((r + i) % 2 === 1) [a, b] = [b, a];   // balance who starts as Blue
                pairs.push([a, b]);
            }
        }
        rounds.push(pairs);
        list.splice(1, 0, list.pop());
    }
    return rounds;
}

/** Serpentine distribution of seeded ids into G groups (1,2,..G,G,..2,1,1,2,..). */
function snakeGroups(ids, groupCount) {
    const groups = Array.from({ length: groupCount }, () => []);
    ids.forEach((id, i) => {
        const row = Math.floor(i / groupCount);
        const col = i % groupCount;
        groups[row % 2 === 0 ? col : groupCount - 1 - col].push(id);
    });
    return groups;
}

/**
 * First-round slots as a flat list [a0,b0,a1,b1,...] (null = bye). Swaps entries between pairs so that two
 * players from the same group do not meet in round one when that can be avoided. groupOf: entryId -> group.
 * Prefers swapping with a distant pair so the seeding stays as intact as possible.
 */
function separateGroups(slots, groupOf) {
    const out = slots.slice();
    const clash = (x, y) => x != null && y != null && groupOf[x] !== undefined && groupOf[x] === groupOf[y];
    const pairs = out.length / 2;
    for (let i = 0; i < pairs; i++) {
        if (!clash(out[2 * i], out[2 * i + 1])) continue;
        // candidates: the lower seed of pair i swaps with either member of another pair
        const order = [];
        for (let d = 1; d < pairs; d++) { order.push((i + d) % pairs); }
        order.sort((x, y) => Math.abs(y - i) - Math.abs(x - i));        // farthest pair first
        let fixed = false;
        for (const j of order) {
            for (const k of [2 * j + 1, 2 * j]) {
                const bi = 2 * i + 1;
                const newI = [out[2 * i], out[k]];
                const jOther = k === 2 * j ? out[2 * j + 1] : out[2 * j];
                const newJ = k === 2 * j ? [out[bi], jOther] : [jOther, out[bi]];
                if (!clash(newI[0], newI[1]) && !clash(newJ[0], newJ[1])) {
                    [out[bi], out[k]] = [out[k], out[bi]];
                    fixed = true;
                    break;
                }
            }
            if (fixed) break;
        }
    }
    return out;
}

/**
 * Round-robin table. seriesRows: finished series of ONE group
 * ({ entry_a, entry_b, wins_a, wins_b, draws, winner_entry, status }).
 * Order: points (win 3 / tie 1) -> game difference -> games won -> better seed.
 */
function computeStandings(entries, seriesRows) {
    const table = new Map();
    entries.forEach(e => table.set(e.id, {
        entryId: e.id, name: e.name, seed: e.seed == null ? 9999 : e.seed,
        played: 0, won: 0, tied: 0, lost: 0, points: 0, gamesWon: 0, gamesLost: 0
    }));
    const done = seriesRows.filter(s => s.status === 'done' && table.has(s.entry_a) && table.has(s.entry_b));
    for (const s of done) {
        const a = table.get(s.entry_a);
        const b = table.get(s.entry_b);
        a.played++; b.played++;
        a.gamesWon += s.wins_a; a.gamesLost += s.wins_b;
        b.gamesWon += s.wins_b; b.gamesLost += s.wins_a;
        if (s.winner_entry === a.entryId) { a.won++; a.points += 3; b.lost++; }
        else if (s.winner_entry === b.entryId) { b.won++; b.points += 3; a.lost++; }
        else { a.tied++; b.tied++; a.points++; b.points++; }
    }
    const rows = [...table.values()].map(r => ({ ...r, gameDiff: r.gamesWon - r.gamesLost }));
    const main = (r) => `${r.points}|${r.gameDiff}|${r.gamesWon}`;

    // Teams level on points, game difference AND games won: look at the games they played AGAINST EACH OTHER
    // (mini-league, same 3/1/0 scoring); only then fall back to the better seed.
    const buckets = new Map();
    rows.forEach(r => { const k = main(r); (buckets.get(k) || buckets.set(k, []).get(k)).push(r); });
    for (const group of buckets.values()) {
        group.forEach(r => { r.h2h = 0; r.tied_unresolved = false; });
        if (group.length < 2) continue;
        const ids = new Set(group.map(r => r.entryId));
        for (const s of done) {
            if (!ids.has(s.entry_a) || !ids.has(s.entry_b)) continue;
            const ra = group.find(r => r.entryId === s.entry_a), rb = group.find(r => r.entryId === s.entry_b);
            if (s.winner_entry === ra.entryId) ra.h2h += 3;
            else if (s.winner_entry === rb.entryId) rb.h2h += 3;
            else { ra.h2h++; rb.h2h++; }
        }
    }
    rows.sort((x, y) =>
        y.points - x.points || y.gameDiff - x.gameDiff || y.gamesWon - x.gamesWon || y.h2h - x.h2h || x.seed - y.seed);
    // "unresolved" = still level after head-to-head: only the seed separates them (a playoff may be needed)
    rows.forEach((r, i) => {
        const same = (o) => o && main(o) === main(r) && o.h2h === r.h2h;
        r.tied_unresolved = same(rows[i - 1]) || same(rows[i + 1]);
        r.rank = i + 1;
    });
    return rows;
}

/**
 * Has a series been decided?  Returns null (play another game) or { winner:'a'|'b'|'seed'|null, by }.
 * Knockout ties are resolved by sudden-death games, then by seed as a last resort.
 */
function decideSeries(s, knockout) {
    const needed = Math.floor(s.best_of / 2) + 1;
    if (s.wins_a >= needed) return { winner: 'a', by: 'score' };
    if (s.wins_b >= needed) return { winner: 'b', by: 'score' };
    if (s.games_played >= s.best_of) {
        if (s.wins_a > s.wins_b) return { winner: 'a', by: 'score' };
        if (s.wins_b > s.wins_a) return { winner: 'b', by: 'score' };
        if (!knockout) return { winner: null, by: 'tie' };
        if (s.games_played >= s.best_of + MAX_SUDDEN_DEATH) return { winner: 'seed', by: 'tiebreak' };
    }
    return null;
}

// =====================================================================
// Config / lookups
// =====================================================================

function clampInt(v, min, max, def) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(Math.max(n, min), max);
}

/**
 * Normalises a tournament config. `strict` (admin input): invalid rules throw a 400 with every problem
 * listed. Non-strict (reading a stored config): invalid parts are silently dropped.
 */
function normalizeConfig(raw = {}, strict = false, gameId = games.DEFAULT_GAME) {
    const cfg = {
        bestOf: clampInt(raw.bestOf, 1, 9, 3),             // knockout series length
        groupBestOf: clampInt(raw.groupBestOf, 1, 6, 2),   // games per pairing in group / table stage
        groupCount: clampInt(raw.groupCount, 1, 16, 2),
        advance: clampInt(raw.advance, 1, 8, 2),
        thirdPlace: !!raw.thirdPlace,
        moveDelayMs: clampInt(raw.moveDelayMs, 0, 3000, 0), // >0 = "show mode" so spectators can follow
        concurrency: clampInt(raw.concurrency, 1, 4, 2),
        requireLogin: raw.requireLogin !== false,        // registration needs an account (default)
        rules: {}
    };
    if (raw.rules && typeof raw.rules === 'object') {
        const v = (games.get(gameId) || games.get(games.DEFAULT_GAME)).validateRules(raw.rules);
        if (!v.ok && strict) throw new HttpError(400, `Luật chơi không hợp lệ: ${v.errors.join('; ')}`);
        cfg.rules = v.rules;     // overrides that passed validation (setup is dropped as a whole if invalid)
    }
    return cfg;
}

const getTournamentRow = (id) => db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
const getSeriesRow = (id) => db.prepare('SELECT * FROM series WHERE id = ?').get(id);
const getEntryRow = (id) => db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
const gameOf = (t) => games.get(t.game) || games.get(games.DEFAULT_GAME);
const tConfig = (t) => normalizeConfig(JSON.parse(t.config_json || '{}'), false, t.game);
const tRules = (t) => gameOf(t).resolveRules(tConfig(t).rules);

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

// =====================================================================
// Realtime plumbing
// =====================================================================

let io = null;
function setIO(server) { io = server; }

function roomOf(tid) { return `t:${tid}`; }
function emitTournament(tid, event, payload) {
    if (io) io.to(roomOf(tid)).emit(event, payload);
}
function notifyUpdated(tid) {
    if (!io) return;
    io.to(roomOf(tid)).emit('tournament_updated', { id: tid });
    io.emit('tournament_list_changed');
}

/** In-flight games (so spectators who join mid-game can catch up). liveId -> state */
const liveGames = new Map();
function liveForTournament(tid) {
    return [...liveGames.values()].filter(g => g.tournamentId === tid).map(g => ({
        liveId: g.liveId, seriesId: g.seriesId, gameNo: g.gameNo,
        blue: g.blue, red: g.red, board: g.board0, moves: g.moves
    }));
}
function liveGameCount() { return liveGames.size; }

// =====================================================================
// Create / register / start
// =====================================================================

function createTournament({ name, format, game, config }) {
    const cleanName = String(name || '').trim().slice(0, 80);
    if (!cleanName) throw new HttpError(400, 'Thiếu tên giải đấu');
    if (!FORMATS.includes(format)) throw new HttpError(400, `Thể thức không hợp lệ (${FORMATS.join(', ')})`);
    const gameId = game === undefined || game === null ? games.DEFAULT_GAME : String(game);
    if (!games.has(gameId)) throw new HttpError(400, `Trò chơi không tồn tại (${games.list().map(g => g.id).join(', ')})`);
    const cfg = normalizeConfig(config, true, gameId);
    const info = db.prepare(`INSERT INTO tournaments (name, format, game, config_json, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(cleanName, format, gameId, JSON.stringify(cfg), Date.now());
    notifyUpdated(Number(info.lastInsertRowid));
    return getTournamentRow(Number(info.lastInsertRowid));
}

let validationsInFlight = 0;

/** Compile + run the bot once on the opening position; throws HttpError(422) with the reason if it fails. */
async function validateBot(lang, code, rules, game) {
    if (validationsInFlight >= MAX_PARALLEL_VALIDATIONS) {
        throw new HttpError(429, 'Server đang kiểm tra nhiều bot, thử lại sau vài giây.');
    }
    validationsInFlight++;
    const probeId = `reg_${crypto.randomBytes(4).toString('hex')}`;
    let handler = null;
    try {
        const prep = await runner.prepareBot(probeId, lang, code, { game });
        if (!prep.success) throw new HttpError(422, prep.error);
        handler = prep.botHandler;
        const res = await matchplay.smokeTest(handler, rules, game);
        if (!res.ok) throw new HttpError(422, `Bot không chạy được: ${res.errors.join(' | ')}`);
    } finally {
        validationsInFlight--;
        if (handler) runner.cleanupBot(handler);
    }
}

function checkEntryInput({ name, lang, code }) {
    const cleanName = String(name || '').trim().slice(0, 40);
    if (!cleanName) throw new HttpError(400, 'Thiếu tên người chơi / bot');
    const normLang = LANGS[String(lang || '').toLowerCase()];
    if (!normLang) throw new HttpError(400, 'Ngôn ngữ phải là javascript, python hoặc cpp');
    if (typeof code !== 'string' || !code.trim()) throw new HttpError(400, 'Thiếu code bot');
    if (Buffer.byteLength(code, 'utf-8') > MAX_CODE_BYTES) throw new HttpError(413, 'Code quá lớn (tối đa 100KB)');
    return { name: cleanName, lang: normLang, code };
}

async function registerEntry(tid, input, user) {
    const t = getTournamentRow(tid);
    if (!t) throw new HttpError(404, 'Không tìm thấy giải đấu');
    if (t.status !== 'registration') throw new HttpError(409, 'Giải đấu đã đóng đăng ký');
    if (tConfig(t).requireLogin && !user) throw new HttpError(401, 'Bạn cần đăng nhập để đăng ký giải đấu');

    // Logged-in players always compete under their account name (nobody can impersonate anybody)
    const e = checkEntryInput({ name: user ? user.username : input.name, lang: input.lang, code: input.code });
    if (user) {
        const mine = db.prepare('SELECT 1 FROM entries WHERE tournament_id = ? AND user_id = ?').get(tid, user.id);
        if (mine) throw new HttpError(409, 'Bạn đã đăng ký giải này — hãy cập nhật code thay vì đăng ký lại');
    } else if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(e.name)) {
        throw new HttpError(409, `Tên "${e.name}" thuộc về một tài khoản — hãy đăng nhập để dùng tên này`);
    }
    const dup = db.prepare('SELECT 1 FROM entries WHERE tournament_id = ? AND name = ? COLLATE NOCASE').get(tid, e.name);
    if (dup) throw new HttpError(409, `Tên "${e.name}" đã có người đăng ký`);

    await validateBot(e.lang, e.code, tRules(t), gameOf(t));

    // re-check after the async validation (state may have changed meanwhile)
    const t2 = getTournamentRow(tid);
    if (!t2 || t2.status !== 'registration') throw new HttpError(409, 'Giải đấu đã đóng đăng ký');
    const token = crypto.randomBytes(12).toString('hex');
    let info;
    try {
        info = db.prepare(`INSERT INTO entries (tournament_id, name, lang, code, edit_token, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(tid, e.name, e.lang, e.code, token, user ? user.id : null, Date.now());
    } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw new HttpError(409, `Tên "${e.name}" đã có người đăng ký`);
        throw err;
    }
    notifyUpdated(tid);
    // anonymous entries are edited with this token; account entries are edited through the session
    return { id: Number(info.lastInsertRowid), name: e.name, lang: e.lang, editToken: user ? null : token };
}

async function updateEntry(tid, entryId, user, token, input) {
    const t = getTournamentRow(tid);
    if (!t) throw new HttpError(404, 'Không tìm thấy giải đấu');
    if (t.status !== 'registration') throw new HttpError(409, 'Giải đấu đã bắt đầu, không thể sửa code');
    const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND tournament_id = ?').get(entryId, tid);
    if (!entry) throw new HttpError(404, 'Không tìm thấy bot');
    if (entry.user_id) {
        if (!user) throw new HttpError(401, 'Bạn cần đăng nhập');
        if (user.id !== entry.user_id) throw new HttpError(403, 'Đây không phải bot của bạn');
    } else {
        const given = Buffer.from(String(token || ''));
        const real = Buffer.from(entry.edit_token);
        if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) throw new HttpError(403, 'Sai mã chỉnh sửa');
    }
    const e = checkEntryInput({ name: entry.name, lang: input.lang || entry.lang, code: input.code });
    await validateBot(e.lang, e.code, tRules(t), gameOf(t));
    db.prepare('UPDATE entries SET lang = ?, code = ? WHERE id = ?').run(e.lang, e.code, entryId);
    notifyUpdated(tid);
    return { id: entryId, name: entry.name, lang: e.lang };
}

/** Admins can remove anyone; a player can withdraw their own entry while registration is open. */
function removeEntry(tid, entryId, { user, isAdmin }) {
    const t = getTournamentRow(tid);
    if (!t) throw new HttpError(404, 'Không tìm thấy giải đấu');
    if (t.status !== 'registration') throw new HttpError(409, 'Giải đấu đã bắt đầu');
    const entry = db.prepare('SELECT user_id FROM entries WHERE id = ? AND tournament_id = ?').get(entryId, tid);
    if (!entry) throw new HttpError(404, 'Không tìm thấy bot');
    if (!isAdmin && !(user && entry.user_id === user.id)) throw new HttpError(403, 'Bạn không có quyền xóa bot này');
    db.prepare('DELETE FROM entries WHERE id = ? AND tournament_id = ?').run(entryId, tid);
    notifyUpdated(tid);
}

// ----- schedule generation -----

const insertSeries = db.prepare(`
    INSERT INTO series (tournament_id, stage, group_no, round, slot, best_of, entry_a, entry_b, status)
    VALUES (@tid, @stage, @group_no, @round, @slot, @best_of, @a, @b, @status)
`);

function addSeries(tid, o) {
    const info = insertSeries.run({
        tid, stage: o.stage, group_no: o.groupNo == null ? null : o.groupNo,
        round: o.round, slot: o.slot, best_of: o.bestOf,
        a: o.a || null, b: o.b || null, status: o.status || 'pending'
    });
    return Number(info.lastInsertRowid);
}

function putIntoSlot(seriesId, slot, entryId) {
    const col = slot === 'a' ? 'entry_a' : 'entry_b';
    db.prepare(`UPDATE series SET ${col} = ? WHERE id = ?`).run(entryId, seriesId);
    const s = getSeriesRow(seriesId);
    if (s.entry_a && s.entry_b && s.status === 'pending') {
        db.prepare(`UPDATE series SET status = 'ready' WHERE id = ?`).run(seriesId);
    }
}

/** Mark a series finished and push winner (and loser, for the 3rd-place match) forward. */
function settleSeries(s, winnerId, loserId, status, by) {
    db.prepare(`UPDATE series SET status = ?, winner_entry = ?, decided_by = ? WHERE id = ?`)
        .run(status, winnerId || null, by, s.id);
    if (s.win_next && winnerId) putIntoSlot(s.win_next, s.win_next_slot, winnerId);
    if (s.lose_next && loserId) putIntoSlot(s.lose_next, s.lose_next_slot, loserId);
}

function createKnockout(tid, ids, { bestOf, thirdPlace, groupOf }) {
    const n = ids.length;
    const size = nextPow2(n);
    const rounds = Math.log2(size);
    const order = seedOrder(size);
    const grid = [];

    // round-one slots from the seeding; groupmates are pulled apart where possible (knockout after a group stage)
    let slots = order.map(seed => ids[seed - 1] || null);
    if (groupOf) slots = separateGroups(slots, groupOf);

    for (let r = 1; r <= rounds; r++) {
        const count = size / 2 ** r;
        grid.push([]);
        for (let slot = 0; slot < count; slot++) {
            const a = r === 1 ? slots[2 * slot] : null;
            const b = r === 1 ? slots[2 * slot + 1] : null;
            grid[r - 1].push(addSeries(tid, { stage: 'bracket', round: r, slot, bestOf, a, b }));
        }
    }
    for (let r = 1; r < rounds; r++) {
        grid[r - 1].forEach((sid, slot) => {
            db.prepare('UPDATE series SET win_next = ?, win_next_slot = ? WHERE id = ?')
                .run(grid[r][Math.floor(slot / 2)], slot % 2 === 0 ? 'a' : 'b', sid);
        });
    }
    // 3rd place only when both semi-finals are real matches (no byes in the semis)
    if (thirdPlace && rounds >= 2 && (size >= 8 || n === 4)) {
        const thirdId = addSeries(tid, { stage: 'third_place', round: rounds, slot: 1, bestOf });
        grid[rounds - 2].forEach((sid, slot) => {
            db.prepare('UPDATE series SET lose_next = ?, lose_next_slot = ? WHERE id = ?')
                .run(thirdId, slot === 0 ? 'a' : 'b', sid);
        });
    }
    // activate round 1 (byes advance immediately)
    for (const sid of grid[0]) {
        const s = getSeriesRow(sid);
        if (s.entry_a && s.entry_b) db.prepare(`UPDATE series SET status = 'ready' WHERE id = ?`).run(sid);
        else settleSeries(s, s.entry_a || s.entry_b, null, 'bye', 'bye');
    }
}

function createGroupStage(tid, groups, bestOf) {
    groups.forEach((ids, g) => {
        db.prepare('UPDATE entries SET group_no = ? WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(g, ...ids);
        let slot = 0;
        roundRobinRounds(ids).forEach((pairs, r) => {
            pairs.forEach(([a, b]) => addSeries(tid, { stage: 'group', groupNo: g, round: r + 1, slot: slot++, bestOf, a, b, status: 'ready' }));
        });
    });
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Lock registration, seed the entries and generate the schedule.
 * opts.seeding: 'registration' (default) | 'random' | 'rating' (Elo) | 'manual' (opts.order = [entryId,...])
 */
function startTournament(tid, opts = {}) {
    const t = getTournamentRow(tid);
    if (!t) throw new HttpError(404, 'Không tìm thấy giải đấu');
    if (t.status !== 'registration') throw new HttpError(409, 'Giải đấu đã bắt đầu');
    const cfg = tConfig(t);
    const entries = db.prepare('SELECT id FROM entries WHERE tournament_id = ? ORDER BY id').all(tid).map(r => r.id);
    if (entries.length < 2) throw new HttpError(400, 'Cần ít nhất 2 bot để bắt đầu');

    let seeded = entries;
    if (opts.seeding === 'random') seeded = shuffle(entries);
    else if (opts.seeding === 'rating') {
        // strongest account first (guests / anonymous entries count as 1200)
        const rows = db.prepare(`
            SELECT e.id, COALESCE(u.elo, 1200) AS elo, COALESCE(u.wins, 0) AS wins
            FROM entries e LEFT JOIN users u ON u.id = e.user_id WHERE e.tournament_id = ?`).all(tid);
        rows.sort((a, b) => b.elo - a.elo || b.wins - a.wins || a.id - b.id);
        seeded = rows.map(r => r.id);
    } else if (opts.seeding === 'manual') {
        const order = (opts.order || []).map(Number);
        if (order.length !== entries.length || !entries.every(id => order.includes(id))) {
            throw new HttpError(400, 'Danh sách seed thủ công phải gồm đủ tất cả bot');
        }
        seeded = order;
    }

    if (t.format === 'groups_knockout') {
        if (cfg.groupCount * 2 > entries.length) throw new HttpError(400, `Cần ít nhất ${cfg.groupCount * 2} bot cho ${cfg.groupCount} bảng`);
        const minGroup = Math.floor(entries.length / cfg.groupCount);
        if (cfg.advance > minGroup) throw new HttpError(400, `Số đội đi tiếp (${cfg.advance}) lớn hơn số đội của bảng nhỏ nhất (${minGroup})`);
        if (cfg.groupCount * cfg.advance < 2) throw new HttpError(400, 'Cần ít nhất 2 đội đi tiếp vào vòng knockout');
    }

    db.transaction(() => {
        seeded.forEach((id, i) => db.prepare('UPDATE entries SET seed = ? WHERE id = ?').run(i + 1, id));
        if (t.format === 'single_elim') {
            createKnockout(tid, seeded, { bestOf: cfg.bestOf, thirdPlace: cfg.thirdPlace });
        } else if (t.format === 'round_robin') {
            createGroupStage(tid, [seeded], cfg.groupBestOf);
        } else {
            createGroupStage(tid, snakeGroups(seeded, cfg.groupCount), cfg.groupBestOf);
        }
        db.prepare(`UPDATE tournaments SET status = 'running', started_at = ? WHERE id = ?`).run(Date.now(), tid);
    })();
    notifyUpdated(tid);
    return getTournamentRow(tid);
}

// =====================================================================
// Admin edits (issue #4)
// =====================================================================

/**
 * Edit a tournament. While registration is open everything (name, format, rules) can change.
 * Once it has started only the name and the run-time knobs (show-mode delay, concurrency) can,
 * because games were already played under the old rules.
 */
function updateTournament(tid, { name, format, game, config }) {
    const t = getTournamentRow(tid);
    if (!t) throw new HttpError(404, 'Không tìm thấy giải đấu');
    const newName = name === undefined ? t.name : String(name || '').trim().slice(0, 80);
    if (!newName) throw new HttpError(400, 'Thiếu tên giải đấu');

    if (t.status === 'registration') {
        const newFormat = format === undefined ? t.format : format;
        if (!FORMATS.includes(newFormat)) throw new HttpError(400, `Thể thức không hợp lệ (${FORMATS.join(', ')})`);
        const newGame = game === undefined ? t.game : String(game);
        if (!games.has(newGame)) throw new HttpError(400, `Trò chơi không tồn tại (${games.list().map(g => g.id).join(', ')})`);
        if (newGame !== t.game && db.prepare('SELECT 1 FROM entries WHERE tournament_id = ?').get(tid)) {
            throw new HttpError(409, 'Đã có bot đăng ký (viết cho trò chơi cũ) — hãy xóa hết bot trước khi đổi trò chơi');
        }
        // rules left untouched when only the name changes; a different game needs its own rules
        const cfg = config === undefined ? (newGame === t.game ? tConfig(t) : normalizeConfig({}, true, newGame)) : normalizeConfig(config, true, newGame);
        db.prepare('UPDATE tournaments SET name = ?, format = ?, game = ?, config_json = ? WHERE id = ?')
            .run(newName, newFormat, newGame, JSON.stringify(cfg), tid);
    } else {
        if (format !== undefined && format !== t.format) throw new HttpError(409, 'Giải đã bắt đầu, không thể đổi thể thức');
        if (game !== undefined && game !== t.game) throw new HttpError(409, 'Giải đã bắt đầu, không thể đổi trò chơi');
        const cfg = tConfig(t);
        if (config) {
            const touchesRules = config.rules !== undefined && JSON.stringify(normalizeConfig(config, false, t.game).rules) !== JSON.stringify(cfg.rules);
            if (touchesRules) throw new HttpError(409, 'Giải đã bắt đầu, không thể đổi luật chơi (các ván đã đấu theo luật cũ)');
            if (config.moveDelayMs !== undefined) cfg.moveDelayMs = clampInt(config.moveDelayMs, 0, 3000, cfg.moveDelayMs);
            if (config.concurrency !== undefined) cfg.concurrency = clampInt(config.concurrency, 1, 4, cfg.concurrency);
        }
        db.prepare('UPDATE tournaments SET name = ?, config_json = ? WHERE id = ?').run(newName, JSON.stringify(cfg), tid);
    }
    notifyUpdated(tid);
    return getTournamentRow(tid);
}

/**
 * Result edits need the scheduler idle. A loop that is still winding down (just paused, or the tournament
 * just finished) is waited for; one that is genuinely running must be paused first.
 */
async function requirePausedRunning(tid) {
    const t = getTournamentRow(tid);
    if (!t) throw new HttpError(404, 'Không tìm thấy giải đấu');
    if (t.status === 'registration') throw new HttpError(409, 'Giải chưa bắt đầu');
    const loop = loops.get(tid);
    if (loop) {
        if (!loop.stop) throw new HttpError(409, 'Hãy tạm dừng giải trước khi chỉnh sửa kết quả');
        const t0 = Date.now();
        while (loops.has(tid) && Date.now() - t0 < 5000) await matchplay.sleep(25);
        if (loops.has(tid)) throw new HttpError(409, 'Giải đang dừng lại, thử lại sau giây lát');
    }
    return getTournamentRow(tid);
}

function clearSlot(seriesId, slot) {
    const col = slot === 'a' ? 'entry_a' : 'entry_b';
    db.prepare(`UPDATE series SET ${col} = NULL, status = CASE WHEN status = 'ready' THEN 'pending' ELSE status END WHERE id = ?`).run(seriesId);
}

/**
 * Throw away a pairing's games and play it again. Refused when later rounds already used its result
 * (reset those first) or when the group stage has already produced the knockout bracket.
 */
async function resetSeries(tid, seriesId) {
    const t = await requirePausedRunning(tid);
    const s = getSeriesRow(seriesId);
    if (!s || s.tournament_id !== tid) throw new HttpError(404, 'Không tìm thấy cặp đấu');
    if (s.status === 'bye') throw new HttpError(409, 'Cặp miễn đấu (bye) không thể đấu lại');
    if (s.status === 'running') throw new HttpError(409, 'Cặp này đang đấu');
    if (s.stage === 'group' && db.prepare(`SELECT 1 FROM series WHERE tournament_id = ? AND stage IN ('bracket','third_place')`).get(tid)) {
        throw new HttpError(409, 'Vòng bảng đã chốt và nhánh loại trực tiếp đã được tạo — không thể đấu lại');
    }
    for (const nextId of [s.win_next, s.lose_next].filter(Boolean)) {
        const n = getSeriesRow(nextId);
        if (n.games_played > 0 || !['pending', 'ready'].includes(n.status)) {
            throw new HttpError(409, 'Vòng sau đã dùng kết quả cặp này — hãy đấu lại vòng sau trước');
        }
    }
    db.transaction(() => {
        db.prepare('DELETE FROM matches WHERE series_id = ?').run(seriesId);
        if (s.win_next) clearSlot(s.win_next, s.win_next_slot);
        if (s.lose_next) clearSlot(s.lose_next, s.lose_next_slot);
        db.prepare(`UPDATE series SET wins_a = 0, wins_b = 0, draws = 0, games_played = 0, winner_entry = NULL, decided_by = NULL,
                    status = CASE WHEN entry_a IS NOT NULL AND entry_b IS NOT NULL THEN 'ready' ELSE 'pending' END WHERE id = ?`).run(seriesId);
        if (t.status === 'finished') {
            db.prepare(`UPDATE tournaments SET status = 'running', champion_entry_id = NULL, finished_at = NULL WHERE id = ?`).run(tid);
        }
    })();
    notifyUpdated(tid);
}

/** Admin decides a pairing by hand (disqualification, no-show…). 'tie' is allowed in the group stage only. */
async function setSeriesResult(tid, seriesId, winner) {
    await requirePausedRunning(tid);
    const s = getSeriesRow(seriesId);
    if (!s || s.tournament_id !== tid) throw new HttpError(404, 'Không tìm thấy cặp đấu');
    if (s.status !== 'ready') throw new HttpError(409, s.status === 'done' ? 'Cặp đã có kết quả — hãy "Đấu lại" trước' : 'Cặp này chưa sẵn sàng');
    if (!s.entry_a || !s.entry_b) throw new HttpError(409, 'Cặp đấu chưa đủ hai đội');
    if (winner === 'tie') {
        if (s.stage !== 'group') throw new HttpError(400, 'Chỉ vòng bảng mới được xử hòa');
    } else if (winner !== 'a' && winner !== 'b') throw new HttpError(400, 'winner phải là "a", "b" hoặc "tie"');
    finishSeries(s, winner === 'tie' ? { winner: null, by: 'admin' } : { winner, by: 'admin' });
}

// =====================================================================
// Progression
// =====================================================================

function groupStandings(tid) {
    const out = {};
    const entries = db.prepare('SELECT id, name, seed, group_no FROM entries WHERE tournament_id = ?').all(tid);
    const series = db.prepare(`SELECT * FROM series WHERE tournament_id = ? AND stage = 'group'`).all(tid);
    const groupNos = [...new Set(entries.map(e => e.group_no == null ? 0 : e.group_no))].sort((a, b) => a - b);
    for (const g of groupNos) {
        out[g] = computeStandings(
            entries.filter(e => (e.group_no == null ? 0 : e.group_no) === g),
            series.filter(s => s.group_no === g));
    }
    return out;
}

function advanceFromGroups(tid) {
    const t = getTournamentRow(tid);
    if (!t || t.format !== 'groups_knockout') return;
    const groupSeries = db.prepare(`SELECT status FROM series WHERE tournament_id = ? AND stage = 'group'`).all(tid);
    if (groupSeries.some(s => s.status !== 'done')) return;
    const hasBracket = db.prepare(`SELECT 1 FROM series WHERE tournament_id = ? AND stage IN ('bracket','third_place')`).get(tid);
    if (hasBracket) return;

    const cfg = tConfig(t);
    const standings = groupStandings(tid);
    const qualifiers = [];
    const groupOf = {};
    for (const [g, rows] of Object.entries(standings)) {
        rows.slice(0, cfg.advance).forEach(r => { qualifiers.push(r); groupOf[r.entryId] = Number(g); });
    }
    // best group winners first, then runners-up ... -> standard bracket seeding keeps groupmates apart early
    qualifiers.sort((x, y) =>
        x.rank - y.rank || y.points - x.points || y.gameDiff - x.gameDiff || y.gamesWon - x.gamesWon || x.seed - y.seed);
    db.transaction(() => {
        createKnockout(tid, qualifiers.map(q => q.entryId), { bestOf: cfg.bestOf, thirdPlace: cfg.thirdPlace, groupOf });
    })();
}

function maybeFinish(tid) {
    const t = getTournamentRow(tid);
    if (!t || t.status !== 'running') return false;
    const open = db.prepare(`SELECT COUNT(*) AS n FROM series WHERE tournament_id = ? AND status NOT IN ('done','bye')`).get(tid).n;
    if (open > 0) return false;

    // Round robin: if the table is STILL level at the top after every tie-break, play it out instead of
    // letting the seed decide. (Mini knockout between the tied teams, same series length as a knockout.)
    if (t.format === 'round_robin' && !db.prepare(`SELECT 1 FROM series WHERE tournament_id = ? AND stage = 'bracket'`).get(tid)) {
        const top = (groupStandings(tid)[0] || []);
        const tied = top.filter(r => r.rank === 1 || (r.tied_unresolved && top[0] && r.points === top[0].points
            && r.gameDiff === top[0].gameDiff && r.gamesWon === top[0].gamesWon && r.h2h === top[0].h2h));
        if (top[0] && top[0].tied_unresolved && tied.length >= 2) {
            db.transaction(() => {
                createKnockout(tid, tied.map(r => r.entryId), { bestOf: tConfig(t).bestOf, thirdPlace: false });
            })();
            return false;                                   // the playoff series are now 'ready'
        }
    }

    let champion = null;
    const final = db.prepare(`SELECT winner_entry FROM series WHERE tournament_id = ? AND stage = 'bracket' AND win_next IS NULL`).get(tid);
    if (final) champion = final.winner_entry;
    else if (t.format === 'round_robin') {
        const st = groupStandings(tid);
        champion = st[0] && st[0][0] ? st[0][0].entryId : null;
    }
    db.prepare(`UPDATE tournaments SET status = 'finished', champion_entry_id = ?, finished_at = ?, auto_run = 0 WHERE id = ?`)
        .run(champion, Date.now(), tid);
    releaseHandlers(tid);
    const loop = loops.get(tid);
    if (loop) loop.stop = true;          // nothing left to schedule: let the workers exit now, not after a poll
    return true;
}

// =====================================================================
// Bot process handles (compiled once per entry, reused for every game)
// =====================================================================

const handlers = new Map();   // entryId -> handler

async function ensureHandler(tid, entry) {
    if (handlers.has(entry.id)) return handlers.get(entry.id);
    const prep = await runner.prepareBot(`t${tid}_e${entry.id}`, entry.lang, entry.code, { game: gameOf(getTournamentRow(tid)) });
    if (!prep.success) return null;
    handlers.set(entry.id, prep.botHandler);
    return prep.botHandler;
}

function releaseHandlers(tid) {
    const ids = db.prepare('SELECT id FROM entries WHERE tournament_id = ?').all(tid).map(r => r.id);
    for (const id of ids) {
        const h = handlers.get(id);
        if (h) { runner.cleanupBot(h); handlers.delete(id); }
    }
}

// =====================================================================
// Running games
// =====================================================================

const loops = new Map();   // tid -> { stop, signals:Set, runningSeries:Set, startedCount }

function claimNextReady(tid, ctl) {
    return db.transaction(() => {
        const s = db.prepare(`
            SELECT * FROM series WHERE tournament_id = ? AND status = 'ready'
            ORDER BY CASE stage WHEN 'group' THEN 0 WHEN 'bracket' THEN 1 ELSE 2 END, round, slot LIMIT 1
        `).get(tid);
        if (!s) return null;
        db.prepare(`UPDATE series SET status = 'running' WHERE id = ?`).run(s.id);
        ctl.runningSeries.add(s.id);
        return getSeriesRow(s.id);
    })();
}

async function playSeries(tid, seriesId, ctl) {
    const knockoutStage = (st) => st !== 'group';
    try {
        for (;;) {
            const s = getSeriesRow(seriesId);
            const t = getTournamentRow(tid);
            if (!s || !t) return;                       // tournament deleted meanwhile
            const knockout = knockoutStage(s.stage);

            const decision = decideSeries(s, knockout);
            if (decision) return finishSeries(s, decision);
            if (ctl.stop) {
                db.prepare(`UPDATE series SET status = 'ready' WHERE id = ? AND status = 'running'`).run(seriesId);
                return;
            }

            const entryA = getEntryRow(s.entry_a);
            const entryB = getEntryRow(s.entry_b);
            const hA = entryA && await ensureHandler(tid, entryA);
            const hB = entryB && await ensureHandler(tid, entryB);
            if (!hA || !hB) {                            // bot could not even start -> forfeit
                return finishSeries(s, { winner: hA ? 'a' : 'b', by: 'forfeit' });
            }

            const gameNo = s.games_played + 1;
            const aIsBlue = gameNo % 2 === 1;
            const blue = aIsBlue ? { entry: entryA, handler: hA } : { entry: entryB, handler: hB };
            const red = aIsBlue ? { entry: entryB, handler: hB } : { entry: entryA, handler: hA };
            const rules = tRules(t);
            const cfg = tConfig(t);

            const liveId = `${seriesId}-${gameNo}`;
            const signal = { aborted: false };
            ctl.signals.add(signal);

            const result = await matchplay.playMatch({
                game: gameOf(t),
                blue: { name: blue.entry.name, lang: blue.entry.lang, handler: blue.handler },
                red: { name: red.entry.name, lang: red.entry.lang, handler: red.handler },
                rules,
                delayMs: cfg.moveDelayMs,
                signal,
                onStart: (board) => {
                    const live = {
                        liveId, tournamentId: tid, seriesId, gameNo,
                        blue: { name: blue.entry.name, lang: blue.entry.lang },
                        red: { name: red.entry.name, lang: red.entry.lang },
                        board0: board, moves: []
                    };
                    liveGames.set(liveId, live);
                    emitTournament(tid, 'live_game_start', {
                        liveId, seriesId, gameNo, blue: live.blue, red: live.red, board
                    });
                },
                onMove: ({ move }) => {
                    const slim = {
                        ply: move.ply, player: move.player, from: move.from, to: move.to,
                        pieceType: move.pieceType, capture: move.capture, fallback: move.fallback
                    };
                    const live = liveGames.get(liveId);
                    if (live) live.moves.push(slim);
                    emitTournament(tid, 'live_game_move', { liveId, move: slim });
                }
            });
            ctl.signals.delete(signal);
            liveGames.delete(liveId);

            if (result.aborted) {
                emitTournament(tid, 'live_game_end', { liveId, aborted: true });
                db.prepare(`UPDATE series SET status = 'ready' WHERE id = ? AND status = 'running'`).run(seriesId);
                return;
            }

            const winnerText = result.winner === 1 ? 'blue' : result.winner === 2 ? 'red' : 'draw';
            const aWon = (winnerText === 'blue' && aIsBlue) || (winnerText === 'red' && !aIsBlue);
            const bWon = winnerText !== 'draw' && !aWon;

            let matchId;
            try {
                matchId = db.transaction(() => {
                    const id = saveMatch({
                        game: t.game, kind: 'tournament', tournamentId: tid, seriesId, gameNo,
                        blue: { name: blue.entry.name, lang: blue.entry.lang, entryId: blue.entry.id, userId: blue.entry.user_id },
                        red: { name: red.entry.name, lang: red.entry.lang, entryId: red.entry.id, userId: red.entry.user_id },
                        winner: result.winner, reason: result.reason, rules, durationMs: result.durationMs
                    }, result.moves);
                    db.prepare(`UPDATE series SET games_played = games_played + 1, wins_a = wins_a + ?, wins_b = wins_b + ?, draws = draws + ? WHERE id = ?`)
                        .run(aWon ? 1 : 0, bWon ? 1 : 0, winnerText === 'draw' ? 1 : 0, seriesId);
                    return id;
                })();
            } catch (err) {
                if (!getTournamentRow(tid)) return;       // deleted while the game was running
                throw err;
            }

            emitTournament(tid, 'live_game_end', { liveId, matchId, winner: winnerText, reason: result.reason });
            notifyUpdated(tid);
        }
    } catch (err) {
        console.error(`[tournament ${tid}] lỗi khi chạy series ${seriesId}:`, err);
        db.prepare(`UPDATE series SET status = 'ready' WHERE id = ? AND status = 'running'`).run(seriesId);
        ctl.stop = true;                                  // don't spin on a broken series
    } finally {
        ctl.runningSeries.delete(seriesId);
    }
}

function finishSeries(s, decision) {
    let winnerId = null;
    let loserId = null;
    let by = decision.by;
    if (decision.winner === 'a') { winnerId = s.entry_a; loserId = s.entry_b; }
    else if (decision.winner === 'b') { winnerId = s.entry_b; loserId = s.entry_a; }
    else if (decision.winner === 'seed') {
        const a = getEntryRow(s.entry_a);
        const b = getEntryRow(s.entry_b);
        const aBetter = (a.seed || 9999) <= (b.seed || 9999);
        winnerId = aBetter ? a.id : b.id;
        loserId = aBetter ? b.id : a.id;
    }
    db.transaction(() => {
        settleSeries(s, winnerId, loserId, 'done', by);
        if (s.stage === 'group') advanceFromGroups(s.tournament_id);
    })();
    maybeFinish(s.tournament_id);
    notifyUpdated(s.tournament_id);
}

/**
 * Start (or resume) running games for a tournament.
 * mode 'all'  : keep going until the tournament is finished or paused
 * mode 'next' : play exactly one ready series, then stop
 */
function run(tid, mode = 'all') {
    const t = getTournamentRow(tid);
    if (!t) throw new HttpError(404, 'Không tìm thấy giải đấu');
    if (t.status !== 'running') throw new HttpError(409, 'Giải đấu chưa bắt đầu hoặc đã kết thúc');
    if (loops.has(tid)) return { started: false, message: 'Giải đấu đang chạy' };

    const cfg = tConfig(t);
    const ctl = { stop: false, signals: new Set(), runningSeries: new Set(), started: 0 };
    loops.set(tid, ctl);
    if (mode === 'all') db.prepare('UPDATE tournaments SET auto_run = 1 WHERE id = ?').run(tid);
    const maxSeries = mode === 'next' ? 1 : Infinity;
    const workers = mode === 'next' ? 1 : cfg.concurrency;

    const worker = async () => {
        while (!ctl.stop) {
            if (ctl.started >= maxSeries) return;
            const s = claimNextReady(tid, ctl);
            if (!s) {
                if (ctl.runningSeries.size === 0) return;
                await matchplay.sleep(40);                // another worker may unlock the next round
                continue;
            }
            ctl.started++;
            notifyUpdated(tid);
            await playSeries(tid, s.id, ctl);
        }
    };

    Promise.all(Array.from({ length: workers }, worker))
        .catch(err => console.error(`[tournament ${tid}] loop error`, err))
        .finally(() => {
            loops.delete(tid);
            const cur = getTournamentRow(tid);
            if (cur && ctl.stop && !ctl.shuttingDown) db.prepare('UPDATE tournaments SET auto_run = 0 WHERE id = ?').run(tid);
            notifyUpdated(tid);
        });
    notifyUpdated(tid);
    return { started: true };
}

function pause(tid) {
    const ctl = loops.get(tid);
    db.prepare('UPDATE tournaments SET auto_run = 0 WHERE id = ?').run(tid);
    if (!ctl) return { paused: false };
    ctl.stop = true;
    ctl.signals.forEach(sig => { sig.aborted = true; });
    return { paused: true };
}

/**
 * Server is going down: stop every scheduler but KEEP auto_run, so recoverOnBoot() resumes them.
 * Unfinished games are discarded (series return to 'ready').
 */
async function shutdown(maxWaitMs = 6000) {
    for (const ctl of loops.values()) {
        ctl.shuttingDown = true;
        ctl.stop = true;
        ctl.signals.forEach(sig => { sig.aborted = true; });
    }
    const t0 = Date.now();
    while (loops.size && Date.now() - t0 < maxWaitMs) await matchplay.sleep(50);
}

function deleteTournament(tid) {
    const t = getTournamentRow(tid);
    if (!t) throw new HttpError(404, 'Không tìm thấy giải đấu');
    pause(tid);
    releaseHandlers(tid);
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(tid);
    if (io) io.emit('tournament_list_changed');
}

/** Call once on boot: unfinished games are discarded, auto-run tournaments continue. */
function recoverOnBoot() {
    db.prepare(`UPDATE series SET status = 'ready' WHERE status = 'running'`).run();
    const resume = db.prepare(`SELECT id FROM tournaments WHERE status = 'running' AND auto_run = 1`).all();
    resume.forEach(r => {
        try { run(r.id, 'all'); } catch (e) { console.error('resume failed', e.message); }
    });
}

// =====================================================================
// Read models for the API / UI (never expose bot source code or edit tokens)
// =====================================================================

function listTournaments() {
    return db.prepare(`
        SELECT t.id, t.name, t.format, t.game, t.status, t.created_at AS createdAt, t.started_at AS startedAt,
               t.finished_at AS finishedAt,
               (SELECT COUNT(*) FROM entries e WHERE e.tournament_id = t.id) AS entryCount,
               (SELECT name FROM entries e WHERE e.id = t.champion_entry_id) AS champion
        FROM tournaments t ORDER BY t.id DESC
    `).all();
}

function getTournamentDetail(tid) {
    const t = getTournamentRow(tid);
    if (!t) return null;
    const entries = db.prepare(`
        SELECT e.id, e.name, e.lang, e.seed, e.group_no AS groupNo, e.user_id AS userId, u.username, u.elo
        FROM entries e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.tournament_id = ? ORDER BY COALESCE(e.seed, 9999), e.id`).all(tid);
    const byId = new Map(entries.map(e => [e.id, e]));
    const ref = (id) => (id && byId.get(id) ? { id, name: byId.get(id).name, seed: byId.get(id).seed } : null);

    const matchesBySeries = new Map();
    db.prepare(`SELECT id, series_id, game_no, winner, plies, blue_name, red_name FROM matches WHERE tournament_id = ? ORDER BY game_no`).all(tid)
        .forEach(m => {
            if (!matchesBySeries.has(m.series_id)) matchesBySeries.set(m.series_id, []);
            matchesBySeries.get(m.series_id).push({
                id: m.id, gameNo: m.game_no, winner: m.winner, plies: m.plies, blueName: m.blue_name, redName: m.red_name
            });
        });

    const series = db.prepare(`SELECT * FROM series WHERE tournament_id = ? ORDER BY id`).all(tid).map(s => ({
        id: s.id, stage: s.stage, groupNo: s.group_no, round: s.round, slot: s.slot, bestOf: s.best_of,
        a: ref(s.entry_a), b: ref(s.entry_b),
        winsA: s.wins_a, winsB: s.wins_b, draws: s.draws, gamesPlayed: s.games_played,
        status: s.status, winnerEntry: s.winner_entry, decidedBy: s.decided_by,
        matches: matchesBySeries.get(s.id) || []
    }));

    const standings = t.format === 'single_elim' ? {} : groupStandings(tid);
    return {
        tournament: {
            id: t.id, name: t.name, format: t.format, status: t.status, config: tConfig(t),
            game: (({ id, name, short, movesHaveFrom, botHint }) => ({ id, name, short, movesHaveFrom, botHint }))(gameOf(t)),
            autoRun: !!t.auto_run, running: loops.has(tid),
            rules: tRules(t),
            champion: ref(t.champion_entry_id),
            createdAt: t.created_at, startedAt: t.started_at, finishedAt: t.finished_at
        },
        entries,
        series,
        standings,
        live: liveForTournament(tid)
    };
}

module.exports = {
    // pure
    nextPow2, seedOrder, separateGroups, roundRobinRounds, snakeGroups, computeStandings, decideSeries, normalizeConfig,
    // manager
    setIO, HttpError, createTournament, updateTournament, resetSeries, setSeriesResult, registerEntry, updateEntry, removeEntry, startTournament,
    run, pause, shutdown, deleteTournament, recoverOnBoot, listTournaments, getTournamentDetail,
    liveForTournament, liveGameCount
};
