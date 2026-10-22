// Tiny FIFO counting semaphore (used to cap concurrent bot processes and compilations).
'use strict';

class Semaphore {
    constructor(limit) {
        this.limit = Math.max(1, limit | 0);
        this.active = 0;
        this.maxActive = 0;
        this.queue = [];
    }
    get queued() { return this.queue.length; }
    acquire() {
        if (this.active < this.limit) {
            this.active++;
            this.maxActive = Math.max(this.maxActive, this.active);
            return Promise.resolve();
        }
        return new Promise(resolve => this.queue.push(resolve));
    }
    release() {
        const next = this.queue.shift();
        if (next) next();            // the slot is handed over directly (active stays the same)
        else this.active--;
    }
    async run(fn) {
        await this.acquire();
        try { return await fn(); } finally { this.release(); }
    }
    stats() { return { limit: this.limit, active: this.active, queued: this.queue.length, maxActive: this.maxActive }; }
}

module.exports = { Semaphore };
