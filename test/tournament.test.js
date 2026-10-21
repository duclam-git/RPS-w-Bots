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


test('separateGroups: groupmates are pulled apart in round one, seeding is left alone when nothing clashes', () => {
    const q = ['A1', 'B1', 'C1', 'D1', 'D2', 'C2', 'B2', 'A2'];
    const groupOf = Object.fromEntries(q.map(x => [x, x[0]]));
    const slots = T.seedOrder(8).map(seed => q[seed - 1]);
    const before = []; for (let i = 0; i < 8; i += 2) before.push(groupOf[slots[i]] === groupOf[slots[i + 1]]);
    assert.deepStrictEqual(before, [true, true, true, true], 'this is the real-world case that used to produce four rematches');
    const out = T.separateGroups(slots, groupOf);
    for (let i = 0; i < 8; i += 2) assert.notStrictEqual(groupOf[out[i]], groupOf[out[i + 1]], `${out[i]} v ${out[i + 1]}`);
    assert.deepStrictEqual([...out].sort(), [...slots].sort(), 'nobody lost or duplicated');

    const fine = ['A1', 'B2', 'B1', 'A2'];
    const g2 = { A1: 'A', A2: 'A', B1: 'B', B2: 'B' };
    assert.deepStrictEqual(T.separateGroups(fine, g2), fine, 'already fine -> untouched');
    // byes (null) never count as a clash; a single group cannot be separated and is returned intact
    assert.deepStrictEqual(T.separateGroups(['A1', null, 'B1', 'A2'], { A1: 'A', A2: 'A', B1: 'B' }), ['A1', null, 'B1', 'A2']);
    assert.deepStrictEqual(T.separateGroups(['X1', 'X2'], { X1: 'X', X2: 'X' }), ['X1', 'X2']);
});

test('standings: head-to-head beats the seed; cyclic results stay "unresolved"', () => {
    const entries = [['A', 2], ['B', 1], ['C', 3], ['D', 4]].map(([name, seed], i) => ({ id: i + 1, name, seed }));
    const id = (n) => entries.find(e => e.name === n).id;
    const g = (a, b, winner) => ({ entry_a: id(a), entry_b: id(b), wins_a: winner === a ? 1 : 0, wins_b: winner === b ? 1 : 0, draws: 0, winner_entry: id(winner), status: 'done' });
    const st = T.computeStandings(entries, [g('A', 'B', 'A'), g('A', 'C', 'C'), g('A', 'D', 'A'), g('B', 'C', 'B'), g('B', 'D', 'B'), g('C', 'D', 'D')]);
    // A and B are level on points / game difference / games won; B has the better seed but A beat B
    assert.deepStrictEqual(st.map(r => r.name), ['A', 'B', 'D', 'C']);
    assert.ok(!st[0].tied_unresolved, 'head-to-head resolved it');

    const cyc = T.computeStandings(entries.slice(0, 3), [
        { entry_a: 1, entry_b: 2, wins_a: 2, wins_b: 0, draws: 0, winner_entry: 1, status: 'done' },
        { entry_a: 2, entry_b: 3, wins_a: 2, wins_b: 0, draws: 0, winner_entry: 2, status: 'done' },
        { entry_a: 3, entry_b: 1, wins_a: 2, wins_b: 0, draws: 0, winner_entry: 3, status: 'done' }]);
    assert.ok(cyc.every(r => r.tied_unresolved), 'a rock-paper-scissors cycle cannot be resolved by head-to-head');
});
