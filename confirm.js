// ===== OTTv2 Code Arena - small confirm dialog shared by the pages (e.g. "log out?") =====
// OTTConfirm({ title, message, ok, cancel }) -> Promise<boolean>. Esc / backdrop / Hủy = false.
(function () {
    'use strict';
    window.OTTConfirm = function ({ title = 'Xác nhận', message = '', ok = 'Đồng ý', cancel = 'Hủy' } = {}) {
        return new Promise((resolve) => {
            const d = document.createElement('dialog');
            d.className = 'auth-dialog confirm-dialog';
            d.innerHTML = `<h3 style="margin-bottom:.5rem"></h3><p class="small" style="margin-bottom:1rem"></p>
                <div class="row" style="justify-content:flex-end;gap:.5rem">
                    <button type="button" class="btn" data-v="0"></button>
                    <button type="button" class="btn btn-primary" data-v="1"></button></div>`;
            d.querySelector('h3').textContent = title;
            d.querySelector('p').textContent = message;
            d.querySelector('[data-v="0"]').textContent = cancel;
            d.querySelector('[data-v="1"]').textContent = ok;
            let answer = false;
            d.addEventListener('click', (e) => {
                const b = e.target.closest('[data-v]');
                if (b) { answer = b.dataset.v === '1'; d.close(); }
                else if (e.target === d) d.close();                  // click on the backdrop
            });
            d.addEventListener('close', () => { d.remove(); resolve(answer); });
            document.body.appendChild(d);
            d.showModal();
            d.querySelector('[data-v="0"]').focus();                 // the safe choice has the focus
        });
    };
    window.OTTConfirmLogout = () => window.OTTConfirm({
        title: 'Đăng xuất?', message: 'Bạn sẽ cần đăng nhập lại để chơi tiếp.', ok: '⏏ Đăng xuất', cancel: 'Hủy'
    });
})();
