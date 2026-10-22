// ===== OTTv2 Code Arena - Cờ Caro game page: practice (human / code / strategy bots), bot vs bot, online =====
// Rules come from games/caro.js (the same engine the server uses), so a practice game is replayed and accepted
// by POST /api/matches/local exactly as it was played here.
(function () {
    'use strict';

    const E = window.CaroEngine;
    const STRATS = window.CARO_STRATEGIES || {};
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const SIDE = { 1: 'Xanh', 2: 'Đỏ' };
    const LANG_EXT = { javascript: 'js', python: 'py', cpp: 'cpp' };
    const MOVE_LIMIT_MS = 3000;
    const runner = new window.BotWorker('caro');

    let me = null;
    let rules = E.resolveRules({ size: 15, winLength: 5 });
    let board = E.createInitialBoard(rules);
    let moves = [];               // [{ player, to, notation, ms }]
    let player = 1;
    let over = null;              // { winner, reason } when finished
    let running = false;
    let busy = false;             // a bot is thinking
    let gameToken = 0;            // bumps on reset: answers for an old game are dropped
    let online = null;            // { code, slot, state } while in a room
    let logCount = 0;

    // ---------------------------------------------------------------- helpers
    let toastTimer;
    function toast(msg, isErr) {
        const t = $('#toast');
        t.textContent = msg;
        t.className = 'toast show' + (isErr ? ' err' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.className = 'toast'; }, 3800);
    }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

    // ---------------------------------------------------------------- controllers
    function fillControllers() {
        const opts = [
            ['human', '👤 Người chơi (bấm vào ô)'],
            ['code', '🧑‍💻 Code của tôi (tab Code)'],
            ...Object.entries(STRATS).map(([id, s]) => [`bot:${id}`, `🤖 ${s.name.replace(/^\S+\s/, '')} (bot có sẵn)`])
        ];
        ['blue', 'red'].forEach((side, i) => {
            const sel = $(`#ctrl-${side}`);
            sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
            sel.value = localStorage.getItem(`ott_caro_ctrl_${side}`) || (i === 0 ? 'human' : 'bot:balanced');
            sel.addEventListener('change', () => { localStorage.setItem(`ott_caro_ctrl_${side}`, sel.value); maybeContinue(); });
        });
    }
    const controller = (p) => $(p === 1 ? '#ctrl-blue' : '#ctrl-red').value;

    // ---------------------------------------------------------------- editors
    const editors = {};
    const langOf = (p) => $(`#lang-${p}`).value;
    const codeKey = (p, lang) => `ott_caro_code_${p}_${lang}`;

    function templatesFor(lang) {
        return Object.entries(STRATS).filter(([, s]) => s.code[lang]).map(([id, s]) => ({ id, name: s.name, code: s.code[lang] }));
    }
    function fillTemplateSelect(p) {
        const lang = langOf(p);
        $(`#tpl-${p}`).innerHTML = templatesFor(lang).map(t => `<option value="${t.id}" ${t.id === 'balanced' ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    }
    function defaultCode(p, lang) {
        const t = templatesFor(lang);
        const pick = t.find(x => x.id === 'balanced') || t[0];
        return pick ? pick.code : '';
    }
    function getCode(p) { return editors[p] ? editors[p].getValue() : $(`#editor-${p} textarea`).value; }
    function setCode(p, code) {
        if (editors[p]) editors[p].setValue(code, -1);
        else $(`#editor-${p} textarea`).value = code;
    }

    function initEditors() {
        [1, 2].forEach(p => {
            const lang = localStorage.getItem(`ott_caro_lang_${p}`) || 'javascript';
            $(`#lang-${p}`).value = lang;
            fillTemplateSelect(p);
            const code = localStorage.getItem(codeKey(p, lang)) || defaultCode(p, lang);
            if (window.ace) {
                if (window.__aceBase) window.ace.config.set('basePath', window.__aceBase);
                window.ace.config.set('loadWorkerFromBlob', false);
                const ed = window.ace.edit(`editor-${p}`);
                ed.setTheme('ace/theme/monokai');
                ed.session.setMode(`ace/mode/${lang === 'cpp' ? 'c_cpp' : lang}`);
                ed.session.setUseWorker(false);
                ed.setOptions({ fontSize: '13px', showPrintMargin: false, tabSize: 4 });
                ed.setValue(code, -1);
                ed.session.on('change', () => localStorage.setItem(codeKey(p, langOf(p)), ed.getValue()));
                editors[p] = ed;
            } else {
                const ta = document.createElement('textarea');
                ta.value = code;
                ta.addEventListener('input', () => localStorage.setItem(codeKey(p, langOf(p)), ta.value));
                $(`#editor-${p}`).appendChild(ta);
            }
            $(`#lang-${p}`).addEventListener('change', () => {
                const l = langOf(p);
                localStorage.setItem(`ott_caro_lang_${p}`, l);
                fillTemplateSelect(p);
                if (editors[p]) editors[p].session.setMode(`ace/mode/${l === 'cpp' ? 'c_cpp' : l}`);
                setCode(p, localStorage.getItem(codeKey(p, l)) || defaultCode(p, l));
            });
        });
        document.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (!b) return;
            const p = Number(b.dataset.side);
            if (b.dataset.act === 'load-tpl') {
                const t = templatesFor(langOf(p)).find(x => x.id === $(`#tpl-${p}`).value);
                if (t && confirm(`Thay code bên ${SIDE[p]} bằng mẫu "${t.name}"?`)) setCode(p, t.code);
            } else if (b.dataset.act === 'export') {
                const blob = new Blob([getCode(p)], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `caro_bot_${SIDE[p].toLowerCase()}.${LANG_EXT[langOf(p)]}`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }
        });
    }

    // ---------------------------------------------------------------- tabs / console / moves
    $('.caro-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        $$('.caro-tabs [data-tab]').forEach(x => x.classList.toggle('active', x === b));
        $$('.tab-pane').forEach(x => x.classList.toggle('active', x.dataset.pane === b.dataset.tab));
        if (editors[1]) editors[1].resize();
        if (editors[2]) editors[2].resize();
    });
    function showTab(name) { const b = $(`.caro-tabs [data-tab="${name}"]`); if (b) b.click(); }

    function log(text, cls) {
        const el = $('#console');
        const line = document.createElement('div');
        line.className = `log ${cls || ''}`;
        line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        el.appendChild(line);
        while (el.children.length > 400) el.removeChild(el.firstChild);
        el.scrollTop = el.scrollHeight;
        $('#log-count').textContent = String(++logCount);
    }
    $('#clear-log').addEventListener('click', () => { $('#console').innerHTML = ''; logCount = 0; $('#log-count').textContent = '0'; });

    // ---------------------------------------------------------------- board
    function winningCells(b, last) {
        if (!last) return [];
        const p = b[last.r][last.c] && b[last.r][last.c].player;
        if (!p) return [];
        for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
            const cells = [last];
            for (const s of [1, -1]) {
                for (let i = 1; ; i++) {
                    const r = last.r + s * dr * i, c = last.c + s * dc * i;
                    if (r < 0 || c < 0 || r >= rules.rows || c >= rules.cols || !b[r][c] || b[r][c].player !== p) break;
                    cells.push({ r, c });
                }
            }
            if (cells.length >= rules.winLength) return cells;
        }
        return [];
    }

    function drawBoard() {
        const el = $('#board');
        const n = rules.rows;
        const last = moves.length ? moves[moves.length - 1].to : null;
        const win = over && over.winner !== 'draw' ? winningCells(board, last) : [];
        const isWin = (r, c) => win.some(x => x.r === r && x.c === c);
        const humanTurn = !over && !online && controller(player) === 'human';
        el.style.setProperty('--n', n);
        el.classList.toggle('playable', humanTurn);
        el.classList.toggle('p1-turn', player === 1);
        let html = '';
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                const x = board[r][c];
                const cls = ['cell'];
                if (last && last.r === r && last.c === c) cls.push('last');
                if (isWin(r, c)) cls.push('win');
                html += `<button class="${cls.join(' ')}" data-r="${r}" data-c="${c}" aria-label="${E.toNotation(r, c, rules)}" ${x || !humanTurn ? 'tabindex="-1"' : ''}>${x ? `<i class="stone p${x.player}"></i>` : ''}</button>`;
            }
        }
        el.innerHTML = html;
        $('#ply-text').textContent = `${moves.length} nước · bàn ${n}×${n}, ${rules.winLength} quân thắng`;
        updateStatus();
    }

    function updateStatus() {
        const dot = $('#turn-dot');
        dot.className = `turn-dot p${player}`;
        const res = $('#result');
        if (over) {
            dot.className = 'turn-dot';
            $('#turn-text').textContent = 'Ván đấu kết thúc';
            res.hidden = false;
            res.className = `result-banner ${over.winner === 1 ? 'blue' : over.winner === 2 ? 'red' : 'draw'}`;
            res.innerHTML = `${over.winner === 'draw' ? '🤝 Hòa' : `🏆 ${SIDE[over.winner]} thắng`} — ${esc(over.reason || '')}${over.matchId ? ` · <a href="arena.html#/match/${over.matchId}">▶ Xem lại</a>` : ''}`;
            return;
        }
        res.hidden = true;
        const who = online ? (online.state && online.state[player === 1 ? 'blue' : 'red'] ? online.state[player === 1 ? 'blue' : 'red'].name : SIDE[player]) : describe(player);
        $('#turn-text').textContent = `Lượt ${SIDE[player]}: ${who}${busy ? ' (đang suy nghĩ…)' : ''}`;
    }

    function describe(p) {
        const c = controller(p);
        if (c === 'human') return 'người chơi';
        if (c === 'code') return `code của bạn (${langOf(p)})`;
        const s = STRATS[c.slice(4)];
        return s ? `bot ${s.name}` : c;
    }

    function addMoveToList(m) {
        const li = document.createElement('li');
        li.className = `p${m.player}`;
        li.innerHTML = `<strong>${m.player === 1 ? '🔵' : '🔴'} ${esc(m.notation)}</strong>${m.ms != null ? ` <span class="muted small">${Math.round(m.ms)}ms</span>` : ''}${m.fallback ? ' <span class="small" title="Bot lỗi, máy chọn ngẫu nhiên">⚠️ ngẫu nhiên</span>' : ''}`;
        $('#moves').appendChild(li);
        li.scrollIntoView({ block: 'nearest' });
    }

    // ---------------------------------------------------------------- local game loop
    function resetGame() {
        gameToken++;
        running = false;
        busy = false;
        const size = Number($('#board-size').value);
        rules = E.resolveRules({ size, winLength: size === 3 ? 3 : 5 });
        board = E.createInitialBoard(rules);
        moves = [];
        player = 1;
        over = null;
        $('#moves').innerHTML = '';
        $('#btn-start').textContent = '▶ Bắt đầu';
        drawBoard();
    }

    function play(move, extra) {
        const legal = E.getLegalMoves(player, board, rules);
        const chosen = legal.find(m => m.to.r === move.to.r && m.to.c === move.to.c);
        if (!chosen) return false;
        E.applyMove(board, chosen, player, rules);
        const rec = { player, to: chosen.to, notation: chosen.notation || E.toNotation(chosen.to.r, chosen.to.c, rules), ...(extra || {}) };
        moves.push(rec);
        addMoveToList(rec);
        const res = E.checkWin(board, rules);
        if (res.winner !== null) finish(res.winner, res.reason);
        else if (moves.length >= rules.maxPlies) finish('draw', `Hòa sau ${rules.maxPlies} nước`);
        else player = player === 1 ? 2 : 1;
        drawBoard();
        return true;
    }

    function finish(winner, reason) {
        over = { winner, reason };
        running = false;
        $('#btn-start').textContent = '▶ Bắt đầu';
        log(`${winner === 'draw' ? '🤝 Hòa' : `🏆 ${SIDE[winner]} thắng`}: ${reason}`, 'end');
        saveToHistory();
    }

    /** Practice games go to the history (server replays every move with the engine before storing). */
    async function saveToHistory() {
        if (!me || moves.length === 0) return;
        const mine = ['blue', 'red'].filter((s, i) => ['human', 'code'].includes(controller(i + 1)));
        const label = (p) => (controller(p) === 'human' ? me.username : controller(p) === 'code' ? `${me.username} (code)` : describe(p).replace(/^bot /, ''));
        try {
            const res = await fetch('/api/matches/local', {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    game: 'caro', rules: { size: rules.rows, winLength: rules.winLength }, mine,
                    blue: { name: label(1), lang: controller(1) === 'code' ? langOf(1) : '' },
                    red: { name: label(2), lang: controller(2) === 'code' ? langOf(2) : '' },
                    moves: moves.map(m => ({ player: m.player, to: m.to }))
                })
            });
            const out = await res.json();
            if (res.ok && over) { over.matchId = out.id; updateStatus(); }
        } catch (e) { /* history is best effort */ }
    }

    async function botMove(p) {
        const ctrl = controller(p);
        const legal = E.getLegalMoves(p, board, rules);
        const state = {
            board: E.cloneBoard(board), myPlayer: p, opponentPlayer: p === 1 ? 2 : 1,
            grid: board.map(row => row.map(x => (x ? String(x.player) : '0')).join('')),
            legalMoves: legal.map(m => ({ to: m.to })), turnNumber: Math.ceil((moves.length + 1) / 2),
            winLength: rules.winLength, moveHistory: moves.map((m, i) => ({ turn: i + 1, player: m.player, from: null, to: m.to, notation: m.notation })),
            rules: { rows: rules.rows, cols: rules.cols, winLength: rules.winLength, maxPlies: rules.maxPlies, moveTimeoutMs: rules.moveTimeoutMs, timeBankMs: 0 }
        };
        let lang = 'javascript', code;
        if (ctrl === 'code') { lang = langOf(p); code = getCode(p); }
        else code = (STRATS[ctrl.slice(4)] || STRATS.random).code.javascript;
        const tag = `[${SIDE[p]} · ${describe(p)}]`;

        let out;
        if (lang === 'javascript') {
            out = await runner.run(code, state, MOVE_LIMIT_MS);
        } else {
            // Python / C++ run on the server (compiled once per code, same sandbox as tournaments)
            const t0 = performance.now();
            try {
                const res = await fetch('/api/run-bot-move', {
                    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ game: 'caro', lang, code, state })
                });
                const data = await res.json();
                out = data.success ? { move: data.move, logs: data.log ? [data.log] : [], error: data.move ? null : (data.error || 'Không có nước đi'), elapsed: data.elapsed || (performance.now() - t0) }
                    : { move: null, logs: [], error: data.error || `Lỗi ${res.status}`, elapsed: performance.now() - t0 };
            } catch (e) { out = { move: null, logs: [], error: e.message, elapsed: performance.now() - t0 }; }
        }
        (out.logs || []).forEach(l => String(l).split('\n').filter(Boolean).forEach(x => log(`${tag} ${x}`, `p${p}`)));
        const ok = out.move && out.move.to && legal.find(m => m.to.r === out.move.to.r && m.to.c === out.move.to.c);
        if (!ok) {
            log(`⚠️ ${tag} ${out.error || 'nước đi không hợp lệ'} → máy chọn ngẫu nhiên`, 'err');
            return { move: legal[Math.floor(Math.random() * legal.length)], ms: out.elapsed, fallback: true };
        }
        return { move: ok, ms: out.elapsed };
    }

    async function stepOnce() {
        if (over || busy || online) return;
        if (controller(player) === 'human') { toast(`Đến lượt ${SIDE[player]}: hãy bấm vào một ô trống`); return; }
        busy = true;
        updateStatus();
        const token = gameToken;
        const p = player;
        const res = await botMove(p);
        busy = false;
        if (token !== gameToken || over || player !== p) return;     // reset / took too long
        play(res.move, { ms: res.ms, fallback: res.fallback });
    }

    async function loop() {
        const token = gameToken;
        while (running && !over && token === gameToken) {
            if (controller(player) === 'human') { drawBoard(); return; }   // wait for a click
            await stepOnce();
            const delay = Number($('#speed').value);
            await sleep(delay || 0);
        }
    }
    function maybeContinue() { if (running && !busy) loop(); else drawBoard(); }

    $('#board').addEventListener('click', (e) => {
        const cell = e.target.closest('.cell');
        if (!cell || over || busy || online) return;
        if (controller(player) !== 'human') return;
        const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
        if (board[r][c]) return;
        if (!running) { running = true; $('#btn-start').textContent = '⏸ Tạm dừng'; }
        if (play({ to: { r, c } })) loop();
    });

    $('#btn-start').addEventListener('click', () => {
        if (online) return;
        if (over) resetGame();
        running = !running;
        $('#btn-start').textContent = running ? '⏸ Tạm dừng' : '▶ Bắt đầu';
        if (running) loop();
    });
    $('#btn-step').addEventListener('click', () => { if (!online) { running = false; $('#btn-start').textContent = '▶ Bắt đầu'; stepOnce(); } });
    $('#btn-reset').addEventListener('click', () => { if (!online) resetGame(); });
    $('#board-size').addEventListener('change', () => { if (!online) resetGame(); $('#od-size').textContent = `${$('#board-size').value}×${$('#board-size').value}`; });

    // ---------------------------------------------------------------- bot vs bot (many games, in the worker)
    function botOptions(sel, def) {
        sel.innerHTML = Object.entries(STRATS).map(([id, s]) => `<option value="bot:${id}">${esc(s.name)}</option>`).join('')
            + '<option value="code:1">🧑‍💻 Code Xanh của tôi (JS)</option><option value="code:2">🧑‍💻 Code Đỏ của tôi (JS)</option>';
        sel.value = def;
    }
    const simCode = (v) => (v.startsWith('code:') ? getCode(Number(v.slice(5))) : (STRATS[v.slice(4)] || STRATS.random).code.javascript);
    const simName = (sel) => sel.options[sel.selectedIndex].textContent;

    $('#btn-sim').addEventListener('click', () => {
        if (!$('#sd-a').options.length) { botOptions($('#sd-a'), 'bot:minimax'); botOptions($('#sd-b'), 'bot:balanced'); }
        $('#sim-dialog').showModal();
    });
    $('#sd-close').addEventListener('click', () => { runner.cancel(); $('#sim-dialog').close(); });
    $('#sd-run').addEventListener('click', async () => {
        for (const v of [$('#sd-a').value, $('#sd-b').value]) {
            if (v.startsWith('code:') && langOf(Number(v.slice(5))) !== 'javascript') { toast('Bot đấu bot trong trình duyệt chỉ chạy code JavaScript', true); return; }
        }
        const n = Number($('#sd-n').value);
        const A = simCode($('#sd-a').value), B = simCode($('#sd-b').value);
        const nameA = simName($('#sd-a')), nameB = simName($('#sd-b'));
        const tally = { a: 0, b: 0, draw: 0, plies: 0, done: 0, fallbacks: 0 };
        const btn = $('#sd-run');
        btn.disabled = true;
        const show = () => {
            $('#sd-bar').style.width = `${Math.round((tally.done / n) * 100)}%`;
            $('#sd-out').innerHTML = `<div class="stat-grid">
                <div class="stat"><b>${tally.a}</b><span>${esc(nameA)}</span></div>
                <div class="stat"><b>${tally.draw}</b><span>Hòa</span></div>
                <div class="stat"><b>${tally.b}</b><span>${esc(nameB)}</span></div></div>
                <p>${tally.done}/${n} ván · trung bình ${tally.done ? Math.round(tally.plies / tally.done) : 0} nước/ván${tally.fallbacks ? ` · ⚠️ ${tally.fallbacks} nước lỗi được thay bằng nước ngẫu nhiên` : ''}</p>`;
        };
        const half = Math.ceil(n / 2);
        const r = { size: rules.rows, winLength: rules.winLength };
        // A plays Blue (moves first) in the first half, Red in the second half
        const batch = (codeBlue, codeRed, count, aIsBlue) => runner.simulate({ codeBlue, codeRed, count, rules: r }, (res) => {
            tally.done++;
            tally.plies += res.plies;
            tally.fallbacks += (res.fallbacks[1] || 0) + (res.fallbacks[2] || 0);
            if (res.winner === 'draw') tally.draw++;
            else if ((res.winner === 1) === aIsBlue) tally.a++;
            else tally.b++;
            show();
        });
        show();
        let out = await batch(A, B, half, true);
        if (out.ok !== false && n - half > 0) out = await batch(B, A, n - half, false);
        if (out.ok === false) $('#sd-out').insertAdjacentHTML('beforeend', `<p class="auth-msg">⚠️ ${esc(out.error)}</p>`);
        btn.disabled = false;
    });

    // ---------------------------------------------------------------- online (server runs the match)
    const socket = typeof io === 'function' ? io() : null;
    const mySlotNum = () => (online && online.slot === 'red' ? 2 : 1);

    function setOnlineUI() {
        const inRoom = !!online;
        $('#online-bar').hidden = !inRoom;
        ['#ctrl-blue', '#ctrl-red', '#board-size', '#btn-start', '#btn-step', '#btn-reset', '#btn-sim'].forEach(s => { $(s).disabled = inRoom; });
        if (!inRoom) return;
        const st = online.state || {};
        $('#ob-code').textContent = online.code;
        $('#ob-rules').textContent = st.rules ? `· bàn ${st.rules.size}×${st.rules.size}, ${st.rules.winLength} quân thắng` : '';
        const seat = (s) => (st[s] ? `${esc(st[s].name)} · ${esc(st[s].lang)} ${st[s].ready ? '✅ đã nộp' : '✍️ đang viết code'}` : 'Đang chờ người chơi…');
        $('#ob-blue').innerHTML = `🔵 ${seat('blue')}`;
        $('#ob-red').innerHTML = `🔴 ${seat('red')}`;
        $('#ob-me').textContent = online.slot === 'spectator' ? '👀 Khán giả' : online.slot === 'blue' ? '🔵 Xanh — dùng tab Code Xanh' : '🔴 Đỏ — dùng tab Code Đỏ';
        $('#ob-submit').hidden = online.slot === 'spectator';
    }

    function enterRoom(code, slot, state) {
        online = { code, slot, state };
        if (state.rules) {
            rules = E.resolveRules({ size: state.rules.size, winLength: state.rules.winLength });
            board = E.createInitialBoard(rules);
            moves = []; player = 1; over = null; running = false;
            $('#moves').innerHTML = '';
        }
        $('#online-dialog').close();
        setOnlineUI();
        drawBoard();
        if (slot !== 'spectator') showTab(`code-${slot === 'blue' ? 1 : 2}`);
        log(`🌐 Vào phòng ${code} (${slot === 'spectator' ? 'khán giả' : `bên ${slot === 'blue' ? 'Xanh' : 'Đỏ'}`})`);
    }

    function leaveRoom() {
        if (socket && online) socket.emit('leave_room');
        online = null;
        setOnlineUI();
        resetGame();
    }

    if (socket) {
        socket.on('room_created', (d) => enterRoom(d.roomCode, d.slot, d.roomState));
        socket.on('room_joined', (d) => enterRoom(d.roomCode, d.slot, d.roomState));
        socket.on('room_updated', (st) => { if (online) { online.state = st; setOnlineUI(); updateStatus(); } });
        socket.on('join_error', (msg) => { $('#od-msg').textContent = '❌ ' + msg; toast(msg, true); });
        socket.on('player_left_match', (d) => log('⚠️ ' + d.message, 'err'));
        socket.on('player_submitted', (d) => log(`📤 ${d.name} (${d.player === 'blue' ? 'Xanh' : 'Đỏ'}) đã nộp code`));
        socket.on('match_preparing', (msg) => { $('#ob-status').textContent = msg; log(msg); });
        socket.on('match_validated', (msg) => { $('#ob-status').textContent = msg; log(msg); });
        socket.on('match_code_error', (d) => {
            const text = `❌ Code của ${d.name} (${d.player === 'blue' ? 'Xanh' : 'Đỏ'}) lỗi: ${d.error}`;
            $('#ob-status').textContent = text; log(text, 'err'); showTab('console');
        });
        socket.on('match_started', (d) => {
            if (!online) return;
            rules = E.resolveRules({ size: d.board.length, winLength: (online.state.rules || {}).winLength || 5 });
            board = d.board; moves = []; player = 1; over = null;
            $('#moves').innerHTML = '';
            $('#ob-status').textContent = `⚔️ ${d.blue.name} vs ${d.red.name} — máy chủ đang chạy trận…`;
            $('#ob-rematch').hidden = true;
            drawBoard();
        });
        socket.on('online_move_made', (d) => {
            if (!online) return;
            const m = d.moveRecord;
            board = d.board;
            const rec = { player: m.player, to: m.to, notation: m.notation || E.toNotation(m.to.r, m.to.c, rules), ms: parseFloat(m.elapsed), fallback: /FALLBACK/.test(m.log || '') };
            moves.push(rec);
            addMoveToList(rec);
            if (m.log) String(m.log).split('\n').filter(Boolean).slice(0, 20).forEach(x => log(`[${SIDE[m.player]}] ${x}`, `p${m.player}`));
            player = d.currentPlayer;
            drawBoard();
        });
        socket.on('online_match_finished', (d) => {
            if (!online) return;
            over = { winner: d.winner, reason: d.reason, matchId: d.matchId };
            $('#ob-status').textContent = 'Trận đã kết thúc. Sửa code rồi bấm “Ván mới” để đấu lại.';
            $('#ob-rematch').hidden = false;
            log(`${d.winner === 'draw' ? '🤝 Hòa' : `🏆 ${SIDE[d.winner]} thắng`}: ${d.reason}`, 'end');
            drawBoard();
        });
        socket.on('rematch_ready', (msg) => { $('#ob-status').textContent = msg; $('#ob-rematch').hidden = true; });
        socket.on('match_error', (msg) => { $('#ob-status').textContent = '⚠️ ' + msg; log(msg, 'err'); });
        socket.on('rate_limited', () => toast('Thao tác quá nhanh, hãy chậm lại', true));
        socket.on('session_revoked', () => location.replace('login.html?next=%2Fcaro.html'));
        socket.on('disconnect', () => { if (online) { toast('Mất kết nối tới máy chủ — đã rời phòng', true); online = null; setOnlineUI(); } });
    }

    $('#btn-online').addEventListener('click', () => {
        if (!socket) return toast('Không kết nối được máy chủ', true);
        if (online) return;
        $('#od-msg').textContent = '';
        $('#od-size').textContent = `${$('#board-size').value}×${$('#board-size').value}`;
        $('#online-dialog').showModal();
    });
    $('#od-close').addEventListener('click', () => $('#online-dialog').close());
    $('#od-create').addEventListener('click', () => {
        const size = Number($('#board-size').value);
        socket.emit('create_room', { game: 'caro', lang: langOf(1), rules: { size, winLength: size === 3 ? 3 : 5 } });
    });
    $('#od-join').addEventListener('click', () => {
        const code = $('#od-code').value.trim();
        if (!code) { $('#od-msg').textContent = '❌ Nhập mã phòng'; return; }
        socket.emit('join_room', { roomCode: code, game: 'caro', lang: langOf(2) });
    });
    $('#od-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#od-join').click(); });
    $('#ob-leave').addEventListener('click', leaveRoom);
    $('#ob-copy').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(online ? online.code : ''); toast('Đã chép mã phòng'); });
    $('#ob-submit').addEventListener('click', () => {
        if (!online || online.slot === 'spectator') return;
        const p = mySlotNum();
        socket.emit('player_ready', { code: getCode(p), lang: langOf(p) });
        $('#ob-status').textContent = '📤 Đã nộp code, chờ đối thủ…';
    });
    $('#ob-rematch').addEventListener('click', () => socket && socket.emit('request_rematch'));

    // ---------------------------------------------------------------- boot
    async function boot() {
        fillControllers();
        initEditors();
        resetGame();
        try {
            const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
            me = (await res.json()).user;
        } catch (e) { me = null; }
        if (me) { $('#me-chip').textContent = `👤 ${me.username}`; }
        else { $('#me-chip').textContent = '🔐 Đăng nhập'; $('#me-chip').href = 'login.html?next=%2Fcaro.html'; }
        log('Sẵn sàng. Chọn người chơi / bot cho hai bên rồi bấm ▶ Bắt đầu (hoặc bấm thẳng vào bàn nếu Xanh là người chơi).');
    }
    boot();
})();
