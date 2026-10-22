// ===== OTTv2 Code Arena - Tournaments / History / Replay (vanilla JS SPA) =====
(function () {
    'use strict';

    // ---------- helpers ----------
    const $ = (sel, el = document) => el.querySelector(sel);
    const view = $('#view');
    const EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
    const DEFAULT_GOALS = { blue: { r: 0, c: 8 }, red: { r: 8, c: 0 } };
    const gameBadge = (id) => `<span class="badge game" title="${esc((GAMES[id] && GAMES[id].name) || id)}">${esc((GAMES[id] && GAMES[id].short) || id)}</span>`;
    const FORMAT_LABEL = {
        single_elim: 'Loại trực tiếp (nhánh đấu)',
        round_robin: 'Vòng tròn (một bảng)',
        groups_knockout: 'Chia bảng + loại trực tiếp'
    };
    const STATUS_LABEL = { registration: 'Đang mở đăng ký', running: 'Đang diễn ra', finished: 'Đã kết thúc' };
    const SERIES_STATUS = { pending: 'Chờ cặp đấu', ready: 'Sẵn sàng', running: 'Đang đấu', done: 'Đã xong', bye: 'Miễn đấu (bye)' };
    const DECIDED = { tiebreak: 'phân định theo seed', forfeit: 'xử thua (bot lỗi)', tie: 'hòa', bye: 'bye', admin: 'admin quyết định' };

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtTime = (ts) => new Date(ts).toLocaleString('vi-VN');
    const fmtDur = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    let toastTimer;
    function toast(msg, isErr) {
        const t = $('#toast');
        t.textContent = msg;
        t.className = 'toast show' + (isErr ? ' err' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.className = 'toast'; }, 3800);
    }

    // ---------- accounts & admin ----------
    // Logged-in state lives in an HttpOnly session cookie; the page only learns it through /api/auth/me.
    // Logging in (players and admins, admin = password + ADMIN_KEY) happens on login.html.
    let GAMES = {};         // id -> { id, name, short, description, botHint }  (from /api/games)
    let me = null;          // { id, username, role, elo, ... } or null
    let isAdmin = false;

    async function api(method, url, body, headers) {
        const h = { 'Content-Type': 'application/json', ...(headers || {}) };
        const res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(json.error || `Lỗi ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return json;
    }

    function renderAuthButtons() {
        const ub = $('#user-btn'), lo = $('#logout-btn');
        ub.textContent = me ? `${isAdmin ? '🛡' : '👤'} ${me.username}${isAdmin ? ' · admin' : ` · ${me.elo}`}` : '🔐 Đăng nhập';
        ub.title = me ? 'Xem hồ sơ của bạn' : 'Đăng nhập / Tạo tài khoản';
        lo.style.display = me ? '' : 'none';
        $('#nav-admin').style.display = isAdmin ? '' : 'none';
    }

    async function refreshMe() {
        try {
            const out = await api('GET', '/api/auth/me');
            me = out.user;
            isAdmin = !!out.isAdmin;
        } catch (e) { me = null; isAdmin = false; }
        renderAuthButtons();
    }

    // --- login lives on its own page; come back here afterwards ---
    function openAuth(mode) {
        const next = location.pathname + location.hash;
        location.href = `/login.html?next=${encodeURIComponent(next)}${mode === 'register' ? '&mode=register' : ''}`;
    }
    window.openAuthDialog = openAuth;

    $('#user-btn').addEventListener('click', () => { if (me) location.hash = `#/profile/${encodeURIComponent(me.username)}`; else openAuth('login'); });
    $('#logout-btn').addEventListener('click', async () => {
        try { await api('POST', '/api/auth/logout'); } catch (e) { }
        location.replace('/login.html');
    });

    // ---------- theme (shares the main page's key) ----------
    function applyTheme(t) {
        if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
        $('#theme-btn').textContent = t === 'dark' ? '☀️' : '🌙';
    }
    applyTheme(localStorage.getItem('ott_theme') || 'light');
    $('#theme-btn').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        localStorage.setItem('ott_theme', next);
        applyTheme(next);
    });

    // ---------- realtime ----------
    const socket = typeof io === 'function' ? io() : null;
    let watching = null;
    const socketHandlers = {};
    function onSocket(ev, fn) {
        if (!socket) return;
        socketHandlers[ev] = fn;
    }
    if (socket) {
        ['live_snapshot', 'live_game_start', 'live_game_move', 'live_game_end', 'tournament_updated', 'tournament_list_changed']
            .forEach(ev => socket.on(ev, (p) => { if (socketHandlers[ev]) socketHandlers[ev](p); }));
        socket.on('connect', () => { if (watching) socket.emit('watch_tournament', watching); });
        // logged out elsewhere / password reset / role changed: the server closed this socket
        socket.on('session_revoked', () => { refreshMe().then(route); toast('Phiên đăng nhập đã kết thúc', true); setTimeout(() => socket.connect(), 500); });
    }

    // ---------- board rendering ----------
    function boardHTML(board, opts = {}) {
        const size = opts.size || 'md';
        const goals = 'goals' in opts ? opts.goals : DEFAULT_GOALS;      // null = a game without goal squares
        const last = opts.last || null;
        const rows = board.length;
        const cols = board[0].length;
        let cells = '';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const p = board[r][c];
                let cls = 'c ' + ((r + c) % 2 ? 'd' : 'l');
                if (goals && goals.blue.r === r && goals.blue.c === c) cls += ' gb';
                if (goals && goals.red.r === r && goals.red.c === c) cls += ' gr';
                if (last) {
                    if (last.from && last.from.r === r && last.from.c === c) cls += ' from';    // placement games have no 'from'
                    if (last.to.r === r && last.to.c === c) cls += ' to' + (last.capture ? ' cap' : '');
                }
                cells += `<div class="${cls}" data-r="${r}" data-c="${c}">${p ? (p.type === 'stone' ? `<span class="pc stone p${p.player}"></span>` : `<span class="pc p${p.player}">${EMOJI[p.type] || '?'}</span>`) : ''}</div>`;
            }
        }
        let ranks = '';
        for (let r = 0; r < rows; r++) ranks += `<span>${rows - r}</span>`;
        let files = '';
        for (let c = 0; c < cols; c++) files += `<span>${String.fromCharCode(65 + c)}</span>`;
        const axes = opts.axes !== false && size !== 'sm';
        // cells shrink as the board grows (15x15 Caro, 19x19...) and on narrow screens
        const base = { lg: 54, md: 46, sm: 26 }[size] || 46;
        const room = { lg: 640, md: 560, sm: 270 }[size] || 560;
        const cell = Math.max(14, Math.min(base, Math.floor(room / cols)));
        return `<div class="bd-wrap ${size}" style="--cols:${cols};--cell:min(${cell}px, calc((100vw - 5rem) / ${cols}))">
            <div class="bd-row">${axes ? `<div class="rank-axis">${ranks}</div>` : ''}<div class="bd">${cells}</div></div>
            ${axes ? `<div class="axis">${files}</div>` : ''}</div>`;
    }

    const cloneBoard = (b) => b.map(row => row.map(x => (x ? { player: x.player, type: x.type } : null)));
    // Games where pieces move have m.from; placement games (Caro) put a new stone on m.to
    function applyMoveTo(board, m) {
        if (m.from) { board[m.to.r][m.to.c] = board[m.from.r][m.from.c]; board[m.from.r][m.from.c] = null; }
        else board[m.to.r][m.to.c] = { player: m.player, type: 'stone' };
    }
    const notation = (p, rows = 9) => `${String.fromCharCode(65 + p.c)}${rows - p.r}`;

    // ---------- router ----------
    let cleanup = null;
    function setNav(name) {
        document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
    }

    async function route() {
        if (cleanup) { try { cleanup(); } catch (e) { } cleanup = null; }
        if (watching && socket) { socket.emit('unwatch_tournament', watching); watching = null; }
        Object.keys(socketHandlers).forEach(k => delete socketHandlers[k]);

        const parts = (location.hash.replace(/^#\/?/, '') || 'tournaments').split('/');
        try {
            if (parts[0] === 'tournament' && parts[1]) { setNav('tournaments'); await viewTournament(+parts[1]); }
            else if (parts[0] === 'matches') { setNav('matches'); await viewMatches(); }
            else if (parts[0] === 'admin' && parts[1] === 'edit' && parts[2]) { setNav('admin'); await viewTournamentEditor(parts[2]); }
            else if (parts[0] === 'admin') { setNav('admin'); await viewAdmin(); }
            else if (parts[0] === 'login') { if (!me) return openAuth('login'); location.hash = '#/tournaments'; }
            else if (parts[0] === 'leaderboard') { setNav('leaderboard'); await viewLeaderboard(); }
            else if (parts[0] === 'profile' && parts[1]) { setNav(me && me.username.toLowerCase() === decodeURIComponent(parts[1]).toLowerCase() ? 'profile' : 'leaderboard'); await viewProfile(decodeURIComponent(parts[1])); }
            else if (parts[0] === 'match' && parts[1]) { setNav('matches'); await viewMatch(+parts[1]); }
            else { setNav('tournaments'); await viewTournamentList(); }
        } catch (e) {
            view.innerHTML = `<div class="card empty">⚠️ ${esc(e.message)}<br><br><a href="#/tournaments">← Về danh sách giải đấu</a></div>`;
        }
    }
    window.addEventListener('hashchange', route);

    // =====================================================================
    // Tournament list + create (admin)
    // =====================================================================
    async function viewTournamentList() {
        view.innerHTML = '<div class="empty">Đang tải…</div>';
        const draw = async () => {
            const list = await api('GET', '/api/tournaments');
            view.innerHTML = `
                <div class="row between" style="margin-bottom:1rem"><h1>🏆 Giải đấu</h1>
                    ${isAdmin ? '<a class="btn btn-primary" href="#/admin/edit/new" style="text-decoration:none">➕ Tạo giải đấu</a>' : ''}</div>
                ${list.length ? `<div class="t-list">${list.map(t => `
                    <a class="t-item" href="#/tournament/${t.id}">
                        <div class="row between"><h3>${esc(t.name)}</h3><span class="badge ${t.status}">${STATUS_LABEL[t.status]}</span></div>
                        <div class="muted small">${gameBadge(t.game)} ${FORMAT_LABEL[t.format] || t.format}</div>
                        <div class="small" style="margin-top:.4rem">👥 ${t.entryCount} bot${t.champion ? ` · 🥇 <strong>${esc(t.champion)}</strong>` : ''}</div>
                        <div class="muted small">${fmtTime(t.createdAt)}</div>
                    </a>`).join('')}</div>`
                    : `<div class="card empty">Chưa có giải đấu nào.${isAdmin ? '' : '<br>Đăng nhập bằng tài khoản admin để tạo giải đấu mới.'}</div>`}`;
        };
        await draw();
        onSocket('tournament_list_changed', debounce(() => draw().catch(() => { }), 400));
    }

    // =====================================================================
    // Tournament detail
    // =====================================================================
    function roundName(round, total) {
        if (round === total) return 'Chung kết';
        if (round === total - 1) return 'Bán kết';
        if (round === total - 2) return 'Tứ kết';
        return `Vòng ${round}`;
    }

    // Admin tools on a pairing (only while the tournament is paused): decide by hand / play it again
    let currentTournament = null;
    function seriesAdminHTML(s) {
        const t = currentTournament;
        if (!isAdmin || !t || t.status === 'registration' || t.running || s.status === 'bye' || s.status === 'running') return '';
        const b = [];
        if (s.status === 'ready' && s.a && s.b) {
            b.push(`<button data-act="series-result" data-sid="${s.id}" data-winner="a" title="Xử đội trên thắng">⚑ ${esc(s.a.name)} thắng</button>`);
            b.push(`<button data-act="series-result" data-sid="${s.id}" data-winner="b" title="Xử đội dưới thắng">⚑ ${esc(s.b.name)} thắng</button>`);
            if (s.stage === 'group') b.push(`<button data-act="series-result" data-sid="${s.id}" data-winner="tie">⚑ Hòa</button>`);
        }
        if (s.gamesPlayed > 0 || s.status === 'done') b.push(`<button class="danger" data-act="series-reset" data-sid="${s.id}">↺ Đấu lại</button>`);
        return b.length ? `<div class="sc-admin">${b.join('')}</div>` : '';
    }

    function seriesCardHTML(s) {
        const decided = (s.status === 'done' || s.status === 'bye') && s.winnerEntry;
        const row = (side, wins) => {
            const e = s[side];
            const isWin = decided && e && s.winnerEntry === e.id;
            const isLose = decided && e && !isWin;
            return `<div class="sc-row ${isWin ? 'win' : ''}${isLose ? ' lose' : ''}" data-side="${side}">
                <span class="seed">${e && e.seed ? e.seed : ''}</span>
                <span class="nm ${e ? '' : 'tbd'}">${isWin ? '<span class="adv" title="Đi tiếp">▶</span> ' : ''}${e ? esc(e.name) : (s.status === 'bye' ? '—' : 'Chờ kết quả')}</span>
                <span class="sc-score">${s.gamesPlayed || s.status === 'done' ? wins : ''}</span></div>`;
        };
        const games = s.matches.map(m => `<a href="#/match/${m.id}" title="${esc(m.blueName)} vs ${esc(m.redName)}">V${m.gameNo}</a>`).join(' ');
        const status = s.status === 'done' && s.decidedBy && s.decidedBy !== 'score' ? `${SERIES_STATUS.done} (${DECIDED[s.decidedBy] || s.decidedBy})` : SERIES_STATUS[s.status];
        const winSide = decided ? (s.a && s.winnerEntry === s.a.id ? 'a' : 'b') : '';
        return `<div class="sc ${s.status}" data-sid="${s.id}" data-round="${s.round}" data-slot="${s.slot}" data-win="${winSide}">${row('a', s.winsA)}${row('b', s.winsB)}
            <div class="sc-foot"><span>BO${s.bestOf} · ${status}</span>${s.draws ? `<span>(${s.draws} hòa)</span>` : ''}${games}</div>${seriesAdminHTML(s)}</div>`;
    }

    function bracketHTML(series, format) {
        const ko = series.filter(s => s.stage === 'bracket');
        if (!ko.length) return '';
        const total = Math.max(...ko.map(s => s.round));
        const rounds = [];
        for (let r = 1; r <= total; r++) rounds.push(ko.filter(s => s.round === r).sort((a, b) => a.slot - b.slot));
        const third = series.find(s => s.stage === 'third_place');
        const final = rounds[total - 1][0];
        const champ = final && final.winnerEntry ? [final.a, final.b].find(e => e && e.id === final.winnerEntry) : null;
        return `<div class="card"><div class="row between"><h2>${format === 'round_robin' ? '⚔️ Playoff tranh ngôi đầu (bảng xếp hạng đồng hạng hoàn toàn)' : '🏆 Nhánh đấu'}</h2>
            <div class="b-legend small"><span><i class="lg win"></i>Thắng, đi tiếp</span><span><i class="lg run"></i>Đang đấu</span><span><i class="lg wait"></i>Chưa đấu</span><span><i class="lg out"></i>Bị loại</span></div></div>
            <div class="bracket">
            ${rounds.map((list, i) => `<div class="b-round"><div class="b-title">${roundName(i + 1, total)}</div>${list.map(seriesCardHTML).join('')}</div>`).join('')}
            <div class="b-round b-champ-col"><div class="b-title">Vô địch</div>
                <div class="b-champ ${champ ? 'won' : ''}" data-champ="1">🏆 ${champ ? esc(champ.name) : '<span class="muted">Chưa xác định</span>'}</div></div>
            <svg class="b-lines" aria-hidden="true"></svg>
            </div>${third ? `<h3 style="margin-top:.6rem">🥉 Tranh hạng 3</h3><div style="max-width:260px">${seriesCardHTML(third)}</div>` : ''}</div>`;
    }

    // Connector lines of the knockout tree: each pairing feeds the next round (slot s -> slot floor(s/2)).
    // The line starts at the WINNER's row once a pairing is decided, so you can follow who went through.
    let bracketObserver = null;
    function drawBracketLines(root) {
        if (bracketObserver) { bracketObserver.disconnect(); bracketObserver = null; }
        const br = root.querySelector('.bracket');
        if (!br) return;
        const svg = br.querySelector('.b-lines');
        const draw = () => {
            const base = br.getBoundingClientRect();
            const pos = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - base.left + br.scrollLeft, r: r.right - base.left + br.scrollLeft, t: r.top - base.top + br.scrollTop, h: r.height }; };
            const cards = new Map();
            br.querySelectorAll('.sc[data-round]').forEach(el => cards.set(`${el.dataset.round}:${el.dataset.slot}`, el));
            const rounds = Math.max(0, ...[...cards.keys()].map(k => +k.split(':')[0]));
            const paths = [];
            const link = (from, to, cls) => {
                const a = pos(from);
                const winRow = from.dataset.win ? from.querySelector(`.sc-row[data-side="${from.dataset.win}"]`) : null;
                const y1 = winRow ? pos(winRow).t + pos(winRow).h / 2 : a.t + a.h / 2;
                const b = pos(to);
                const y2 = b.t + b.h / 2;
                const x1 = a.r, x2 = b.l, xm = x1 + (x2 - x1) / 2;
                paths.push(`<path class="${cls}" d="M${x1} ${y1} H${xm} V${y2} H${x2}"/>`);
                if (cls === 'win') paths.push(`<circle class="win" cx="${x1}" cy="${y1}" r="3.5"/>`);
            };
            cards.forEach((el, key) => {
                const [r, slot] = key.split(':').map(Number);
                const st = el.classList.contains('running') ? 'run' : el.dataset.win ? 'win' : 'wait';
                const target = r < rounds ? cards.get(`${r + 1}:${Math.floor(slot / 2)}`) : br.querySelector('[data-champ]');
                if (target) link(el, target, st);
            });
            const w = Math.max(br.scrollWidth, br.clientWidth), h = Math.max(br.scrollHeight, br.clientHeight);
            svg.setAttribute('width', w); svg.setAttribute('height', h);
            svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
            // winners last so their lines are drawn on top where paths share a segment
            svg.innerHTML = paths.sort((p, q) => (p.includes('class="win"') ? 1 : 0) - (q.includes('class="win"') ? 1 : 0)).join('');
        };
        draw();
        if (typeof ResizeObserver === 'function') { bracketObserver = new ResizeObserver(() => draw()); bracketObserver.observe(br); }
    }

    function groupsHTML(d) {
        const t = d.tournament;
        if (t.format === 'single_elim') return '';
        const advance = t.format === 'groups_knockout' ? t.config.advance : 0;
        const groupNos = Object.keys(d.standings).map(Number).sort((a, b) => a - b);
        const multi = t.format === 'groups_knockout';
        const gs = d.series.filter(s => s.stage === 'group');
        if (!groupNos.length || (t.status === 'registration')) return '';
        return `<div class="grid-2">${groupNos.map(g => {
            const rows = d.standings[g];
            const fixtures = gs.filter(s => s.groupNo === g).sort((a, b) => a.round - b.round || a.slot - b.slot);
            return `<div class="card"><h2>${multi ? `Bảng ${String.fromCharCode(65 + g)}` : '📊 Bảng xếp hạng'}</h2>
                <div class="table-wrap"><table><thead><tr><th>#</th><th>Bot</th><th class="num" title="Số cặp đã đấu">Tr</th><th class="num">T</th><th class="num">H</th><th class="num">B</th><th class="num" title="Hiệu số ván">HS</th><th class="num">Đ</th></tr></thead><tbody>
                ${rows.map(r => `<tr class="${r.rank <= advance ? 'advance' : ''}"><td>${r.rank}</td><td><strong>${esc(r.name)}</strong></td>
                    <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.tied}</td><td class="num">${r.lost}</td>
                    <td class="num">${r.gameDiff > 0 ? '+' : ''}${r.gameDiff}</td><td class="num"><strong>${r.points}</strong></td></tr>`).join('')}
                </tbody></table></div>
                <p class="muted small" style="margin:.4rem 0">Thắng cặp = 3đ · hòa = 1đ · xếp theo điểm → hiệu số ván → số ván thắng → đối đầu trực tiếp → seed</p>
                <details><summary class="small"><strong>Lịch thi đấu (${fixtures.length} cặp)</strong></summary>
                ${fixtures.map(s => `<div class="small" style="padding:.25rem 0;border-bottom:1px solid var(--line)">
                    <span class="muted">V${s.round}</span> ${s.a ? esc(s.a.name) : '?'} <strong class="mono">${s.gamesPlayed ? `${s.winsA}–${s.winsB}` : 'vs'}</strong> ${s.b ? esc(s.b.name) : '?'}
                    <span class="badge ${s.status === 'done' ? 'finished' : s.status === 'running' ? 'running' : ''}">${SERIES_STATUS[s.status]}</span>
                    ${s.matches.map(m => `<a href="#/match/${m.id}">V${m.gameNo}</a>`).join(' ')}${seriesAdminHTML(s)}</div>`).join('')}</details></div>`;
        }).join('')}</div>`;
    }

    function myEntries(tid) {
        try { return JSON.parse(localStorage.getItem(`ott_my_entries_${tid}`) || '[]'); } catch (e) { return []; }
    }
    function saveMyEntry(tid, entry) {
        const list = myEntries(tid).filter(e => e.id !== entry.id);
        list.push(entry);
        localStorage.setItem(`ott_my_entries_${tid}`, JSON.stringify(list));
    }

    async function viewTournament(tid) {
        view.innerHTML = `<div id="t-top"></div><div id="t-reg"></div><div id="t-live"></div><div id="t-body"></div>`;
        const top = $('#t-top'), reg = $('#t-reg'), liveEl = $('#t-live'), body = $('#t-body');
        let data = null;
        const live = new Map();
        let regRendered = false;

        const loadAll = async () => { data = await api('GET', `/api/tournaments/${tid}`); drawStatic(); };
        const reload = debounce(() => loadAll().catch(() => { }), 300);

        function drawStatic() {
            const t = data.tournament;
            currentTournament = t;
            const canRun = isAdmin && t.status === 'running';
            top.innerHTML = `
                <div class="row between" style="margin-bottom:.8rem">
                    <div><a href="#/tournaments" class="small">← Tất cả giải đấu</a>
                        <h1>${esc(t.name)}</h1>
                        <div class="muted small">${gameBadge(t.game.id)} ${esc(t.game.name)} · ${FORMAT_LABEL[t.format] || t.format} · ${data.entries.length} bot
                        ${t.format !== 'round_robin' && t.format !== 'single_elim' ? ` · ${t.config.groupCount} bảng, đi tiếp ${t.config.advance}` : ''}
                        · KO BO${t.config.bestOf} · hòa sau ${t.rules.maxPlies} nước · ${t.rules.moveTimeoutMs}ms/nước${t.rules.timeBankMs ? ` · tổng ${Math.round(t.rules.timeBankMs / 1000)}s/bên` : ''}${t.game.id === 'rps' && t.config.rules.setup ? ' · thế cờ tùy chỉnh' : ''}${t.game.id === 'rps' && t.rules.rows !== 9 ? ` · bàn ${t.rules.rows}×${t.rules.cols}` : ''}${t.game.id === 'caro' ? ` · bàn ${t.rules.rows}×${t.rules.cols}, ${t.rules.winLength} quân thắng` : ''}</div></div>
                    <span class="badge ${t.status}">${t.running ? '⚡ ' : ''}${STATUS_LABEL[t.status]}</span>
                </div>
                ${t.champion ? `<div class="champion">🥇 Vô địch: ${esc(t.champion.name)}</div>` : ''}
                ${isAdmin ? `<div class="card"><h3>🛠 Quản trị</h3><div class="row">
                    ${t.status === 'registration' ? `
                        <label>Cách xếp seed<select id="a-seeding"><option value="rating">Theo Elo (mạnh nhất = seed 1)</option><option value="registration">Theo thứ tự đăng ký</option><option value="random">Ngẫu nhiên</option></select></label>
                        <button class="btn btn-primary" data-act="start">▶ Chốt danh sách & bắt đầu</button>` : ''}
                    ${canRun ? `
                        <button class="btn btn-primary" data-act="run-all" ${t.running ? 'disabled' : ''}>⚡ Chạy toàn bộ giải</button>
                        <button class="btn" data-act="run-next" ${t.running ? 'disabled' : ''}>⏭ Chạy 1 cặp tiếp theo</button>
                        <button class="btn btn-gold" data-act="pause" ${t.running ? '' : 'disabled'}>⏸ Tạm dừng</button>` : ''}
                    <a class="btn" href="#/admin/edit/${t.id}" style="text-decoration:none">✏️ Sửa giải</a>
                    <button class="btn btn-danger" data-act="delete" style="margin-left:auto">🗑 Xóa giải</button></div></div>` : ''}`;

            // registration form is rendered once and then left alone (so typing is never lost)
            if (t.status === 'registration' && !regRendered) { drawRegistration(); regRendered = true; }
            // someone else (or an admin) may have removed MY entry: refresh the form without eating what I typed
            else if (t.status === 'registration' && me && !!data.entries.find(e => e.userId === me.id) !== !!$('#r-withdraw')) { drawRegistration(); }
            if (t.status !== 'registration' && regRendered) { reg.innerHTML = ''; regRendered = false; }

            const entriesCard = `<div class="card"><h2>👥 Danh sách bot (${data.entries.length})</h2>
                ${data.entries.length ? `<div class="table-wrap"><table><thead><tr><th>Seed</th><th>Tên</th><th>Elo</th><th>Ngôn ngữ</th>${t.format === 'groups_knockout' ? '<th>Bảng</th>' : ''}${isAdmin && t.status === 'registration' ? '<th></th>' : ''}</tr></thead><tbody>
                ${data.entries.map(e => `<tr><td>${e.seed || '—'}</td><td>${e.username ? `<a href="#/profile/${encodeURIComponent(e.username)}"><strong>${esc(e.name)}</strong></a>` : `<strong>${esc(e.name)}</strong> <span class="muted small">(khách)</span>`}</td><td>${e.elo != null ? e.elo : '—'}</td><td>${esc(e.lang)}</td>
                    ${t.format === 'groups_knockout' ? `<td>${e.groupNo == null ? '—' : String.fromCharCode(65 + e.groupNo)}</td>` : ''}
                    ${isAdmin && t.status === 'registration' ? `<td><button class="btn btn-sm btn-danger" data-act="remove" data-eid="${e.id}">✖</button></td>` : ''}</tr>`).join('')}
                </tbody></table></div>` : '<p class="muted">Chưa có ai đăng ký.</p>'}</div>`;

            body.innerHTML = (t.status === 'registration' ? entriesCard : '') + groupsHTML(data) + bracketHTML(data.series, data.tournament.format) + (t.status !== 'registration' ? entriesCard : '');
            drawBracketLines(body);
            drawLive();
        }

        function drawRegistration() {
            const t = data.tournament;
            const requireLogin = t.config.requireLogin !== false;

            // Account required but the visitor is not logged in
            if (requireLogin && !me) {
                reg.innerHTML = `<div class="card"><h2>📝 Đăng ký tham gia</h2>
                    <p class="muted" style="margin-bottom:.6rem">Giải đấu này yêu cầu tài khoản: bot của bạn thi đấu dưới tên tài khoản, kết quả được lưu vào hồ sơ và Elo dùng để xếp seed.</p>
                    <button class="btn btn-primary" id="r-login">🔐 Đăng nhập / Tạo tài khoản</button></div>`;
                $('#r-login').addEventListener('click', () => window.openAuthDialog('login'));
                return;
            }

            const mine = me ? data.entries.find(e => e.userId === me.id) : null;     // my account's entry
            const legacy = !me ? myEntries(tid) : [];                                // anonymous tournaments only
            const updating = !!mine;

            reg.innerHTML = `<div class="card"><h2>📝 ${updating ? 'Bot của bạn trong giải' : 'Đăng ký tham gia'}</h2>
                <p class="muted small" style="margin-bottom:.6rem">Trò chơi: <strong>${esc(t.game.name)}</strong>. Nộp bot (JavaScript / Python / C++): ${esc(t.game.botHint || '')} Server biên dịch và chạy thử bot trước khi nhận.
                Bạn có thể sửa code đến khi admin chốt danh sách.</p>
                <div class="form-grid">
                    <label>Tên thi đấu<input id="r-name" maxlength="40" ${me ? `value="${esc(me.username)}" disabled` : 'placeholder="VD: Nguyễn Văn A"'}></label>
                    <label>Ngôn ngữ<select id="r-lang"><option value="javascript">JavaScript</option><option value="python">Python 3</option><option value="cpp">C++17</option></select></label>
                    ${legacy.length ? `<label>Chế độ<select id="r-mode"><option value="new">➕ Đăng ký bot mới</option>${legacy.map(m => `<option value="${m.id}">✏️ Cập nhật: ${esc(m.name)}</option>`).join('')}</select></label>` : ''}
                </div>
                <textarea id="r-code" spellcheck="false" placeholder="${updating ? 'Dán code mới để thay thế bot hiện tại…' : 'Dán code bot vào đây…'}"></textarea>
                <div class="row" style="margin-top:.6rem">
                    <button class="btn btn-primary" id="r-submit">${updating ? '💾 Cập nhật code' : '📤 Nộp bot'}</button>
                    <button class="btn" id="r-template">📄 Chèn code mẫu</button>
                    ${updating ? '<button class="btn btn-danger" id="r-withdraw">↩ Rút khỏi giải</button>' : ''}
                    <label class="inline"><span class="small">hoặc tải file:</span><input type="file" id="r-file" accept=".js,.py,.cpp,.cc,.txt"></label>
                    <span id="r-msg" class="small"></span>
                </div></div>`;

            const langFromName = (n) => /\.py$/i.test(n) ? 'python' : /\.(cpp|cc)$/i.test(n) ? 'cpp' : 'javascript';
            if (updating) $('#r-lang').value = mine.lang;
            $('#r-template').addEventListener('click', () => {
                const tpl = ((window.GAME_TEMPLATES || {})[data.tournament.game.id] || {})[$('#r-lang').value];
                if (!tpl) return toast('Không có code mẫu', true);
                $('#r-code').value = tpl.blue || tpl.red || '';
            });
            $('#r-file').addEventListener('change', async (ev) => {
                const f = ev.target.files[0];
                if (!f) return;
                $('#r-code').value = await f.text();
                $('#r-lang').value = langFromName(f.name);
            });
            const modeEl = $('#r-mode');
            if (modeEl) modeEl.addEventListener('change', () => {
                const m = legacy.find(x => String(x.id) === modeEl.value);
                $('#r-name').value = m ? m.name : '';
                $('#r-name').disabled = !!m;
            });
            const wd = $('#r-withdraw');
            if (wd) wd.addEventListener('click', async () => {
                if (!confirm('Rút bot của bạn khỏi giải đấu này?')) return;
                try { await api('DELETE', `/api/tournaments/${tid}/entries/${mine.id}`); toast('Đã rút khỏi giải'); await loadAll(); drawRegistration(); }
                catch (e) { toast(e.message, true); }
            });
            $('#r-submit').addEventListener('click', async () => {
                const btn = $('#r-submit'), msg = $('#r-msg');
                btn.disabled = true; msg.textContent = '⏳ Đang biên dịch & chạy thử…';
                try {
                    const payload = { name: $('#r-name').value, lang: $('#r-lang').value, code: $('#r-code').value };
                    const mode = modeEl ? modeEl.value : 'new';
                    if (updating) {
                        await api('PUT', `/api/tournaments/${tid}/entries/${mine.id}`, payload);
                    } else if (mode !== 'new') {
                        const m = legacy.find(x => String(x.id) === mode);
                        await api('PUT', `/api/tournaments/${tid}/entries/${m.id}`, payload, { 'X-Entry-Token': m.token });
                    } else {
                        const out = await api('POST', `/api/tournaments/${tid}/entries`, payload);
                        if (out.editToken) saveMyEntry(tid, { id: out.id, name: out.name, token: out.editToken });
                    }
                    toast(updating || mode !== 'new' ? 'Đã cập nhật code' : 'Đã nhận bot của bạn');
                    await loadAll();
                    drawRegistration();
                    const m2 = $('#r-msg'); if (m2) m2.textContent = '✅ Thành công!';
                } catch (e) {
                    msg.textContent = '❌ ' + e.message;
                    toast(e.message, true);
                } finally {
                    const b = $('#r-submit'); if (b) b.disabled = false;
                }
            });
        }

        // ---- live games ----
        function drawLive() {
            if (!live.size) { liveEl.innerHTML = ''; return; }
            liveEl.innerHTML = `<div class="card"><h2><span class="live-dot"></span>Đang thi đấu trực tiếp</h2><div class="live-grid">
                ${[...live.values()].map(g => `<div class="live-card">
                    <div class="vs-title"><span class="player-tag blue">${esc(g.blue.name)}</span> vs <span class="player-tag red">${esc(g.red.name)}</span></div>
                    <div class="muted small" style="margin:.2rem 0">Ván ${g.gameNo} · nước ${g.ply}${g.ended ? ' · ' + g.ended : ''}</div>
                    ${boardHTML(g.board, { size: 'sm', last: g.last, goals: data.tournament.rules.blueGoal ? { blue: data.tournament.rules.blueGoal, red: data.tournament.rules.redGoal } : null })}</div>`).join('')}</div></div>`;
        }
        const mkLive = (g) => {
            const board = cloneBoard(g.board);
            let last = null, ply = 0;
            (g.moves || []).forEach(m => { last = m; ply = m.ply; applyMoveTo(board, m); });
            return { liveId: g.liveId, gameNo: g.gameNo, blue: g.blue, red: g.red, board, last, ply, ended: '' };
        };

        onSocket('live_snapshot', (p) => {
            if (p.tournamentId !== tid) return;
            live.clear();
            p.games.forEach(g => live.set(g.liveId, mkLive(g)));
            drawLive();
        });
        onSocket('live_game_start', (g) => { live.set(g.liveId, mkLive({ ...g, moves: [] })); drawLive(); });
        onSocket('live_game_move', ({ liveId, move }) => {
            const g = live.get(liveId);
            if (!g || move.ply <= g.ply) return;
            applyMoveTo(g.board, move); g.last = move; g.ply = move.ply;
            drawLive();
        });
        onSocket('live_game_end', ({ liveId, winner, aborted }) => {
            const g = live.get(liveId);
            if (g) {
                g.ended = aborted ? 'đã tạm dừng' : winner === 'draw' ? 'hòa' : `${winner === 'blue' ? g.blue.name : g.red.name} thắng`;
                drawLive();
                setTimeout(() => { live.delete(liveId); drawLive(); }, 2500);
            }
            reload();
        });
        onSocket('tournament_updated', (p) => { if (p.id === tid) reload(); });

        // ---- admin actions (event delegation) ----
        top.addEventListener('click', onAdmin);
        body.addEventListener('click', onAdmin);
        async function onAdmin(ev) {
            const btn = ev.target.closest('[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            try {
                if (act === 'start') {
                    if (!confirm('Chốt danh sách và bắt đầu giải? Sau đó không thể thêm/sửa bot.')) return;
                    await api('POST', `/api/tournaments/${tid}/start`, { seeding: $('#a-seeding').value });
                    toast('Đã bắt đầu giải đấu');
                } else if (act === 'run-all') { await api('POST', `/api/tournaments/${tid}/run`, { mode: 'all' }); toast('Đang chạy giải…'); }
                else if (act === 'run-next') { await api('POST', `/api/tournaments/${tid}/run`, { mode: 'next' }); }
                else if (act === 'pause') { await api('POST', `/api/tournaments/${tid}/pause`); toast('Sẽ dừng sau khi hủy các ván đang chạy'); }
                else if (act === 'series-result') {
                    const w = btn.dataset.winner;
                    if (!confirm(w === 'tie' ? 'Xử cặp này HÒA?' : 'Xử thắng cho đội này theo quyết định của admin?')) return;
                    await api('POST', `/api/tournaments/${tid}/series/${btn.dataset.sid}/result`, { winner: w });
                    toast('Đã ghi kết quả');
                } else if (act === 'series-reset') {
                    if (!confirm('Xóa toàn bộ các ván của cặp này và đấu lại?')) return;
                    await api('POST', `/api/tournaments/${tid}/series/${btn.dataset.sid}/reset`);
                    toast('Đã đặt lại cặp đấu — bấm "Chạy" để đấu lại');
                }
                else if (act === 'remove') { await api('DELETE', `/api/tournaments/${tid}/entries/${btn.dataset.eid}`); }
                else if (act === 'delete') {
                    if (!confirm('Xóa vĩnh viễn giải đấu này cùng toàn bộ lịch sử các trận?')) return;
                    await api('DELETE', `/api/tournaments/${tid}`);
                    location.hash = '#/tournaments';
                    return;
                }
                await loadAll();
            } catch (e) { toast(e.message, true); }
        }

        await loadAll();
        if (socket) { watching = tid; socket.emit('watch_tournament', tid); }
        cleanup = () => {
            top.removeEventListener('click', onAdmin); body.removeEventListener('click', onAdmin);
            if (bracketObserver) { bracketObserver.disconnect(); bracketObserver = null; }
        };
    }

    // =====================================================================
    // Match history
    // =====================================================================
    const hist = { kind: '', game: '', player: '', mine: false, offset: 0, limit: 25 };
    const KIND_LABEL = { online: 'Online', local: 'Luyện tập', tournament: 'Giải đấu' };

    async function viewMatches() {
        view.innerHTML = `<div class="row between" style="margin-bottom:1rem"><h1>📜 Lịch sử trận đấu</h1></div>
            <div class="card"><div class="row">
                <label>Loại trận<select id="h-kind"><option value="">Tất cả</option><option value="tournament">Giải đấu</option><option value="online">Online</option><option value="local">Luyện tập</option></select></label>
                <label>Trò chơi<select id="h-game"><option value="">Tất cả</option>${Object.values(GAMES).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label>
                <label>Tìm người chơi<input id="h-player" placeholder="Tên…" value="${esc(hist.player)}"></label>
                ${me ? `<label class="inline"><input type="checkbox" id="h-mine" ${hist.mine ? 'checked' : ''}> Chỉ trận của tôi</label>` : ''}
            </div></div><div id="h-list"></div>`;
        $('#h-kind').value = hist.kind;
        $('#h-game').value = hist.game;
        const draw = async () => {
            const qs = new URLSearchParams({ limit: hist.limit, offset: hist.offset });
            if (hist.kind) qs.set('kind', hist.kind);
            if (hist.game) qs.set('game', hist.game);
            if (hist.player) qs.set('player', hist.player);
            if (hist.mine && me) qs.set('mine', '1');
            const { total, rows } = await api('GET', `/api/matches?${qs}`);
            const pages = Math.max(1, Math.ceil(total / hist.limit));
            const page = Math.floor(hist.offset / hist.limit) + 1;
            $('#h-list').innerHTML = rows.length ? `<div class="card table-wrap"><table><thead><tr><th>Thời gian</th><th>Loại</th><th>Xanh</th><th>Đỏ</th><th>Kết quả</th><th class="num">Nước</th><th></th></tr></thead><tbody>
                ${rows.map(m => `<tr>
                    <td class="small">${fmtTime(m.createdAt)}</td>
                    <td>${gameBadge(m.game)} <span class="badge ${m.kind}">${KIND_LABEL[m.kind]}</span>${m.tournamentName ? `<div class="small"><a href="#/tournament/${m.tournamentId}">${esc(m.tournamentName)}</a></div>` : ''}</td>
                    <td class="dot-blue ${m.winner === 'blue' ? 'win-name' : ''}">🔵 ${nameLink(m.blueName, m.blueUser)}</td>
                    <td class="dot-red ${m.winner === 'red' ? 'win-name' : ''}">🔴 ${nameLink(m.redName, m.redUser)}</td>
                    <td class="small">${m.winner === 'draw' ? '🤝 Hòa' : `🏆 ${m.winner === 'blue' ? 'Xanh' : 'Đỏ'} thắng`}</td>
                    <td class="num">${m.plies}</td>
                    <td><a class="btn btn-sm" href="#/match/${m.id}">▶ Xem lại</a></td></tr>`).join('')}
                </tbody></table></div>
                <div class="pager"><button class="btn btn-sm" id="h-prev" ${page <= 1 ? 'disabled' : ''}>◀</button>
                    <span class="small">Trang ${page}/${pages} · ${total} trận</span>
                    <button class="btn btn-sm" id="h-next" ${page >= pages ? 'disabled' : ''}>▶</button></div>`
                : '<div class="card empty">Chưa có trận đấu nào được lưu.<br>Các trận Online, giải đấu và trận luyện tập sẽ xuất hiện ở đây.</div>';
            const prev = $('#h-prev'), next = $('#h-next');
            if (prev) prev.onclick = () => { hist.offset = Math.max(0, hist.offset - hist.limit); draw(); };
            if (next) next.onclick = () => { hist.offset += hist.limit; draw(); };
        };
        $('#h-kind').addEventListener('change', (e) => { hist.kind = e.target.value; hist.offset = 0; draw(); });
        $('#h-game').addEventListener('change', (e) => { hist.game = e.target.value; hist.offset = 0; draw(); });
        const mineBox = $('#h-mine');
        if (mineBox) mineBox.addEventListener('change', (e) => { hist.mine = e.target.checked; hist.offset = 0; draw(); });
        $('#h-player').addEventListener('input', debounce((e) => { hist.player = e.target.value.trim(); hist.offset = 0; draw(); }, 300));
        await draw();
    }

    // =====================================================================
    // Admin: dashboard (tournaments, users) and the tournament / rules editor (issue #4)
    // =====================================================================
    async function viewAdmin(tab) {
        tab = tab || 'overview';
        if (!isAdmin) {
            view.innerHTML = `<div class="card empty">🔒 Chỉ admin mới vào được trang này.<br>${me ? 'Tài khoản của bạn không có quyền quản trị.' : '<a href="/login.html?next=%2Farena.html%23%2Fadmin">Đăng nhập bằng tài khoản admin</a> (mật khẩu, sau đó khóa admin).'}</div>`;
            return;
        }
        view.innerHTML = `<div class="row between" style="margin-bottom:1rem"><h1>🛠 Quản trị</h1>
            <a class="btn btn-primary" href="#/admin/edit/new" style="text-decoration:none">➕ Tạo giải đấu</a></div>
            <div class="tabs">
                <button class="btn ${tab === 'overview' ? 'active' : ''}" data-tab="overview">📊 Tổng quan</button>
                <button class="btn ${tab === 'tournaments' ? 'active' : ''}" data-tab="tournaments">🏆 Giải đấu</button>
                <button class="btn ${tab === 'users' ? 'active' : ''}" data-tab="users">👥 Người dùng</button>
                <button class="btn ${tab === 'security' ? 'active' : ''}" data-tab="security">🛡 Bảo mật</button>
                <button class="btn ${tab === 'backups' ? 'active' : ''}" data-tab="backups">💾 Sao lưu</button></div>
            <div id="adm-body"><div class="empty">Đang tải…</div></div>`;
        view.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) viewAdmin(b.dataset.tab); });
        if (tab === 'overview') await adminOverview();
        else if (tab === 'users') await adminUsers();
        else if (tab === 'security') await adminSecurity();
        else if (tab === 'backups') await adminBackups();
        else await adminTournaments();
    }

    async function adminOverview() {
        const [stats, tournaments] = await Promise.all([
            api('GET', '/api/admin/overview'),
            api('GET', '/api/tournaments')
        ]);
        const openTournaments = tournaments.filter(t => t.status === 'registration' || t.status === 'running').length;
        $('#adm-body').innerHTML = `<div class="stat-grid admin-overview-grid">
            <div class="stat overview-card overview-users"><div class="overview-card-heading"><span>Người chơi toàn hệ thống</span><span class="overview-icon" aria-hidden="true">♟</span></div><b>${stats.users}</b><small>Tài khoản đã đăng ký</small></div>
            <div class="stat overview-card overview-tournaments"><div class="overview-card-heading"><span>Giải đấu đang mở</span><span class="overview-icon" aria-hidden="true">♜</span></div><b>${openTournaments}</b><small>Trong ${tournaments.length} giải đấu</small></div>
            <div class="stat overview-card overview-submissions"><div class="overview-card-heading"><span>Bài nộp của người dùng</span><span class="overview-icon" aria-hidden="true">⌘</span></div><b>${stats.submissions}</b><small>Bot đã đăng ký vào giải đấu</small></div>
            <div class="stat overview-card overview-matches"><div class="overview-card-heading"><span>Trận đấu đang chạy</span><span class="overview-icon" aria-hidden="true">⚔</span></div><b>${stats.matches}</b><small>Đang diễn ra trực tiếp</small></div>
        </div>`;
    }

    async function adminTournaments() {
        const list = await api('GET', '/api/tournaments');
        const box = $('#adm-body');
        box.innerHTML = list.length ? `<div class="card table-wrap"><table><thead><tr><th>Giải đấu</th><th>Thể thức</th><th>Trạng thái</th><th class="num">Bot</th><th>Tạo lúc</th><th></th></tr></thead><tbody>
            ${list.map(t => `<tr><td><a href="#/tournament/${t.id}"><strong>${esc(t.name)}</strong></a>${t.champion ? ` <span class="small">🥇 ${esc(t.champion)}</span>` : ''}</td>
                <td class="small">${FORMAT_LABEL[t.format] || t.format}</td><td><span class="badge ${t.status}">${STATUS_LABEL[t.status]}</span></td>
                <td class="num">${t.entryCount}</td><td class="small">${fmtTime(t.createdAt)}</td>
                <td><a class="btn btn-sm" href="#/admin/edit/${t.id}" style="text-decoration:none">✏️ Sửa</a>
                    <button class="btn btn-sm btn-danger" data-del="${t.id}">🗑</button></td></tr>`).join('')}
            </tbody></table></div>` : '<div class="card empty">Chưa có giải đấu nào.</div>';
        box.onclick = async (e) => {
            const b = e.target.closest('[data-del]');
            if (!b || !confirm('Xóa vĩnh viễn giải đấu này cùng toàn bộ lịch sử các trận của nó?')) return;
            try { await api('DELETE', `/api/tournaments/${b.dataset.del}`); toast('Đã xóa giải'); adminTournaments(); }
            catch (err) { toast(err.message, true); }
        };
    }

    async function adminSecurity() {
        const { sandbox: sb, toolchains, load } = await api('GET', '/api/admin/sandbox');
        const LV = {
            strong: ['finished', 'Mạnh — cách ly hoàn toàn (không mạng, không thấy file máy chủ)'],
            basic: ['running', 'Cơ bản — chặn tiến trình/file/mạng bằng cơ chế của ngôn ngữ (không phải ranh giới tuyệt đối)'],
            weak: ['registration', 'Yếu — chỉ giới hạn tài nguyên, code vẫn làm được mọi thứ tài khoản máy chủ làm được'],
            none: ['registration', 'Không có bảo vệ']
        };
        const rows = [['javascript', 'JavaScript'], ['python', 'Python'], ['cpp', 'C++']].map(([k, label]) => {
            const [cls, text] = LV[sb.levels[k]];
            const tc = toolchains[k];
            return `<tr><td><strong>${label}</strong></td><td>${tc && tc.ok === false ? '<span class="badge registration">chưa cài</span>' : `<span class="badge ${cls}">${sb.levels[k]}</span>`}</td><td class="small">${tc && tc.ok === false ? esc(tc.hint) : text}</td></tr>`;
        }).join('');
        const overall = Object.values(sb.levels).every(l => l === 'strong');
        $('#adm-body').innerHTML = `
            <div class="card"><h2>${overall ? '🛡 Bot đang được cách ly hoàn toàn' : '⚠️ Bot chưa được cách ly hoàn toàn'}</h2>
                <p class="muted small" style="margin-bottom:.6rem">Bot là code do người khác viết, chạy ngay trên máy chủ này. Driver hiện tại: <strong>${esc(sb.driver)}</strong>${sb.bwrap ? ` (${esc(sb.bwrap.version)})` : ''} ·
                    ${sb.strict ? 'chế độ <strong>strict</strong>: ngôn ngữ nào không được cách ly mạnh sẽ bị từ chối' : 'chế độ thường (không từ chối ngôn ngữ nào)'} ·
                    Node permission: ${sb.nodePermission ? esc(sb.nodePermission) : 'không có'}</p>
                <table><thead><tr><th>Ngôn ngữ</th><th>Mức</th><th>Ý nghĩa</th></tr></thead><tbody>${rows}</tbody></table>
                ${sb.notes.length ? `<div class="notice" style="margin-top:.8rem"><strong>Lưu ý</strong><ul style="margin:.3rem 0 0 1.1rem">${sb.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
                <p class="small" style="margin-top:.8rem">⚙️ Tải hiện tại: <strong>${load.bots.active}/${load.bots.limit}</strong> tiến trình bot đang chạy, ${load.bots.queued} đang chờ (cao nhất từng thấy ${load.bots.maxActive}) ·
                    biên dịch C++: ${load.compiles.active}/${load.compiles.limit}, ${load.compiles.queued} đang chờ. Giới hạn chung cho TOÀN BỘ máy chủ (<code>MAX_BOT_PROCS</code>, <code>MAX_COMPILES</code>).</p>
                <p class="small muted" style="margin-top:.4rem">Giới hạn mỗi nước: ${sb.limits.cpuSeconds}s CPU · ${sb.limits.memoryMB}MB RAM (Python/C++) · heap JS ${sb.limits.nodeHeapMB}MB.
                    Biến môi trường: <code>SANDBOX=auto|bwrap|builtin|off</code>, <code>SANDBOX_STRICT=1</code>, <code>SANDBOX_MEM_MB</code>, <code>SANDBOX_CPU_SEC</code>. Xem <code>docs/SECURITY.md</code>.</p>
            </div>`;
    }

    async function adminBackups() {
        const draw = async () => {
            const { enabled, backups } = await api('GET', '/api/admin/backups');
            const fmtSize = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
            $('#adm-body').innerHTML = `<div class="card"><div class="row between"><h2>💾 Sao lưu cơ sở dữ liệu</h2>
                <button class="btn btn-primary" id="bk-now" ${enabled ? '' : 'disabled'}>Sao lưu ngay</button></div>
                <p class="muted small" style="margin:.4rem 0 .8rem">Bản sao lưu chứa <strong>mọi thứ</strong>: băm mật khẩu, code của tất cả bot, lịch sử trận. Hãy cất kỹ.
                Tự động mỗi <code>BACKUP_INTERVAL_HOURS</code> giờ (mặc định 24), giữ <code>BACKUP_KEEP</code> bản mới nhất (mặc định 14).
                Khôi phục: tắt server, chép file <code>.db</code> đè lên <code>data/ott.db</code>, xóa <code>ott.db-wal</code> và <code>ott.db-shm</code>, bật lại.</p>
                ${!enabled ? '<div class="notice">CSDL đang chạy trong bộ nhớ (DB_PATH=:memory:) nên không thể sao lưu.</div>' : ''}
                ${backups.length ? `<table><thead><tr><th>Tệp</th><th>Lúc</th><th class="num">Dung lượng</th><th></th></tr></thead><tbody>
                ${backups.map(b => `<tr><td class="mono small">${esc(b.name)}</td><td class="small">${fmtTime(b.createdAt)}</td><td class="num">${fmtSize(b.size)}</td>
                    <td><button class="btn btn-sm" data-dl="${esc(b.name)}">⬇ Tải về</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Chưa có bản sao lưu nào.</p>'}</div>`;
            const now = $('#bk-now');
            if (now) now.onclick = async () => {
                now.disabled = true;
                try { await api('POST', '/api/admin/backups'); toast('Đã sao lưu'); await draw(); } catch (e) { toast(e.message, true); now.disabled = false; }
            };
            $('#adm-body').onclick = async (e) => {
                const b = e.target.closest('[data-dl]');
                if (!b) return;
                try {   // fetch (not a plain link) so the admin key header also works
                    const res = await fetch(`/api/admin/backups/${encodeURIComponent(b.dataset.dl)}`, { credentials: 'same-origin' });
                    if (!res.ok) throw new Error('Không tải được');
                    const url = URL.createObjectURL(await res.blob());
                    const a = document.createElement('a'); a.href = url; a.download = b.dataset.dl; a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                } catch (err) { toast(err.message, true); }
            };
        };
        await draw();
    }

    async function adminUsers() {
        const users = await api('GET', '/api/admin/users');
        const box = $('#adm-body');
        box.innerHTML = `<div class="card table-wrap"><table><thead><tr><th>Tài khoản</th><th>Quyền</th><th class="num">Elo</th><th class="num">Trận</th><th>Tham gia</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>
            ${users.map(u => `<tr><td><a href="#/profile/${encodeURIComponent(u.username)}"><strong>${esc(u.username)}</strong></a></td>
                <td><select data-role="${u.id}"><option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
                <td class="num">${u.elo}</td><td class="num">${u.matches}</td><td class="small">${fmtTime(u.createdAt)}</td>
                <td class="small">${u.lastLoginAt ? fmtTime(u.lastLoginAt) : '—'}</td>
                <td><button class="btn btn-sm" data-pw="${u.id}" data-name="${esc(u.username)}">🔑 Đặt lại mật khẩu</button></td></tr>`).join('')}
            </tbody></table></div>`;
        box.onchange = async (e) => {
            const sel = e.target.closest('[data-role]');
            if (!sel) return;
            try { await api('POST', `/api/admin/users/${sel.dataset.role}/role`, { role: sel.value }); toast('Đã đổi quyền'); }
            catch (err) { toast(err.message, true); adminUsers(); }
        };
        box.onclick = async (e) => {
            const b = e.target.closest('[data-pw]');
            if (!b) return;
            const pw = prompt(`Mật khẩu mới cho ${b.dataset.name} (8–128 ký tự).\nTất cả phiên đăng nhập của người này sẽ bị thu hồi:`);
            if (!pw) return;
            try { await api('POST', `/api/admin/users/${b.dataset.pw}/password`, { password: pw }); toast('Đã đặt lại mật khẩu'); }
            catch (err) { toast(err.message, true); }
        };
    }

    // ---------- tournament + rules editor ----------
    async function viewTournamentEditor(idParam) {
        if (!isAdmin) return viewAdmin();
        const [idPart, qs] = String(idParam).split('?');
        const isNew = idPart === 'new';
        const hashGame = new URLSearchParams(qs || '').get('game');
        const detail = isNew ? null : await api('GET', `/api/tournaments/${idPart}`);
        const t = detail && detail.tournament;
        const started = !!t && t.status !== 'registration';          // rules are frozen once games exist
        const gameId = started ? t.game.id : (hashGame && GAMES[hashGame] ? hashGame : (t ? t.game.id : 'rps'));
        const hasEntries = !!detail && detail.entries.length > 0;
        const def = await api('GET', `/api/rules/default?game=${gameId}`);
        const sameGame = !!t && t.game.id === gameId;                // switching the game starts from that game's defaults
        const cfg = sameGame ? t.config : { bestOf: 3, groupBestOf: 2, groupCount: 2, advance: 2, thirdPlace: false, moveDelayMs: 0, concurrency: 2, requireLogin: true };
        const eff = sameGame ? t.rules : def;
        const isRps = gameId === 'rps';

        const rules = { maxPlies: eff.maxPlies, moveTimeoutMs: eff.moveTimeoutMs, timeBankMs: eff.timeBankMs || 0, size: eff.rows };
        if (isRps) {
            Object.assign(rules, {
                blueGoal: { ...eff.blueGoal }, redGoal: { ...eff.redGoal },
                beats: Object.fromEntries(Object.entries(eff.beats).map(([k, v]) => [k, [...v]])),
                setup: { p1: eff.setup.p1.map(p => ({ ...p })), p2: eff.setup.p2.map(p => ({ ...p })) }
            });
        } else {
            rules.winLength = eff.winLength;
        }
        const tool = { side: 1, kind: 'rock' };
        const TYPES = [['rock', '✊ Đá'], ['paper', '✋ Giấy'], ['scissors', '✌️ Kéo']];
        const back = isNew ? '#/admin' : `#/tournament/${t.id}`;

        view.innerHTML = `
            <a href="${back}" class="small">← ${isNew ? 'Quản trị' : 'Về giải đấu'}</a>
            <h1>${isNew ? '➕ Tạo giải đấu' : `✏️ Sửa: ${esc(t.name)}`}</h1>
            ${started ? '<div class="notice">Giải đã bắt đầu: chỉ đổi được <strong>tên</strong>, <strong>độ trễ trình diễn</strong> và <strong>số ván chạy song song</strong>. Trò chơi và luật chơi đã khóa vì các ván đã đấu theo luật hiện tại.</div>' : ''}
            ${started ? '' : `<div class="card"><h2>Trò chơi</h2><div class="row">
                ${Object.values(GAMES).map(g => hasEntries && g.id !== gameId
                    ? `<span class="btn btn-sm" style="opacity:.45;cursor:not-allowed" title="Đã có bot đăng ký (viết cho trò chơi hiện tại) — hãy xóa hết bot trước">${esc(g.name)}</span>`
                    : `<a class="btn btn-sm ${g.id === gameId ? 'btn-primary' : ''}" style="text-decoration:none" href="#/admin/edit/${idPart}?game=${g.id}">${esc(g.name)}</a>`).join('')}
                </div><p class="muted small" style="margin-top:.5rem">${esc((GAMES[gameId] || {}).description || '')}</p></div>`}
            <div class="card"><h2>Thông tin giải</h2><div class="form-grid">
                <label>Tên giải<input id="e-name" maxlength="80" value="${esc(t ? t.name : '')}" placeholder="VD: Giải OTT mùa thu 2026"></label>
                <label>Thể thức<select id="e-format" ${started ? 'disabled' : ''}>
                    ${Object.entries(FORMAT_LABEL).map(([k, v]) => `<option value="${k}" ${t && t.format === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label data-for="single_elim groups_knockout">Số ván / cặp (knockout)<select id="e-bestof" ${started ? 'disabled' : ''}>${[1, 3, 5, 7].map(n => `<option ${cfg.bestOf === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <label data-for="round_robin groups_knockout">Số ván / cặp (vòng bảng)<select id="e-gbestof" ${started ? 'disabled' : ''}>${[1, 2, 3, 4].map(n => `<option ${cfg.groupBestOf === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <label data-for="groups_knockout">Số bảng<input id="e-groups" type="number" min="1" max="16" value="${cfg.groupCount}" ${started ? 'disabled' : ''}></label>
                <label data-for="groups_knockout">Mỗi bảng đi tiếp<input id="e-advance" type="number" min="1" max="8" value="${cfg.advance}" ${started ? 'disabled' : ''}></label>
                <label>Trễ giữa các nước (ms)<input id="e-delay" type="number" min="0" max="3000" value="${cfg.moveDelayMs}" title="0 = nhanh nhất; 300–500 để trình diễn trực tiếp"></label>
                <label>Số ván chạy song song<input id="e-conc" type="number" min="1" max="4" value="${cfg.concurrency}"></label>
                <label class="inline" data-for="single_elim groups_knockout"><input id="e-third" type="checkbox" ${cfg.thirdPlace ? 'checked' : ''} ${started ? 'disabled' : ''}> Có trận tranh hạng 3</label>
                <label class="inline"><input id="e-login" type="checkbox" ${cfg.requireLogin ? 'checked' : ''} ${started ? 'disabled' : ''}> Bắt buộc đăng nhập để đăng ký</label>
            </div></div>

            <div class="card"><h2>⚙️ Luật chơi — ${esc((GAMES[gameId] || {}).short || gameId)}</h2>
                <div class="form-grid">
                    <label>Cỡ bàn (${isRps ? '5–15' : '3–19'})<input id="r-size" type="number" min="${isRps ? 5 : 3}" max="${isRps ? 15 : 19}" value="${rules.size}" ${started ? 'disabled' : ''}></label>
                    ${isRps ? '' : `<label>Số quân liên tiếp để thắng (3–6)<input id="r-win" type="number" min="3" max="6" value="${rules.winLength}" ${started ? 'disabled' : ''}></label>`}
                    <label>Giới hạn số nước đi (hòa)<input id="r-plies" type="number" min="5" max="2000" value="${rules.maxPlies}" ${started ? 'disabled' : ''}></label>
                    <label>Thời gian tối đa mỗi nước (ms)<input id="r-timeout" type="number" min="100" max="10000" value="${rules.moveTimeoutMs}" ${started ? 'disabled' : ''}></label>
                    <label>Tổng thời gian suy nghĩ mỗi bên (ms)<input id="r-bank" type="number" min="0" max="3600000" value="${rules.timeBankMs}" ${started ? 'disabled' : ''} title="0 = không giới hạn. Hết giờ tổng = thua. Tính cả thời gian khởi động tiến trình bot."></label>
                </div>
                <p class="muted small" style="margin:.2rem 0 .6rem">Thời gian tổng chạy như đồng hồ cờ vua: mỗi nước bot dùng bao nhiêu trừ vào quỹ của bên đó; hết quỹ là thua.</p>
                ${isRps ? `
                <h3 style="margin-top:.6rem">Ai ăn được ai</h3>
                <table class="beats-table"><thead><tr><th>ăn được ↓ / quân bị ăn →</th>${TYPES.map(([k, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
                    ${TYPES.map(([att, al]) => `<tr><th>${al}</th>${TYPES.map(([vic]) => `<td><input type="checkbox" data-att="${att}" data-vic="${vic}" ${att === vic ? 'disabled' : ''} ${(rules.beats[att] || []).includes(vic) ? 'checked' : ''} ${started ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}
                </tbody></table>
                ${started ? '' : '<div class="row" style="margin:.4rem 0"><button class="btn btn-sm" id="b-beats-default">↺ Mặc định (Đá > Kéo > Giấy > Đá)</button><button class="btn btn-sm" id="b-beats-flip">⟲ Đảo chiều</button></div>'}
                <h3 style="margin-top:.6rem">Thế cờ xuất phát</h3>
                ${started ? '' : `<div class="row" style="margin-bottom:.5rem">
                    <span class="seg" id="t-side"><button data-side="1" class="on blue">🔵 Xanh</button><button data-side="2">🔴 Đỏ</button></span>
                    <span class="seg" id="t-kind">
                        <button data-kind="rock" class="on">✊ Đá</button><button data-kind="paper">✋ Giấy</button><button data-kind="scissors">✌️ Kéo</button>
                        <button data-kind="erase">🧹 Xóa</button><button data-kind="goalBlue">🎯 Đích Xanh</button><button data-kind="goalRed">🎯 Đích Đỏ</button></span>
                </div>
                <div class="row" style="margin-bottom:.6rem">
                    <button class="btn btn-sm" id="b-default">↺ Mặc định (bàn 9×9)</button>
                    <button class="btn btn-sm" id="b-mirror" title="Đỏ = Xanh xoay 180° (cùng loại quân) — thế cờ công bằng">⇄ Phản chiếu Xanh → Đỏ</button>
                    <button class="btn btn-sm" id="b-clear">🗑 Xóa hết quân</button>
                    <span class="small muted">Bấm vào ô để đặt quân · chuột phải để xóa · đổi cỡ bàn sẽ đặt lại ô đích về hai góc</span></div>`}` : `
                <p class="muted small">Bàn cờ trống; hai bên lần lượt đặt quân, Xanh đi trước. Xem trước bàn cờ:</p>`}
                <div class="row" style="align-items:flex-start;gap:1.2rem">
                    <div id="ed-board"></div>
                    <div style="flex:1;min-width:220px"><div id="ed-count" class="small" style="line-height:1.8"></div><div id="ed-issues" class="issues">…</div></div>
                </div>
            </div>
            <div class="row"><button class="btn btn-primary" id="e-save">💾 ${isNew ? 'Tạo giải đấu' : 'Lưu thay đổi'}</button>
                <a class="btn" href="${back}" style="text-decoration:none">Hủy</a><span id="e-msg" class="small"></span></div>`;

        // show only the fields that make sense for the chosen format
        const syncFormat = () => {
            const f = $('#e-format').value;
            view.querySelectorAll('[data-for]').forEach(el => { el.style.display = el.dataset.for.split(' ').includes(f) ? '' : 'none'; });
        };
        $('#e-format').addEventListener('change', syncFormat);
        syncFormat();

        // ---- live preview / board editor ----
        const boardMatrix = () => {
            const n = rules.size;
            const b = Array.from({ length: n }, () => Array(n).fill(null));
            if (isRps) {
                rules.setup.p1.forEach(p => { b[p.r][p.c] = { player: 1, type: p.t }; });
                rules.setup.p2.forEach(p => { b[p.r][p.c] = { player: 2, type: p.t }; });
            }
            return b;
        };
        const countsHTML = () => {
            if (!isRps) return `Bàn <strong>${rules.size}×${rules.size}</strong> · thắng khi có <strong>${rules.winLength}</strong> quân liên tiếp · tối đa ${rules.maxPlies} nước`;
            return ['p1', 'p2'].map((k, i) => {
                const n = (type) => rules.setup[k].filter(p => p.t === type).length;
                return `<span class="${i ? 'dot-red' : 'dot-blue'}"><strong>${i ? '🔴 Đỏ' : '🔵 Xanh'}</strong></span>: ${rules.setup[k].length} quân (✊${n('rock')} ✋${n('paper')} ✌️${n('scissors')})`;
            }).join('<br>') + `<br>🎯 Đích Xanh: <strong>${notation(rules.blueGoal, rules.size)}</strong> · Đích Đỏ: <strong>${notation(rules.redGoal, rules.size)}</strong>`;
        };
        const drawBoard = () => {
            $('#ed-board').innerHTML = isRps
                ? boardHTML(boardMatrix(), { size: 'lg', goals: { blue: rules.blueGoal, red: rules.redGoal } })
                : boardHTML(boardMatrix(), { size: 'sm', goals: null });
            $('#ed-count').innerHTML = countsHTML();
        };

        let vTimer = null;
        const readNumbers = () => {
            rules.maxPlies = +$('#r-plies').value; rules.moveTimeoutMs = +$('#r-timeout').value; rules.timeBankMs = +$('#r-bank').value || 0;
            rules.size = +$('#r-size').value || rules.size;
            if (!isRps) rules.winLength = +$('#r-win').value || rules.winLength;
        };
        const validate = () => {
            clearTimeout(vTimer);
            vTimer = setTimeout(async () => {
                try {
                    readNumbers();
                    const out = await api('POST', `/api/rules/validate?game=${gameId}`, rules);   // the SAME validator the server applies on save
                    valid = out.ok;
                    const box = $('#ed-issues');
                    if (!box) return;
                    box.className = 'issues' + (out.ok ? '' : ' bad');
                    box.innerHTML = out.ok ? '✔ Luật hợp lệ' : `✖ Cần sửa:<ul>${out.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
                    $('#e-save').disabled = !out.ok && !started;
                } catch (e) { /* offline: server will validate on save */ }
            }, 300);
        };
        let valid = true;
        const changed = () => { drawBoard(); validate(); };

        function placeAt(r, c, forceErase) {
            for (const k of ['p1', 'p2']) rules.setup[k] = rules.setup[k].filter(p => !(p.r === r && p.c === c));
            if (forceErase || tool.kind === 'erase') { /* piece already removed */ }
            else if (tool.kind === 'goalBlue') rules.blueGoal = { r, c };
            else if (tool.kind === 'goalRed') rules.redGoal = { r, c };
            else rules.setup[tool.side === 1 ? 'p1' : 'p2'].push({ r, c, t: tool.kind });
            changed();
        }

        if (!started) {
            ['#r-plies', '#r-timeout', '#r-bank'].forEach(id => $(id).addEventListener('input', validate));
            if (!isRps) {
                $('#r-win').addEventListener('input', () => { readNumbers(); changed(); });
                $('#r-size').addEventListener('change', () => {          // default draw limit follows the board: every cell
                    const n = Math.max(3, Math.min(19, +$('#r-size').value || 15));
                    $('#r-size').value = n; $('#r-plies').value = n * n; readNumbers(); changed();
                });
            } else {
                $('#r-size').addEventListener('change', () => {
                    const n = Math.max(5, Math.min(15, +$('#r-size').value || 9));
                    $('#r-size').value = n; rules.size = n;
                    rules.blueGoal = { r: 0, c: n - 1 }; rules.redGoal = { r: n - 1, c: 0 };
                    for (const k of ['p1', 'p2']) rules.setup[k] = rules.setup[k].filter(p => p.r < n && p.c < n);
                    changed();
                });
                const pick = (groupId, attr, apply) => $(groupId).addEventListener('click', (e) => {
                    const b = e.target.closest(`[data-${attr}]`);
                    if (!b) return;
                    $(groupId).querySelectorAll('button').forEach(x => x.className = '');
                    b.className = 'on' + (attr === 'side' ? (b.dataset.side === '1' ? ' blue' : ' red') : '');
                    apply(b.dataset[attr]);
                });
                pick('#t-side', 'side', (v) => { tool.side = +v; });
                pick('#t-kind', 'kind', (v) => { tool.kind = v; });
                const board = $('#ed-board');
                board.addEventListener('click', (e) => { const c = e.target.closest('.c'); if (c) placeAt(+c.dataset.r, +c.dataset.c, false); });
                board.addEventListener('contextmenu', (e) => { const c = e.target.closest('.c'); if (c) { e.preventDefault(); placeAt(+c.dataset.r, +c.dataset.c, true); } });
                board.classList.add('editor-board');
                $('#b-default').addEventListener('click', () => {
                    rules.size = 9; $('#r-size').value = 9;
                    rules.setup = { p1: def.setup.p1.map(p => ({ ...p })), p2: def.setup.p2.map(p => ({ ...p })) };
                    rules.blueGoal = { ...def.blueGoal }; rules.redGoal = { ...def.redGoal };
                    changed();
                });
                $('#b-mirror').addEventListener('click', () => {
                    rules.setup.p2 = rules.setup.p1.map(p => ({ r: rules.size - 1 - p.r, c: rules.size - 1 - p.c, t: p.t }));
                    changed();
                });
                $('#b-clear').addEventListener('click', () => { rules.setup = { p1: [], p2: [] }; changed(); });

                // capture table
                const syncBeatsUI = () => view.querySelectorAll('[data-att]').forEach(cb => { cb.checked = rules.beats[cb.dataset.att].includes(cb.dataset.vic); });
                view.querySelectorAll('[data-att]').forEach(cb => cb.addEventListener('change', () => {
                    const list = new Set(rules.beats[cb.dataset.att]);
                    if (cb.checked) list.add(cb.dataset.vic); else list.delete(cb.dataset.vic);
                    rules.beats[cb.dataset.att] = [...list];
                    validate();
                }));
                $('#b-beats-default').addEventListener('click', () => {
                    rules.beats = Object.fromEntries(Object.entries(def.beats).map(([k, v]) => [k, [...v]]));
                    syncBeatsUI(); validate();
                });
                $('#b-beats-flip').addEventListener('click', () => {
                    const flipped = { rock: [], paper: [], scissors: [] };
                    for (const [att, victims] of Object.entries(rules.beats)) victims.forEach(v => flipped[v].push(att));
                    rules.beats = flipped; syncBeatsUI(); validate();
                });
            }
        }

        // ---- save ----
        $('#e-save').addEventListener('click', async () => {
            const btn = $('#e-save'), msg = $('#e-msg');
            btn.disabled = true; msg.textContent = '⏳ Đang lưu…';
            try {
                readNumbers();
                const config = {
                    bestOf: +$('#e-bestof').value, groupBestOf: +$('#e-gbestof').value,
                    groupCount: +$('#e-groups').value, advance: +$('#e-advance').value,
                    thirdPlace: $('#e-third').checked, requireLogin: $('#e-login').checked,
                    moveDelayMs: +$('#e-delay').value, concurrency: +$('#e-conc').value
                };
                if (!started) config.rules = rules;
                const body = { name: $('#e-name').value, config };
                if (!started) { body.format = $('#e-format').value; body.game = gameId; }
                if (isNew) {
                    const out = await api('POST', '/api/tournaments', body);
                    toast('Đã tạo giải đấu');
                    location.hash = `#/tournament/${out.id}`;
                } else {
                    await api('PATCH', `/api/tournaments/${t.id}`, body);
                    toast('Đã lưu thay đổi');
                    location.hash = `#/tournament/${t.id}`;
                }
            } catch (e) {
                msg.textContent = '❌ ' + e.message;
                toast(e.message, true);
                btn.disabled = false;
            }
        });

        drawBoard();
        validate();
    }

    // =====================================================================
    // Leaderboard + profile (accounts)
    // =====================================================================
    const nameLink = (name, username) => username
        ? `<a href="#/profile/${encodeURIComponent(username)}">${esc(name)}</a>` : esc(name);
    const winRate = (w, n) => (n ? `${Math.round((w / n) * 100)}%` : '—');

    async function viewLeaderboard() {
        const list = await api('GET', '/api/leaderboard');
        view.innerHTML = `<div class="row between" style="margin-bottom:1rem"><h1>🏅 Bảng xếp hạng Elo</h1></div>
            <p class="muted small" style="margin-bottom:.6rem">Chỉ tính các trận <strong>Online</strong> giữa hai tài khoản đã đăng nhập (đấu với khách không đổi điểm). Các AI 🤖 là mốc tham chiếu có sẵn.</p>
            <div class="card table-wrap"><table><thead><tr><th>#</th><th>Người chơi</th><th class="num">Elo</th><th class="num">Trận</th><th>Thắng-Thua-Hòa</th><th class="num">Tỉ lệ thắng</th></tr></thead><tbody>
            ${list.map((p, i) => `<tr class="${me && p.name === me.username ? 'me' : ''}"><td>${i + 1 === 1 ? '🥇' : i + 1 === 2 ? '🥈' : i + 1 === 3 ? '🥉' : i + 1}</td>
                <td>${p.isBot ? `🤖 ${esc(p.name)}` : `<a href="#/profile/${encodeURIComponent(p.name)}"><strong>${esc(p.name)}</strong></a>`}</td>
                <td class="num"><strong>${p.elo}</strong></td><td class="num">${p.matches}</td>
                <td>${p.wins}W – ${p.losses}L – ${p.draws}D</td><td class="num">${winRate(p.wins, p.matches)}</td></tr>`).join('')}
            </tbody></table></div>`;
    }

    async function viewProfile(username) {
        const [{ user, record, tournaments }, recent] = await Promise.all([
            api('GET', `/api/users/${encodeURIComponent(username)}`),
            api('GET', `/api/matches?user=${encodeURIComponent(username)}&limit=10`)
        ]);
        const isMe = me && me.id === user.id;
        const KINDS = [['online', 'Online'], ['tournament', 'Giải đấu'], ['local', 'Luyện tập']];
        view.innerHTML = `
            <div class="card"><div class="row between"><div><h1>👤 ${esc(user.username)} ${user.role === 'admin' ? '<span class="badge running">admin</span>' : ''}</h1>
                <div class="muted small">Tham gia ${fmtTime(user.createdAt)}</div></div></div>
                <div class="stat-grid">
                    <div class="stat"><b>${user.elo}</b><span>Elo</span></div>
                    <div class="stat"><b>#${user.rank}</b><span>Hạng</span></div>
                    <div class="stat"><b>${user.wins}–${user.losses}–${user.draws}</b><span>Thắng–Thua–Hòa (xếp hạng)</span></div>
                    <div class="stat"><b>${winRate(user.wins, user.matches)}</b><span>Tỉ lệ thắng</span></div>
                </div></div>
            <div class="grid-2">
                <div class="card"><h2>Thành tích theo loại trận</h2>
                    <table><thead><tr><th>Loại</th><th class="num">Trận</th><th class="num">T</th><th class="num">B</th><th class="num">H</th></tr></thead><tbody>
                    ${KINDS.map(([k, label]) => { const r = record[k] || { games: 0, wins: 0, losses: 0, draws: 0 };
                        return `<tr><td>${label}</td><td class="num">${r.games}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td class="num">${r.draws}</td></tr>`; }).join('')}
                    </tbody></table></div>
                <div class="card"><h2>🏆 Giải đấu đã tham gia</h2>
                    ${tournaments.length ? tournaments.map(t => `<div style="padding:.3rem 0;border-bottom:1px solid var(--line)">
                        ${t.champion ? '🥇' : '•'} <a href="#/tournament/${t.id}">${esc(t.name)}</a> <span class="badge ${t.status}">${STATUS_LABEL[t.status]}</span></div>`).join('')
                        : '<p class="muted">Chưa tham gia giải nào.</p>'}</div>
            </div>
            <div class="card"><div class="row between"><h2>Trận gần đây</h2><a class="small" href="#/matches">Xem tất cả →</a></div>
                ${recent.rows.length ? `<div class="table-wrap"><table><tbody>${recent.rows.map(m => `<tr>
                    <td class="small">${fmtTime(m.createdAt)}</td><td><span class="badge ${m.kind}">${KIND_LABEL[m.kind]}</span></td>
                    <td class="dot-blue ${m.winner === 'blue' ? 'win-name' : ''}">🔵 ${nameLink(m.blueName, m.blueUser)}</td>
                    <td class="dot-red ${m.winner === 'red' ? 'win-name' : ''}">🔴 ${nameLink(m.redName, m.redUser)}</td>
                    <td class="small">${m.winner === 'draw' ? '🤝 Hòa' : `🏆 ${m.winner === 'blue' ? 'Xanh' : 'Đỏ'}`}</td>
                    <td><a class="btn btn-sm" href="#/match/${m.id}">▶</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Chưa có trận nào.</p>'}</div>
            ${isMe ? `<div class="card"><h2>🔒 Đổi mật khẩu</h2><div class="form-grid">
                <label>Mật khẩu hiện tại<input id="pw-old" type="password" autocomplete="current-password"></label>
                <label>Mật khẩu mới<input id="pw-new" type="password" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự"></label></div>
                <button class="btn" id="pw-save">Đổi mật khẩu</button> <span class="small muted">Các thiết bị khác sẽ bị đăng xuất.</span></div>` : ''}`;
        const save = $('#pw-save');
        if (save) save.addEventListener('click', async () => {
            try {
                await api('POST', '/api/auth/password', { oldPassword: $('#pw-old').value, newPassword: $('#pw-new').value });
                $('#pw-old').value = ''; $('#pw-new').value = '';
                toast('Đã đổi mật khẩu');
            } catch (e) { toast(e.message, true); }
        });
    }

    // =====================================================================
    // Replay viewer
    // =====================================================================
    async function viewMatch(id) {
        const m = await api('GET', `/api/matches/${id}`);
        const goals = m.rules.blueGoal ? { blue: m.rules.blueGoal, red: m.rules.redGoal } : null;   // only games with goal squares
        const placement = m.game !== 'rps' && !m.moves.some(x => x.from);   // stones are placed, nothing moves
        const rows = m.rules.rows;
        const boards = [m.initialBoard];
        m.moves.forEach(mv => { const nb = cloneBoard(boards[boards.length - 1]); applyMoveTo(nb, mv); boards.push(nb); });
        const N = m.moves.length;
        let ply = 0, timer = null, speed = 500;

        view.innerHTML = `
            <div class="card">
                <div class="row between">
                    <div class="vs-title">
                        <span class="player-tag blue ${m.winner === 'blue' ? 'winner' : ''}">🔵 ${esc(m.blue.name)}</span> vs
                        <span class="player-tag red ${m.winner === 'red' ? 'winner' : ''}">🔴 ${esc(m.red.name)}</span>
                    </div>
                    <div>${isAdmin && m.kind !== 'tournament' ? '<button class="btn btn-sm btn-danger" id="rp-del">🗑 Xóa trận</button> ' : ''}${gameBadge(m.game)} <span class="badge ${m.kind}">${KIND_LABEL[m.kind]}</span>
                    ${m.tournamentId ? `<a class="small" href="#/tournament/${m.tournamentId}">${esc(m.tournamentName)}${m.gameNo ? ` · ván ${m.gameNo}` : ''}</a>` : ''}</div>
                </div>
                <p class="small" style="margin-top:.4rem"><strong>${m.winner === 'draw' ? '🤝 Hòa' : `🏆 ${m.winner === 'blue' ? esc(m.blue.name) : esc(m.red.name)} thắng`}</strong> — ${esc(m.reason)}
                <span class="muted"> · ${N} nước · ${fmtTime(m.createdAt)}${m.durationMs ? ` · ${fmtDur(m.durationMs)}` : ''}</span></p>
            </div>
            <div class="replay-main">
                <div class="card" style="margin:0"><div id="rp-board"></div>
                    <div class="controls">
                        <button class="btn btn-sm" id="rp-first" title="Về đầu (Home)">⏮</button>
                        <button class="btn btn-sm" id="rp-prev" title="Lùi 1 nước (←)">◀</button>
                        <button class="btn btn-primary btn-sm" id="rp-play" title="Phát / Tạm dừng (Space)">▶ Phát</button>
                        <button class="btn btn-sm" id="rp-next" title="Tiến 1 nước (→)">▶|</button>
                        <button class="btn btn-sm" id="rp-last" title="Đến cuối (End)">⏭</button>
                        <select id="rp-speed" title="Tốc độ"><option value="1200">0.5×</option><option value="500" selected>1×</option><option value="220">2×</option><option value="90">5×</option><option value="30">15×</option></select>
                    </div>
                    <input id="rp-slider" class="slider" type="range" min="0" max="${N}" value="0">
                </div>
                <div class="card" style="margin:0">
                    <div class="row between"><strong id="rp-status"></strong></div>
                    <div class="captured" id="rp-cap-blue" ${placement ? 'style="display:none"' : ''}></div><div class="captured" id="rp-cap-red" ${placement ? 'style="display:none"' : ''}></div>
                    <h3 style="margin-top:.6rem">Danh sách nước đi</h3>
                    <div class="move-list" id="rp-moves">${m.moves.map((mv, i) => `
                        <div class="mv p${mv.player}" data-ply="${i + 1}"><span class="n">${i + 1}.</span><span class="who">${mv.player === 1 ? '🔵' : '🔴'}</span>
                        <span>${mv.from ? `${EMOJI[mv.pieceType] || ''} ${notation(mv.from, rows)}→${notation(mv.to, rows)}${mv.capture ? ' ×' + (EMOJI[mv.capture] || '') : ''}` : `● ${notation(mv.to, rows)}`}</span>
                        ${mv.fallback ? '<span class="warn" title="Bot lỗi / quá giờ / đi sai — server chọn nước ngẫu nhiên">⚠️</span>' : ''}</div>`).join('')}</div>
                    <h3 style="margin-top:.6rem">Nhật ký bot (nước đang xem)</h3>
                    <div class="log-box" id="rp-log"></div>
                </div>
            </div>`;

        const set = (p) => { ply = Math.max(0, Math.min(N, p)); draw(); };
        function draw() {
            const last = ply > 0 ? m.moves[ply - 1] : null;
            $('#rp-board').innerHTML = boardHTML(boards[ply], { size: 'md', goals, last });
            $('#rp-slider').value = ply;
            const mv = last;
            $('#rp-status').textContent = ply === 0 ? 'Vị trí xuất phát' :
                `Nước ${ply}/${N} · ${mv.player === 1 ? m.blue.name : m.red.name}${mv.elapsedMs != null ? ` · ${mv.elapsedMs}ms` : ''}`;
            const capB = [], capR = [];
            for (let i = 0; i < ply; i++) { const x = m.moves[i]; if (x.capture) (x.player === 1 ? capB : capR).push(EMOJI[x.capture] || '?'); }
            $('#rp-cap-blue').innerHTML = `<span class="dot-blue">🔵 đã bắt:</span> ${capB.join(' ') || '—'}`;
            $('#rp-cap-red').innerHTML = `<span class="dot-red">🔴 đã bắt:</span> ${capR.join(' ') || '—'}`;
            $('#rp-log').textContent = mv ? (mv.log || '(bot không ghi log)') : '';
            document.querySelectorAll('#rp-moves .mv').forEach(el => el.classList.toggle('cur', +el.dataset.ply === ply));
            const cur = $('#rp-moves .mv.cur');
            if (cur) cur.scrollIntoView({ block: 'nearest' });
            if (ply >= N) stop();
        }
        function play() {
            if (timer) return stop();
            if (ply >= N) ply = 0;
            $('#rp-play').textContent = '⏸ Dừng';
            timer = setInterval(() => set(ply + 1), speed);
        }
        function stop() {
            if (timer) { clearInterval(timer); timer = null; }
            const b = $('#rp-play'); if (b) b.textContent = '▶ Phát';
        }
        const delBtn = $('#rp-del');
        if (delBtn) delBtn.onclick = async () => {
            if (!confirm('Xóa vĩnh viễn trận này khỏi lịch sử?')) return;
            try { await api('DELETE', `/api/matches/${id}`); toast('Đã xóa trận'); location.hash = '#/matches'; }
            catch (e) { toast(e.message, true); }
        };
        $('#rp-first').onclick = () => { stop(); set(0); };
        $('#rp-prev').onclick = () => { stop(); set(ply - 1); };
        $('#rp-next').onclick = () => { stop(); set(ply + 1); };
        $('#rp-last').onclick = () => { stop(); set(N); };
        $('#rp-play').onclick = play;
        $('#rp-slider').oninput = (e) => { stop(); set(+e.target.value); };
        $('#rp-speed').onchange = (e) => { speed = +e.target.value; if (timer) { stop(); play(); } };
        $('#rp-moves').onclick = (e) => { const el = e.target.closest('.mv'); if (el) { stop(); set(+el.dataset.ply); } };

        const onKey = (e) => {
            if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && e.key !== ' ') return;
            if (e.key === 'ArrowLeft') { stop(); set(ply - 1); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { stop(); set(ply + 1); e.preventDefault(); }
            else if (e.key === 'Home') { stop(); set(0); }
            else if (e.key === 'End') { stop(); set(N); }
            else if (e.key === ' ' && document.activeElement.tagName !== 'BUTTON') { play(); e.preventDefault(); }
        };
        document.addEventListener('keydown', onKey);
        cleanup = () => { stop(); document.removeEventListener('keydown', onKey); };
        draw();
    }

    // ---------- boot ----------
    api('GET', '/api/games').then(list => { GAMES = Object.fromEntries(list.map(g => [g.id, g])); }).catch(() => { }).then(refreshMe).then(route);
})();
