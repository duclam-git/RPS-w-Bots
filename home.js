// ===== OTTv2 Code Arena - player home page (after login): my stats, my history, pick a game =====
(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtTime = (ts) => new Date(ts).toLocaleString('vi-VN');
    const pct = (w, n) => (n ? `${Math.round((w / n) * 100)}%` : '—');
    const GAME_NAME = { rps: 'Oẳn tù tì', caro: 'Cờ Caro' };
    const KIND_LABEL = { online: 'Online', tournament: 'Giải đấu', local: 'Luyện tập' };
    const STATUS_LABEL = { registration: 'Đang mở đăng ký', running: 'Đang diễn ra', finished: 'Đã kết thúc' };

    async function api(method, url) {
        const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
        if (res.status === 401) { location.replace('/login.html?next=/home.html'); throw new Error('401'); }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Lỗi ${res.status}`);
        return json;
    }

    function toast(msg) {
        const t = $('#toast');
        t.textContent = msg;
        t.className = 'toast show err';
        setTimeout(() => { t.className = 'toast'; }, 3800);
    }

    // ---------- theme (same key as every other page) ----------
    OTTTheme.attach($('#theme-btn'));      // theme picker (theme.js, shared by every page)

    $('#logout-btn').addEventListener('click', async () => {
        if (!(await window.OTTConfirmLogout())) return;
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { /* offline */ }
        location.replace('/login.html');
    });

    // ---------- render ----------
    function myResult(m, username) {
        const lower = username.toLowerCase();
        const side = (m.blueUser || '').toLowerCase() === lower ? 'blue' : (m.redUser || '').toLowerCase() === lower ? 'red' : null;
        if (m.winner === 'draw') return { cls: 'draw', text: '🤝 Hòa' };
        if (!side || (m.blueUser && m.redUser && m.blueUser.toLowerCase() === m.redUser.toLowerCase())) {
            return { cls: '', text: `🏆 ${m.winner === 'blue' ? 'Xanh' : 'Đỏ'} thắng` };
        }
        return m.winner === side ? { cls: 'win', text: '✅ Thắng' } : { cls: 'loss', text: '❌ Thua' };
    }

    function renderStats(user, record) {
        const total = Object.values(record).reduce((a, r) => ({
            games: a.games + r.games, wins: a.wins + r.wins, losses: a.losses + r.losses, draws: a.draws + r.draws
        }), { games: 0, wins: 0, losses: 0, draws: 0 });
        $('#stat-grid').innerHTML = `
            <div class="stat"><b>${user.elo}</b><span>Elo (online Oẳn tù tì)</span></div>
            <div class="stat"><b>#${user.rank}</b><span>Hạng</span></div>
            <div class="stat"><b>${total.games}</b><span>Tổng số trận</span></div>
            <div class="stat"><b>${total.wins}–${total.losses}–${total.draws}</b><span>Thắng–Thua–Hòa</span></div>
            <div class="stat"><b>${pct(total.wins, total.games)}</b><span>Tỉ lệ thắng</span></div>`;
        $('#hello-sub').textContent = total.games
            ? `Bạn đã chơi ${total.games} trận. Chọn một trò chơi bên dưới để tiếp tục.`
            : 'Chưa có trận nào. Chọn một trò chơi bên dưới để bắt đầu, hoặc đọc hướng dẫn nếu bạn mới chơi.';
    }

    function recordRow(label, r) {
        r = r || { games: 0, wins: 0, losses: 0, draws: 0 };
        return `<td class="num">${r.games}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td class="num">${r.draws}</td>`;
    }

    async function load() {
        const meRes = await api('GET', '/api/auth/me');
        const me = meRes.user;
        if (!me) { location.replace('/login.html?next=/home.html'); return; }
        $('#hello-name').textContent = me.username;
        $('#me-chip').textContent = `👤 ${me.username} · ${me.elo}`;
        $('#me-chip').href = `arena.html#/profile/${encodeURIComponent(me.username)}`;
        $('#nav-admin').hidden = !meRes.isAdmin;

        const [profile, recent] = await Promise.all([
            api('GET', `/api/users/${encodeURIComponent(me.username)}`),
            api('GET', '/api/matches?mine=1&limit=12')
        ]);
        const { user, record, byGame, tournaments } = profile;
        renderStats(user, record);

        $('#by-game').innerHTML = Object.keys(GAME_NAME).map(g => {
            const r = (byGame || {})[g] || { games: 0, wins: 0, losses: 0, draws: 0 };
            return `<tr><td>${GAME_NAME[g]}</td>${recordRow(g, r)}<td class="num">${pct(r.wins, r.games)}</td></tr>`;
        }).join('');
        $('#by-kind').innerHTML = Object.keys(KIND_LABEL).map(k => `<tr><td>${KIND_LABEL[k]}</td>${recordRow(k, record[k])}</tr>`).join('');
        ['rps', 'caro'].forEach(g => {
            const r = (byGame || {})[g];
            $(`#meta-${g}`).textContent = r && r.games ? `Bạn đã chơi ${r.games} trận · thắng ${r.wins} (${pct(r.wins, r.games)})` : 'Bạn chưa chơi trò này';
        });

        $('#my-tournaments').innerHTML = tournaments.length
            ? tournaments.map(t => `<div class="list-line">${t.champion ? '🥇' : '•'} <a href="arena.html#/tournament/${t.id}">${esc(t.name)}</a>
                <span class="badge ${t.status}">${STATUS_LABEL[t.status] || t.status}</span></div>`).join('')
            : 'Bạn chưa tham gia giải nào. <a href="arena.html#/tournaments">Xem các giải đang mở →</a>';

        $('#recent').innerHTML = recent.rows.length ? `<table><thead><tr><th>Thời gian</th><th>Trò chơi</th><th>Loại</th><th>Xanh</th><th>Đỏ</th><th>Kết quả</th><th></th></tr></thead><tbody>
            ${recent.rows.map(m => {
                const r = myResult(m, me.username);
                return `<tr><td class="small">${fmtTime(m.createdAt)}</td><td>${GAME_NAME[m.game] || esc(m.game)}</td>
                    <td><span class="badge ${m.kind}">${KIND_LABEL[m.kind] || m.kind}</span></td>
                    <td class="dot-blue ${m.winner === 'blue' ? 'win-name' : ''}">🔵 ${esc(m.blueName)}</td>
                    <td class="dot-red ${m.winner === 'red' ? 'win-name' : ''}">🔴 ${esc(m.redName)}</td>
                    <td><span class="result ${r.cls}">${r.text}</span></td>
                    <td><a class="btn btn-sm" href="arena.html#/match/${m.id}">▶ Xem lại</a></td></tr>`;
            }).join('')}</tbody></table>`
            : '<p class="muted">Chưa có trận nào. Trận luyện tập, online và giải đấu của bạn sẽ hiện ở đây.</p>';
    }

    load().catch(e => { if (e.message !== '401') toast('Không tải được dữ liệu: ' + e.message); });
})();
