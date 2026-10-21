(function () {
    'use strict';

    const gate = document.getElementById('auth-gate');
    const app = document.getElementById('arena-app');
    const form = document.getElementById('auth-gate-form');
    const username = document.getElementById('gate-username');
    const password = document.getElementById('gate-password');
    const adminWrap = document.getElementById('gate-admin-key-wrap');
    const adminKey = document.getElementById('gate-admin-key');
    const message = document.getElementById('gate-message');
    const submit = document.getElementById('gate-submit');
    let mode = 'login';
    let initialized = false;

    window.OTT_AUTH = { ready: false, user: null };

    function setMode(next) {
        mode = next;
        form.querySelectorAll('[data-auth-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.authMode === mode);
        });
        document.getElementById('auth-gate-title').textContent = mode === 'login' ? 'Chào mừng trở lại' : 'Tạo tài khoản';
        document.querySelector('.auth-gate-subtitle').textContent = mode === 'login'
            ? 'Đăng nhập để tiếp tục vào đấu trường.'
            : 'Tạo tài khoản để bắt đầu chơi và lưu thành tích.';
        submit.textContent = mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
        password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
        adminWrap.hidden = true;
        adminKey.required = false;
        adminKey.value = '';
        message.textContent = '';
    }

    async function request(url, body) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(result.error || `Lỗi ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return result;
    }

    function enter(user) {
        window.OTT_AUTH = { ready: true, user };
        gate.hidden = true;
        app.style.display = '';
        document.getElementById('header-player-name').textContent = user.username;
        document.getElementById('header-player-elo').textContent = user.elo;
        const profile = document.getElementById('account-link-btn');
        profile.textContent = `👤 ${user.username}`;
        profile.href = `arena.html#/profile/${encodeURIComponent(user.username)}`;
        document.getElementById('main-admin-link').style.display = user.role === 'admin' ? '' : 'none';
        document.getElementById('main-logout-btn').style.display = '';
        if (!initialized) {
            initialized = true;
            document.dispatchEvent(new Event('ott-authenticated'));
        }
    }

    form.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.authMode)));
    form.addEventListener('submit', async event => {
        event.preventDefault();
        submit.disabled = true;
        message.textContent = '';
        try {
            const body = { username: username.value.trim(), password: password.value };
            if (!adminWrap.hidden) body.adminKey = adminKey.value;
            await request(`/api/auth/${mode}`, body);
            password.value = '';
            adminKey.value = '';
            location.replace('arena.html#/tournaments');
        } catch (error) {
            message.textContent = error.status === 403
                ? `${error.message} Dùng khóa ADMIN_KEY của máy chủ hiện đang chạy.`
                : error.message;
            if (error.status === 403) {
                adminWrap.hidden = false;
                adminKey.required = true;
                adminKey.focus();
            }
        } finally {
            submit.disabled = false;
        }
    });

    document.getElementById('main-logout-btn').addEventListener('click', async () => {
        try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) { }
        location.reload();
    });

    fetch('/api/auth/me').then(response => response.json()).then(result => {
        if (result.user) enter(result.user);
        else { app.style.display = 'none'; gate.hidden = false; username.focus(); }
    }).catch(() => {
        app.style.display = 'none';
        gate.hidden = false;
        message.textContent = 'Không kết nối được máy chủ. Hãy thử tải lại trang.';
    });
})();
