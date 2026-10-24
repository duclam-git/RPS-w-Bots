// ===== OTTv2 Code Arena - shared themes (every page) =====
// A theme = a base (light / dark: all the existing [data-theme="dark"] rules keep working) + an optional palette
// (data-palette on <html>, colours in themes.css). Loaded in <head> so the page never flashes the wrong theme.
// Adding a theme: one entry here + one [data-palette="…"] block in themes.css.
(function () {
    'use strict';

    const THEMES = [
        { id: 'light',    name: 'Sáng',        base: 'light', swatch: ['#f0f2f5', '#ffffff', '#18181b'] },
        { id: 'dark',     name: 'Tối',         base: 'dark',  swatch: ['#0b0f19', '#141c2e', '#475569'] },
        { id: 'ocean',    name: 'Đại dương',   base: 'light', swatch: ['#e3f1f6', '#ffffff', '#0e3a4a'] },
        { id: 'forest',   name: 'Rừng xanh',   base: 'light', swatch: ['#e9f3e7', '#fbfdf9', '#1f3d1f'] },
        { id: 'sakura',   name: 'Hoa anh đào', base: 'light', swatch: ['#fcebf1', '#fffafc', '#4a1d2e'] },
        { id: 'sand',     name: 'Cát vàng',    base: 'light', swatch: ['#f4ecdd', '#fffaf1', '#3e2c12'] },
        { id: 'midnight', name: 'Tím đêm',     base: 'dark',  swatch: ['#120d1f', '#1c1530', '#5b4a8a'] },
        { id: 'jungle',   name: 'Rừng đêm',    base: 'dark',  swatch: ['#0b1410', '#12201a', '#3f6b57'] }
    ];
    const byId = (id) => THEMES.find(t => t.id === id);

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
    };

    function saved() {
        const id = store.get('ott_palette');
        if (byId(id)) return id;
        // older pages only stored light/dark in ott_theme; nothing stored -> follow the system setting
        const base = store.get('ott_theme');
        if (base) return base === 'dark' ? 'dark' : 'light';
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function apply(id) {
        const t = byId(id) || THEMES[0];
        const root = document.documentElement;
        if (t.base === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
        if (t.id === 'light' || t.id === 'dark') root.removeAttribute('data-palette'); else root.setAttribute('data-palette', t.id);
        store.set('ott_palette', t.id);
        store.set('ott_theme', t.base);          // pages / code that only know light vs dark
        document.dispatchEvent(new CustomEvent('ott-themechange', { detail: { id: t.id, base: t.base } }));
        return t;
    }

    let menu = null;
    function closeMenu() { if (menu) { menu.remove(); menu = null; } }

    function openMenu(btn) {
        closeMenu();
        const current = saved();
        menu = document.createElement('div');
        menu.className = 'theme-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = '<div class="theme-menu-title">Giao diện</div>' + THEMES.map(t =>
            `<button type="button" role="menuitemradio" aria-checked="${t.id === current}" data-theme-id="${t.id}">` +
            `<span class="theme-swatch">${t.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</span>` +
            `<span class="theme-name">${t.name}</span><span class="theme-check">${t.id === current ? '✓' : ''}</span></button>`).join('');
        document.body.appendChild(menu);
        const r = btn.getBoundingClientRect();
        const w = menu.offsetWidth;
        menu.style.top = `${r.bottom + 6}px`;
        menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
        menu.addEventListener('click', (e) => {
            const b = e.target.closest('[data-theme-id]');
            if (!b) return;
            apply(b.dataset.themeId);
            closeMenu();
            btn.focus();
        });
        const first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
        if (first) first.focus();
    }

    /** Turns a page's theme button into the theme picker. `label(theme)` = the button's text. */
    function attach(btn, label) {
        if (!btn) return;
        const setLabel = () => { btn.textContent = label ? label(byId(saved())) : '🎨'; };
        setLabel();
        btn.title = 'Đổi giao diện';
        btn.setAttribute('aria-haspopup', 'menu');
        btn.addEventListener('click', (e) => { e.stopPropagation(); if (menu) closeMenu(); else openMenu(btn); });
        document.addEventListener('ott-themechange', setLabel);
    }

    document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    // another tab changed the theme
    window.addEventListener('storage', (e) => { if (e.key === 'ott_palette' && byId(e.newValue)) apply(e.newValue); });

    apply(saved());
    window.OTTTheme = { THEMES, apply, attach, current: () => byId(saved()) };
})();
