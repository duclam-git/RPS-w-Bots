
const fs = require('fs');
function getNextMove(state, helpers, log) { return helpers.randomChoice(state.legalMoves); }

try {
    const input = fs.readFileSync(0, 'utf-8');
    if (input.trim()) {
        const state = JSON.parse(input);
        const helpers = {
            distance: (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)),
            canCapture: (a, b) => {
                const beats = { rock: ['scissors'], paper: ['rock'], scissors: ['paper'] };
                return beats[a] && beats[a].includes(b);
            }
        };
        const log = (...args) => {};
        if (typeof getNextMove === 'function') {
            const move = getNextMove(state, helpers, log);
            if (move && move.from && move.to) {
                console.log(JSON.stringify({ from: move.from, to: move.to }));
            }
        }
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
