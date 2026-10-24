// ===== OTTv2 Code Arena - login / register page (players and admins) =====
// Step 1 posts the credentials. A player gets a session and goes to the home page; an admin account gets
// only a short challenge cookie and must type the ADMIN_KEY (step 2) before the server opens a session.
(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    let mode = 'login';

    // ?next=/caro.html -> back to the page that sent us here. Same-origin paths only (no open redirect).
    function nextTarget(fallback) {
        const next = new URLSearchParams(location.search).get('next') || '';
        const safe = /^\/(?!\/)[^\\\s]*$/.test(next) && !/^\/login\.html/.test(next);
        return safe ? next : fallback;
    }

    async function post(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body)
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(json.error || `Lỗi ${res.status}`);
            err.restart = !!json.restart;
            throw err;
        }
        return json;
    }

    function setMode(m) {
        mode = m;
        const reg = m === 'register';
        $('#tab-login').classList.toggle('btn-primary', !reg);
        $('#tab-register').classList.toggle('btn-primary', reg);
        $('#tab-login').setAttribute('aria-selected', String(!reg));
        $('#tab-register').setAttribute('aria-selected', String(reg));
        $('#row-pass2').hidden = !reg;
        $('#f-pass').autocomplete = reg ? 'new-password' : 'current-password';
        $('#cred-submit').textContent = reg ? 'Tạo tài khoản' : 'Đăng nhập';
        $('#cred-msg').textContent = '';
        $('#f-user').focus();
    }

    function showStep(step) {
        $('#step-credentials').hidden = step !== 'credentials';
        $('#step-admin').hidden = step !== 'admin';
        (step === 'admin' ? $('#f-key') : $('#f-pass')).focus();
    }

    const go = (url) => location.replace(url);

    $('#tab-login').addEventListener('click', () => setMode('login'));
    $('#tab-register').addEventListener('click', () => setMode('register'));

    $('#cred-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = $('#cred-msg');
        const username = $('#f-user').value.trim();
        const password = $('#f-pass').value;
        if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) { msg.textContent = '❌ Tên đăng nhập 3–20 ký tự: chữ, số, dấu . _ -'; return; }
        if (password.length < 8) { msg.textContent = '❌ Mật khẩu tối thiểu 8 ký tự'; return; }
        if (mode === 'register' && password !== $('#f-pass2').value) { msg.textContent = '❌ Hai lần nhập mật khẩu không khớp'; return; }

        const btn = $('#cred-submit');
        btn.disabled = true;
        msg.textContent = '';
        try {
            const out = await post(`/api/auth/${mode}`, { username, password });
            $('#f-pass').value = ''; $('#f-pass2').value = '';
            if (out.needAdminKey) {
                $('#admin-name').textContent = out.username;
                $('#admin-ttl').textContent = Math.round((out.expiresInSec || 120) / 60);
                const consoleCode = out.keyMode === 'console';
                $('#admin-how').innerHTML = consoleCode
                    ? 'Một <strong>mã 6 số dùng một lần</strong> vừa được in trên <strong>console của máy chủ</strong> (cửa sổ đang chạy <code>npm start</code>). Nhập mã đó để mở phiên làm việc.'
                    : 'Tài khoản quản trị cần thêm <strong>khóa admin</strong> (ADMIN_KEY của máy chủ) để mở phiên làm việc.';
                $('#admin-key-label').textContent = consoleCode ? 'Mã trên console' : 'Khóa admin';
                $('#f-key').type = consoleCode ? 'text' : 'password';
                $('#f-key').inputMode = consoleCode ? 'numeric' : 'text';
                $('#admin-msg').textContent = '';
                showStep('admin');
                return;
            }
            go(nextTarget(out.redirect || '/home.html'));
        } catch (err) {
            msg.textContent = '❌ ' + err.message;
        } finally {
            btn.disabled = false;
        }
    });

    $('#admin-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = $('#admin-msg');
        const key = $('#f-key').value.trim();
        if (!key) { msg.textContent = '❌ Hãy nhập khóa admin'; return; }
        const btn = $('#admin-submit');
        btn.disabled = true;
        try {
            const out = await post('/api/auth/admin-verify', { key });
            $('#f-key').value = '';
            go(out.redirect || '/arena.html#/admin');
        } catch (err) {
            $('#f-key').value = '';
            if (err.restart) {
                showStep('credentials');
                $('#cred-msg').textContent = '❌ ' + err.message;
            } else {
                msg.textContent = '❌ ' + err.message;
                $('#f-key').focus();
            }
        } finally {
            btn.disabled = false;
        }
    });

    $('#admin-cancel').addEventListener('click', () => { $('#f-key').value = ''; showStep('credentials'); });

    if (new URLSearchParams(location.search).get('mode') === 'register') setMode('register');
    else $('#f-user').focus();
})();
