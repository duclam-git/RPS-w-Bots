// ===== OTTv2 Code Arena - sound effects (Web Audio, no audio files) =====
// OTTSound.play('place' | 'win' | 'draw' | 'error', player?) · OTTSound.attach(button) = mute toggle.
// The on/off choice is remembered (ott_sound) for every page that uses this file.
(function () {
    'use strict';
    let ctx = null;
    const store = {
        get() { try { return localStorage.getItem('ott_sound') !== 'off'; } catch (e) { return true; } },
        set(on) { try { localStorage.setItem('ott_sound', on ? 'on' : 'off'); } catch (e) { } }
    };
    let enabled = store.get();

    function audio() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!ctx && AC) ctx = new AC();
        if (ctx && ctx.state === 'suspended') ctx.resume();
        return ctx;
    }
    function tone(a, { type = 'sine', from, to, at = 0, dur = 0.1, vol = 0.12 }) {
        const t = a.currentTime + at;
        const osc = a.createOscillator(), gain = a.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t);
        if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(gain); gain.connect(a.destination);
        osc.start(t); osc.stop(t + dur);
    }

    const SOUNDS = {
        // a stone on wood: a short low knock, a little higher for Red so the two sides sound different
        place: (a, p) => { tone(a, { type: 'triangle', from: p === 2 ? 330 : 260, to: 120, dur: 0.07, vol: 0.22 }); tone(a, { type: 'sine', from: 1800, to: 900, dur: 0.02, vol: 0.04 }); },
        win: (a) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(a, { type: 'square', from: f, at: i * 0.09, dur: 0.18, vol: 0.08 })),
        draw: (a) => [440, 392].forEach((f, i) => tone(a, { type: 'sine', from: f, at: i * 0.14, dur: 0.22, vol: 0.1 })),
        error: (a) => tone(a, { type: 'sawtooth', from: 160, dur: 0.15, vol: 0.12 })
    };

    function play(name, player) {
        if (!enabled || !SOUNDS[name]) return;
        try { const a = audio(); if (a) SOUNDS[name](a, player); } catch (e) { /* sound is never essential */ }
    }

    function attach(btn) {
        if (!btn) return;
        const label = () => { btn.textContent = enabled ? '🔊' : '🔇'; btn.title = enabled ? 'Tắt âm thanh' : 'Bật âm thanh'; btn.setAttribute('aria-pressed', String(enabled)); };
        label();
        btn.addEventListener('click', () => { enabled = !enabled; store.set(enabled); label(); if (enabled) play('place', 1); });
    }

    window.OTTSound = { play, attach, get enabled() { return enabled; } };
})();
