'use strict';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert');
const T = require('../tournament');
const E = require('../engine');

test('seedOrder produces standard bracket seeding', () => {
    assert.deepStrictEqual(T.seedOrder(2), [1, 2]);
    assert.deepStrictEqual(T.seedOrder(4), [1, 4, 2, 3]);
    assert.deepStrictEqual(T.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
    assert.strictEqual(T.seedOrder(16).length, 16);
});

test('roundRobinRounds: everyone meets everyone exactly once (even and odd)', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
        const ids = Array.from({ length: n }, (_, i) => i + 1);
        const seen = new Set();
        const rounds = T.roundRobinRounds(ids);
        for (const pairs of rounds) {
            const inRound = new Set();
            for (const [a, b] of pairs) {
                const key = [a, b].sort().join('-');
                assert.ok(!seen.has(key), `duplicate pair ${key} for n=${n}`);
                seen.add(key);
                assert.ok(!inRound.has(a) && !inRound.has(b), 'player twice in one round');
                inRound.add(a); inRound.add(b);
            }
        }
        assert.strictEqual(seen.size, n * (n - 1) / 2, `n=${n}`);
    }
});

test('snakeGroups spreads seeds evenly', () => {
    const g = T.snakeGroups([1, 2, 3, 4, 5, 6, 7, 8], 2);
    assert.deepStrictEqual(g, [[1, 4, 5, 8], [2, 3, 6, 7]]);
    const g3 = T.snakeGroups([1, 2, 3, 4, 5, 6, 7], 3);
    assert.deepStrictEqual(g3.map(x => x.length), [3, 2, 2]);
});

test('decideSeries: clinch, ties and sudden death', () => {
    const base = { best_of: 3, wins_a: 0, wins_b: 0, draws: 0, games_played: 0 };
    assert.strictEqual(T.decideSeries(base, true), null);
    assert.deepStrictEqual(T.decideSeries({ ...base, wins_a: 2, games_played: 2 }, true), { winner: 'a', by: 'score' });
    assert.deepStrictEqual(T.decideSeries({ ...base, wins_b: 2, wins_a: 1, games_played: 3 }, true), { winner: 'b', by: 'score' });
    // 1-1 with a draw -> knockout needs another game, table play ends as a tie
    const tied = { ...base, wins_a: 1, wins_b: 1, draws: 1, games_played: 3 };
    assert.strictEqual(T.decideSeries(tied, true), null);
    assert.deepStrictEqual(T.decideSeries(tied, false), { winner: null, by: 'tie' });
    assert.deepStrictEqual(T.decideSeries({ ...tied, games_played: 7 }, true), { winner: 'seed', by: 'tiebreak' });
    // best_of 2 in a table: 1-0 is not decided until both games are played
    assert.strictEqual(T.decideSeries({ best_of: 2, wins_a: 1, wins_b: 0, draws: 0, games_played: 1 }, false), null);
});

test('computeStandings: points, tiebreaks and ranks', () => {
    const entries = [1, 2, 3].map(id => ({ id, name: 'P' + id, seed: id }));
    const series = [
        { entry_a: 1, entry_b: 2, wins_a: 1, wins_b: 1, draws: 0, winner_entry: null, status: 'done' },  // tie
        { entry_a: 1, entry_b: 3, wins_a: 2, wins_b: 0, draws: 0, winner_entry: 1, status: 'done' },
        { entry_a: 2, entry_b: 3, wins_a: 2, wins_b: 0, draws: 0, winner_entry: 2, status: 'done' },
        { entry_a: 2, entry_b: 3, wins_a: 0, wins_b: 0, draws: 0, winner_entry: null, status: 'ready' } // ignored
    ];
    const st = T.computeStandings(entries, series);
    assert.deepStrictEqual(st.map(r => r.entryId), [1, 2, 3]);
    assert.deepStrictEqual(st.map(r => r.points), [4, 4, 0]);
    assert.strictEqual(st[0].gameDiff, 2);
    assert.strictEqual(st[0].rank, 1);
});

test('engine: replayAndValidate rejects illegal / out-of-turn moves and derives the winner', () => {
    const board = E.createInitialBoard();
    const first = E.getLegalMoves(1, board)[0];
    const ok = E.replayAndValidate([{ player: 1, from: first.from, to: first.to }].concat([]), E.resolveRules({ maxPlies: 1 }));
    assert.ok(ok.ok && ok.winner === 'draw');           // limit of 1 ply -> draw

    const wrongTurn = E.replayAndValidate([{ player: 2, from: first.from, to: first.to }]);
    assert.strictEqual(wrongTurn.ok, false);

    const illegal = E.replayAndValidate([{ player: 1, from: { r: 0, c: 0 }, to: { r: 5, c: 5 } }]);
    assert.strictEqual(illegal.ok, false);
});
