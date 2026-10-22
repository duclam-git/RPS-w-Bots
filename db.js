// ===== OTTv2 Code Arena - SQLite Database =====
// Single-file embedded DB (better-sqlite3). No server to install; data lives in
// ./data/ott.db (override with DB_PATH, or DB_PATH=:memory: for tests).
//
// Tables
//   matches        one finished game (online / local / tournament)
//   match_moves    every ply of every game  -> replay
//   tournaments    a competition + its config
//   entries        a participant (bot) registered in a tournament
//   series         a pairing inside a tournament (best-of-N games);
//                  group-stage fixtures and knockout bracket nodes

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'ott.db');
if (DB_PATH !== ':memory:') {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const MIGRATIONS = [
    // v1
    `
    CREATE TABLE tournaments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        format        TEXT    NOT NULL,              -- single_elim | round_robin | groups_knockout
        status        TEXT    NOT NULL DEFAULT 'registration', -- registration | running | finished
        config_json   TEXT    NOT NULL DEFAULT '{}',
        champion_entry_id INTEGER,
        auto_run      INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        started_at    INTEGER,
        finished_at   INTEGER
    );

    CREATE TABLE entries (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        name          TEXT    NOT NULL,
        lang          TEXT    NOT NULL,
        code          TEXT    NOT NULL,
        edit_token    TEXT    NOT NULL,
        seed          INTEGER,
        group_no      INTEGER,
        created_at    INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_entries_name ON entries(tournament_id, name COLLATE NOCASE);

    CREATE TABLE series (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        stage         TEXT    NOT NULL,              -- group | bracket | third_place
        group_no      INTEGER,
        round         INTEGER NOT NULL,
        slot          INTEGER NOT NULL,
        best_of       INTEGER NOT NULL,
        entry_a       INTEGER REFERENCES entries(id) ON DELETE SET NULL,
        entry_b       INTEGER REFERENCES entries(id) ON DELETE SET NULL,
        wins_a        INTEGER NOT NULL DEFAULT 0,
        wins_b        INTEGER NOT NULL DEFAULT 0,
        draws         INTEGER NOT NULL DEFAULT 0,
        games_played  INTEGER NOT NULL DEFAULT 0,
        status        TEXT    NOT NULL DEFAULT 'pending', -- pending | ready | running | done | bye
        winner_entry  INTEGER REFERENCES entries(id) ON DELETE SET NULL,
        decided_by    TEXT,                           -- score | tiebreak | bye | tie
        win_next      INTEGER,                        -- series id the winner advances to
        win_next_slot TEXT,                           -- 'a' | 'b'
        lose_next     INTEGER,                        -- series id the loser drops to (3rd place)
        lose_next_slot TEXT
    );
    CREATE INDEX idx_series_t ON series(tournament_id, stage, round, slot);

    CREATE TABLE matches (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        kind          TEXT    NOT NULL,              -- online | local | tournament
        tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
        series_id     INTEGER REFERENCES series(id) ON DELETE CASCADE,
        game_no       INTEGER,
        blue_name     TEXT    NOT NULL,
        red_name      TEXT    NOT NULL,
        blue_lang     TEXT,
        red_lang      TEXT,
        blue_entry_id INTEGER,
        red_entry_id  INTEGER,
        winner        TEXT    NOT NULL,              -- blue | red | draw
        reason        TEXT,
        plies         INTEGER NOT NULL,
        rules_json    TEXT    NOT NULL,
        duration_ms   INTEGER,
        created_at    INTEGER NOT NULL
    );
    CREATE INDEX idx_matches_created ON matches(created_at DESC);
    CREATE INDEX idx_matches_kind    ON matches(kind, created_at DESC);
    CREATE INDEX idx_matches_t       ON matches(tournament_id);
    CREATE INDEX idx_matches_blue    ON matches(blue_name COLLATE NOCASE);
    CREATE INDEX idx_matches_red     ON matches(red_name COLLATE NOCASE);

    CREATE TABLE match_moves (
        match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        ply        INTEGER NOT NULL,
        player     INTEGER NOT NULL,
        from_r     INTEGER NOT NULL,
        from_c     INTEGER NOT NULL,
        to_r       INTEGER NOT NULL,
        to_c       INTEGER NOT NULL,
        piece      TEXT,
        capture    TEXT,
        elapsed_ms INTEGER,
        fallback   INTEGER NOT NULL DEFAULT 0,       -- 1 = bot failed, server picked a random legal move
        log        TEXT,
        PRIMARY KEY (match_id, ply)
    ) WITHOUT ROWID;
    `,
    // v2: user accounts, sessions, ownership of entries / matches
    `
    CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    NOT NULL,
        password_hash TEXT    NOT NULL,
        role          TEXT    NOT NULL DEFAULT 'user',      -- user | admin
        elo           INTEGER NOT NULL DEFAULT 1200,         -- online ladder (rated games between two accounts)
        matches       INTEGER NOT NULL DEFAULT 0,
        wins          INTEGER NOT NULL DEFAULT 0,
        losses        INTEGER NOT NULL DEFAULT 0,
        draws         INTEGER NOT NULL DEFAULT 0,
        preferred_lang TEXT,
        created_at    INTEGER NOT NULL,
        last_login_at INTEGER
    );
    CREATE UNIQUE INDEX idx_users_username ON users(username COLLATE NOCASE);

    CREATE TABLE sessions (
        token_hash TEXT    PRIMARY KEY,                     -- sha256 of the cookie value (a DB leak can't be replayed)
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        user_agent TEXT
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);

    ALTER TABLE entries ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    CREATE UNIQUE INDEX idx_entries_user ON entries(tournament_id, user_id) WHERE user_id IS NOT NULL;

    ALTER TABLE matches ADD COLUMN blue_user_id INTEGER;
    ALTER TABLE matches ADD COLUMN red_user_id  INTEGER;
    CREATE INDEX idx_matches_buser ON matches(blue_user_id);
    CREATE INDEX idx_matches_ruser ON matches(red_user_id);
    `,
    // v3: more than one game. Placement games (Caro) have no "from" square, so match_moves.from_* become nullable
    // (SQLite cannot drop NOT NULL in place: rebuild the table, keeping every existing row).
    `
    ALTER TABLE tournaments ADD COLUMN game TEXT NOT NULL DEFAULT 'rps';
    ALTER TABLE matches     ADD COLUMN game TEXT NOT NULL DEFAULT 'rps';
    CREATE INDEX idx_matches_game ON matches(game, created_at DESC);

    CREATE TABLE match_moves_v3 (
        match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        ply        INTEGER NOT NULL,
        player     INTEGER NOT NULL,
        from_r     INTEGER,
        from_c     INTEGER,
        to_r       INTEGER NOT NULL,
        to_c       INTEGER NOT NULL,
        piece      TEXT,
        capture    TEXT,
        elapsed_ms INTEGER,
        fallback   INTEGER NOT NULL DEFAULT 0,
        log        TEXT,
        PRIMARY KEY (match_id, ply)
    ) WITHOUT ROWID;
    INSERT INTO match_moves_v3 SELECT match_id, ply, player, from_r, from_c, to_r, to_c, piece, capture, elapsed_ms, fallback, log FROM match_moves;
    DROP TABLE match_moves;
    ALTER TABLE match_moves_v3 RENAME TO match_moves;
    `,
    // v4: admin login is two-step (password, then ADMIN_KEY). A session only carries admin rights when it was
    // opened through that second step. Sessions of existing admins predate it, so they are signed out once.
    `
    ALTER TABLE sessions ADD COLUMN admin_verified INTEGER NOT NULL DEFAULT 0;
    DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'admin');
    `
];

function migrate() {
    const current = db.pragma('user_version', { simple: true });
    for (let v = current; v < MIGRATIONS.length; v++) {
        db.transaction(() => {
            db.exec(MIGRATIONS[v]);
            db.pragma(`user_version = ${v + 1}`);
        })();
    }
}
migrate();

// ---------- Match history ----------

const WINNER_TEXT = { 1: 'blue', 2: 'red', draw: 'draw' };

const insertMatchStmt = db.prepare(`
    INSERT INTO matches (game, kind, tournament_id, series_id, game_no, blue_name, red_name, blue_lang, red_lang,
                         blue_entry_id, red_entry_id, blue_user_id, red_user_id,
                         winner, reason, plies, rules_json, duration_ms, created_at)
    VALUES (@game, @kind, @tournament_id, @series_id, @game_no, @blue_name, @red_name, @blue_lang, @red_lang,
            @blue_entry_id, @red_entry_id, @blue_user_id, @red_user_id,
            @winner, @reason, @plies, @rules_json, @duration_ms, @created_at)
`);
const insertMoveStmt = db.prepare(`
    INSERT INTO match_moves (match_id, ply, player, from_r, from_c, to_r, to_c, piece, capture, elapsed_ms, fallback, log)
    VALUES (@match_id, @ply, @player, @from_r, @from_c, @to_r, @to_c, @piece, @capture, @elapsed_ms, @fallback, @log)
`);

/**
 * Persist one finished game together with all its moves (single transaction).
 * @param {object} m   { kind, tournamentId, seriesId, gameNo, blue:{name,lang,entryId}, red:{...},
 *                       winner (1|2|'draw'), reason, rules, durationMs }
 * @param {Array}  moves [{ ply, player, from, to, pieceType, capture, elapsedMs, fallback, log }]
 * @returns {number} match id
 */
function saveMatch(m, moves) {
    return db.transaction(() => {
        const info = insertMatchStmt.run({
            game: m.game || 'rps',
            kind: m.kind,
            tournament_id: m.tournamentId || null,
            series_id: m.seriesId || null,
            game_no: m.gameNo || null,
            blue_name: m.blue.name,
            red_name: m.red.name,
            blue_lang: m.blue.lang || null,
            red_lang: m.red.lang || null,
            blue_entry_id: m.blue.entryId || null,
            red_entry_id: m.red.entryId || null,
            blue_user_id: m.blue.userId || null,
            red_user_id: m.red.userId || null,
            winner: WINNER_TEXT[m.winner] || 'draw',
            reason: m.reason || '',
            plies: moves.length,
            rules_json: JSON.stringify(m.rules),
            duration_ms: m.durationMs || null,
            created_at: Date.now()
        });
        const matchId = Number(info.lastInsertRowid);
        moves.forEach((mv, i) => {
            insertMoveStmt.run({
                match_id: matchId,
                ply: mv.ply || i + 1,
                player: mv.player,
                from_r: mv.from ? mv.from.r : null, from_c: mv.from ? mv.from.c : null,
                to_r: mv.to.r, to_c: mv.to.c,
                piece: mv.pieceType || null,
                capture: mv.capture || null,
                elapsed_ms: mv.elapsedMs == null ? null : Math.round(mv.elapsedMs),
                fallback: mv.fallback ? 1 : 0,
                log: mv.log ? String(mv.log).slice(0, 500) : null
            });
        });
        return matchId;
    })();
}

/**
 * Paginated, filterable history list (no moves).
 * filters: { kind, tournamentId, player, limit, offset }
 */
function listMatches(filters = {}) {
    const where = [];
    const params = {};
    if (filters.kind) { where.push('m.kind = @kind'); params.kind = filters.kind; }
    if (filters.game) { where.push('m.game = @game'); params.game = filters.game; }
    if (filters.tournamentId) { where.push('m.tournament_id = @tid'); params.tid = filters.tournamentId; }
    if (filters.seriesId) { where.push('m.series_id = @sid'); params.sid = filters.seriesId; }
    if (filters.userId) {
        where.push('(m.blue_user_id = @uid OR m.red_user_id = @uid)');
        params.uid = filters.userId;
    }
    if (filters.player) {
        where.push('(m.blue_name LIKE @p ESCAPE \'\\\' OR m.red_name LIKE @p ESCAPE \'\\\')');
        params.p = `%${String(filters.player).replace(/[\\%_]/g, '\\$&')}%`;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 30, 1), 200);
    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);

    const total = db.prepare(`SELECT COUNT(*) AS n FROM matches m ${clause}`).get(params).n;
    const rows = db.prepare(`
        SELECT m.id, m.game, m.kind, m.tournament_id AS tournamentId, t.name AS tournamentName, m.series_id AS seriesId,
               m.game_no AS gameNo, m.blue_name AS blueName, m.red_name AS redName,
               m.blue_lang AS blueLang, m.red_lang AS redLang,
               m.winner, m.reason, m.plies, m.duration_ms AS durationMs, m.created_at AS createdAt,
               bu.username AS blueUser, ru.username AS redUser
        FROM matches m LEFT JOIN tournaments t ON t.id = m.tournament_id
        LEFT JOIN users bu ON bu.id = m.blue_user_id
        LEFT JOIN users ru ON ru.id = m.red_user_id
        ${clause}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });
    return { total, rows };
}

/** One match with every move, ready for the replay viewer. */
function getMatch(id) {
    const m = db.prepare(`
        SELECT m.*, t.name AS tournament_name FROM matches m
        LEFT JOIN tournaments t ON t.id = m.tournament_id WHERE m.id = ?
    `).get(id);
    if (!m) return null;
    const moves = db.prepare(`
        SELECT ply, player, from_r AS fr, from_c AS fc, to_r AS tr, to_c AS tc,
               piece, capture, elapsed_ms AS elapsedMs, fallback, log
        FROM match_moves WHERE match_id = ? ORDER BY ply
    `).all(id).map(r => ({
        ply: r.ply, player: r.player,
        from: r.fr == null ? null : { r: r.fr, c: r.fc }, to: { r: r.tr, c: r.tc },
        pieceType: r.piece, capture: r.capture,
        elapsedMs: r.elapsedMs, fallback: !!r.fallback, log: r.log || ''
    }));
    return {
        id: m.id,
        game: m.game,
        kind: m.kind,
        tournamentId: m.tournament_id,
        tournamentName: m.tournament_name,
        seriesId: m.series_id,
        gameNo: m.game_no,
        blue: { name: m.blue_name, lang: m.blue_lang, userId: m.blue_user_id },
        red: { name: m.red_name, lang: m.red_lang, userId: m.red_user_id },
        winner: m.winner,
        reason: m.reason,
        plies: m.plies,
        durationMs: m.duration_ms,
        createdAt: m.created_at,
        rules: JSON.parse(m.rules_json),
        moves
    };
}

module.exports = { db, saveMatch, listMatches, getMatch, MIGRATIONS };
