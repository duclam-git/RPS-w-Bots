// ===== OTTv2 Code Arena - page side of the in-browser bot runner (see bot_worker.js) =====
//   const runner = new BotWorker('rps');
//   const { move, logs, error, elapsed } = await runner.run(code, state, 3000);
//   await runner.simulate({ codeBlue, codeRed, count, rules }, (result, index) => { ... });
// A bot that does not answer in time (endless loop...) gets its worker killed and replaced; the page never freezes.
(function (window) {
    'use strict';

    function BotWorker(game) {
        this.game = game === 'caro' ? 'caro' : 'rps';
        this.seq = 0;
        this.pending = new Map();
        this.worker = null;
    }

    BotWorker.prototype._spawn = function () {
        if (this.worker) return this.worker;
        const w = new Worker(`bot_worker.js?game=${this.game}`);
        w.onmessage = (e) => {
            const d = e.data || {};
            const p = this.pending.get(d.id);
            if (!p) return;                                   // stale answer (or something posted by bot code)
            if (d.type === 'move') { this.pending.delete(d.id); clearTimeout(p.timer); p.resolve(d); }
            else if (d.type === 'game') { p.touch(); p.onGame(d.result, d.index); }
            else if (d.type === 'done') { this.pending.delete(d.id); clearTimeout(p.timer); p.resolve({ ok: true }); }
        };
        w.onerror = (e) => { e.preventDefault(); this._kill(`Lỗi trình chạy bot: ${e.message || 'không rõ'}`); };
        this.worker = w;
        return w;
    };

    BotWorker.prototype._kill = function (reason) {
        if (this.worker) { this.worker.terminate(); this.worker = null; }
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.fail(reason); }
        this.pending.clear();
    };

    /** One move. Always resolves: { move, logs, error, elapsed }. */
    BotWorker.prototype.run = function (code, state, timeoutMs) {
        const limit = timeoutMs || 3000;
        return new Promise((resolve) => {
            const id = ++this.seq;
            const p = {
                resolve,
                fail: (reason) => resolve({ move: null, logs: [], error: reason, elapsed: limit }),
                timer: setTimeout(() => this._kill(`Bot không trả lời trong ${limit}ms (vòng lặp vô hạn hoặc tính quá lâu?)`), limit)
            };
            this.pending.set(id, p);
            this._spawn().postMessage({ type: 'move', id, code, state });
        });
    };

    /**
     * Many games in the worker. onGame(result, index) per finished game. Resolves { ok } or { ok:false, error }.
     * If a single game takes longer than gameTimeoutMs the worker is killed (a bot that never returns).
     */
    BotWorker.prototype.simulate = function (opts, onGame, gameTimeoutMs) {
        const limit = gameTimeoutMs || 20000;
        return new Promise((resolve) => {
            const id = ++this.seq;
            const p = {
                resolve, onGame,
                fail: (reason) => resolve({ ok: false, error: reason }),
                timer: null,
                touch: () => { clearTimeout(p.timer); p.timer = setTimeout(() => this._kill(`Một ván mô phỏng chạy quá ${limit / 1000}s — bot bị treo?`), limit); }
            };
            p.touch();
            this.pending.set(id, p);
            this._spawn().postMessage(Object.assign({ type: 'simulate', id }, opts));
        });
    };

    BotWorker.prototype.cancel = function () { this._kill('Đã hủy'); };

    window.BotWorker = BotWorker;
})(window);
