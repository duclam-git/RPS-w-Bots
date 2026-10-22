// ===== OTTv2 Code Arena - Cờ Caro: strategy bots with sample code =====
// Each strategy is a complete, copy-paste-able bot. The Caro page offers them as opponents ("Bot có sẵn") and as
// starting code in the editor; the tournament form gets them through GAME_TEMPLATES.caro (bot_templates.js).
// Same contract everywhere: getNextMove(state, helpers, log) -> { to: { r, c } } (JS); Python / C++ read the JSON
// state on stdin and print {"to":{"r":R,"c":C}}.
(function (window) {
    'use strict';

    // ------------------------------------------------------------------ JavaScript
    const jsRandom = String.raw`/**
 * 🎲 BOT NGẪU NHIÊN — Cờ Caro (JavaScript)
 * Chiến thuật: chọn bừa một ô trống. Dùng làm đối thủ yếu nhất để thử bot của bạn.
 * state.legalMoves: mọi ô trống, dạng { to: { r, c } }
 */
function getNextMove(state, helpers, log) {
    const move = helpers.randomChoice(state.legalMoves);
    log('Ngẫu nhiên:', move.to);
    return move;
}`;

    const jsCenter = String.raw`/**
 * 🎯 BOT GIỮ TRUNG TÂM — Cờ Caro (JavaScript)
 * Chiến thuật vị trí: đánh gần trung tâm và sát các quân của mình để có nhiều hướng phát triển.
 * Không đọc thế cờ của đối thủ (nên dễ bị thua bởi bot biết chặn) — ví dụ về hàm đánh giá đơn giản.
 */
function getNextMove(state, helpers, log) {
    const grid = state.grid.map(row => row.split('').map(Number));
    const N = grid.length, me = state.myPlayer;
    const mid = (N - 1) / 2;
    let best = null, bestScore = -Infinity;
    for (const m of state.legalMoves) {
        const { r, c } = m.to;
        let s = -(Math.abs(r - mid) + Math.abs(c - mid));          // càng gần tâm càng tốt
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if ((dr || dc) && rr >= 0 && cc >= 0 && rr < N && cc < N && grid[rr][cc] === me) s += 3;   // cạnh quân mình
        }
        if (s > bestScore) { bestScore = s; best = m; }
    }
    log('Trung tâm:', best.to, 'điểm', bestScore.toFixed(1));
    return best;
}`;

    // Shared heuristic, written out in each sample so every sample stays a standalone file.
    const jsHeuristic = (title, idea, attack, defend) => String.raw`/**
 * ${title} — Cờ Caro (JavaScript)
 * ${idea}
 * Cách chấm điểm một ô: thử đặt quân vào ô đó, đếm chuỗi liên tiếp dài nhất theo 4 hướng và số đầu còn trống.
 *   điểm = ATTACK × (thế của mình nếu đặt ở đây) + DEFEND × (thế của đối thủ nếu họ đặt ở đây)
 * Đổi ATTACK / DEFEND để có tính cách khác: tấn công, phòng thủ, cân bằng.
 */
const ATTACK = ${attack};
const DEFEND = ${defend};

function getNextMove(state, helpers, log) {
    const grid = state.grid.map(row => row.split('').map(Number));
    const N = grid.length, me = state.myPlayer, opp = state.opponentPlayer, W = state.winLength;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

    // Nếu đặt quân p vào (r, c): chuỗi dài bao nhiêu và có mấy đầu còn mở?
    function line(r, c, p, dr, dc) {
        let n = 1, open = 0;
        for (const s of [1, -1]) {
            for (let i = 1; ; i++) {
                const rr = r + s * dr * i, cc = c + s * dc * i;
                if (rr < 0 || cc < 0 || rr >= N || cc >= N) break;
                if (grid[rr][cc] === p) n++;
                else { if (grid[rr][cc] === 0) open++; break; }
            }
        }
        return { n, open };
    }
    function score(r, c, p) {
        let total = 0;
        for (const [dr, dc] of dirs) {
            const { n, open } = line(r, c, p, dr, dc);
            if (n >= W) total += 1e7;                                       // thắng ngay / chặn thua ngay
            else if (n === W - 1 && open === 2) total += 1e5;               // "bốn mở": gần như chắc thắng
            else total += [0, 1, 10, 100, 1000, 10000][Math.min(n, 5)] * (open === 2 ? 2 : open === 1 ? 1 : 0.1);
        }
        return total;
    }

    const mid = (N - 1) / 2;
    let best = null, bestScore = -Infinity;
    for (const m of state.legalMoves) {
        const { r, c } = m.to;
        const mine = score(r, c, me), theirs = score(r, c, opp);
        // thắng ngay luôn ưu tiên nhất, rồi mới đến chặn thua ngay
        const s = (mine >= 1e7 ? 1e9 : 0) + ATTACK * mine + DEFEND * theirs - (Math.abs(r - mid) + Math.abs(c - mid)) * 0.01;
        if (s > bestScore) { bestScore = s; best = m; }
    }
    log('chọn', best.to, 'điểm', Math.round(bestScore));
    return best;
}`;

    const jsDefensive = jsHeuristic('🛡 BOT PHÒNG THỦ', 'Chiến thuật: ưu tiên phá thế của đối thủ (chặn chuỗi 3, 4) rồi mới tính chuyện tấn công.', 0.6, 1.6);
    const jsAttacker = jsHeuristic('⚔️ BOT TẤN CÔNG', 'Chiến thuật: ưu tiên kéo dài chuỗi của mình, chỉ chặn khi đối thủ dọa thắng.', 1.8, 0.8);
    const jsBalanced = jsHeuristic('⚖️ BOT CÂN BẰNG', 'Chiến thuật: cân bằng giữa tấn công và phòng thủ (mẫu mặc định).', 1.1, 1.0);

    const jsMinimax = String.raw`/**
 * 🧠 BOT MINIMAX (cắt tỉa alpha-beta) — Cờ Caro (JavaScript)
 * Chiến thuật: nhìn trước vài nước. Ở mỗi lượt chỉ xét các ô "đáng chú ý" (gần quân đã có, điểm heuristic cao),
 * giả lập nước đi bằng helpers.simulateMove, rồi chọn nước tốt nhất khi đối thủ cũng đi tốt nhất.
 * Chỉnh DEPTH (độ sâu) và WIDTH (số ô xét mỗi lượt) — càng lớn càng mạnh nhưng càng chậm (giới hạn ~2.5 giây/nước).
 */
const DEPTH = 3;
const WIDTH = 10;
const DEFENSE = 1.0;     // > 1: coi thế của đối thủ nguy hiểm hơn thế của mình; < 1: liều lĩnh hơn

function getNextMove(state, helpers, log) {
    const N = state.rules.rows, W = state.winLength, me = state.myPlayer, opp = state.opponentPlayer;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const WEIGHT = [0, 1, 10, 100, 1000, 10000];
    const cell = (b, r, c) => (r < 0 || c < 0 || r >= N || c >= N ? -1 : (b[r][c] ? b[r][c].player : 0));

    function line(b, r, c, p, dr, dc) {
        let n = 1, open = 0;
        for (const s of [1, -1]) {
            for (let i = 1; ; i++) {
                const v = cell(b, r + s * dr * i, c + s * dc * i);
                if (v === p) n++; else { if (v === 0) open++; break; }
            }
        }
        return { n, open };
    }
    // giá trị của việc đặt quân p vào ô trống (r, c)
    function cellScore(b, r, c, p) {
        let t = 0;
        for (const [dr, dc] of dirs) {
            const { n, open } = line(b, r, c, p, dr, dc);
            t += n >= W ? 1e7 : WEIGHT[Math.min(n, 5)] * (open === 2 ? 2 : open === 1 ? 1 : 0.1);
        }
        return t;
    }
    // các ô trống trong bán kính 1 quanh quân đã có, sắp theo điểm tấn công + phòng thủ
    function candidates(b, p) {
        const q = p === 1 ? 2 : 1, out = [];
        let any = false;
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
            if (b[r][c]) { any = true; continue; }
            let near = false;
            for (let dr = -1; dr <= 1 && !near; dr++) for (let dc = -1; dc <= 1; dc++) if (cell(b, r + dr, c + dc) > 0) { near = true; break; }
            if (near) out.push({ r, c, s: cellScore(b, r, c, p) * 1.1 + cellScore(b, r, c, q) });
        }
        if (!any) return [{ r: Math.floor(N / 2), c: Math.floor(N / 2), s: 0 }];
        return out.sort((a, b2) => b2.s - a.s).slice(0, WIDTH);
    }
    // đánh giá cả bàn: xét mọi "cửa sổ" W ô liên tiếp (ngang, dọc, chéo). Cửa sổ chỉ có quân của một bên
    // là cơ hội của bên đó: càng nhiều quân trong cửa sổ, điểm tăng theo cấp số nhân (8^số quân).
    function evaluate(b) {
        let total = 0;
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
            for (const [dr, dc] of dirs) {
                const er = r + dr * (W - 1), ec = c + dc * (W - 1);
                if (er < 0 || ec < 0 || er >= N || ec >= N) continue;
                let mine = 0, theirs = 0;
                for (let i = 0; i < W; i++) {
                    const v = cell(b, r + dr * i, c + dc * i);
                    if (v === me) mine++; else if (v === opp) theirs++;
                }
                if (mine && !theirs) total += Math.pow(8, mine);
                else if (theirs && !mine) total -= Math.pow(8, theirs) * DEFENSE;
            }
        }
        return total;
    }
    function search(b, depth, alpha, beta, player) {
        const res = helpers.checkWin(b);
        if (res.winner === me) return 1e9 + depth;              // thắng càng sớm càng tốt
        if (res.winner === opp) return -1e9 - depth;
        if (res.winner === 'draw') return 0;
        if (depth === 0) return evaluate(b);
        for (const m of candidates(b, player)) {
            const v = search(helpers.simulateMove(b, { to: m }, player), depth - 1, alpha, beta, player === 1 ? 2 : 1);
            if (player === me) alpha = Math.max(alpha, v); else beta = Math.min(beta, v);
            if (alpha >= beta) break;                             // cắt tỉa: nhánh này không thể tốt hơn
        }
        return player === me ? alpha : beta;
    }

    let best = null, bestValue = -Infinity;
    for (const m of candidates(state.board, me)) {
        const v = search(helpers.simulateMove(state.board, { to: m }, me), DEPTH - 1, bestValue, Infinity, opp);
        if (v > bestValue || !best) { bestValue = v; best = m; }
    }
    log('minimax chọn', { r: best.r, c: best.c }, 'giá trị', Math.round(bestValue));
    return { to: { r: best.r, c: best.c } };
}`;

    // ------------------------------------------------------------------ Python
    const pyRandom = String.raw`"""
BOT NGẪU NHIÊN - Cờ Caro (Python 3)
Chiến thuật: chọn bừa một ô trống.
In ra một dòng JSON: {"to": {"r": r, "c": c}}.  Ghi log: in ra stderr.
"""
import json
import random
import sys

state = json.loads(sys.stdin.read())
move = random.choice(state["legalMoves"])
sys.stderr.write("ngau nhien %s\n" % move["to"])
print(json.dumps({"to": move["to"]}))
`;

    const pyHeuristic = (title, idea, attack, defend) => String.raw`"""
${title} - Cờ Caro (Python 3)
${idea}
Chấm điểm từng ô trống: ATTACK x (thế của mình nếu đặt ở đó) + DEFEND x (thế của đối thủ nếu họ đặt ở đó).
In ra một dòng JSON: {"to": {"r": r, "c": c}}.  Ghi log: in ra stderr.
"""
import json
import sys

ATTACK = ${attack}
DEFEND = ${defend}
WEIGHTS = [0, 1, 10, 100, 1000, 10000]


def line(grid, size, r, c, p, dr, dc):
    n, open_ends = 1, 0
    for s in (1, -1):
        i = 1
        while True:
            rr, cc = r + s * dr * i, c + s * dc * i
            if rr < 0 or cc < 0 or rr >= size or cc >= size:
                break
            if grid[rr][cc] == p:
                n += 1
                i += 1
            else:
                if grid[rr][cc] == 0:
                    open_ends += 1
                break
    return n, open_ends


def score(grid, size, w, r, c, p):
    total = 0.0
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        n, open_ends = line(grid, size, r, c, p, dr, dc)
        if n >= w:
            total += 1e7
        elif n == w - 1 and open_ends == 2:
            total += 1e5
        else:
            total += WEIGHTS[min(n, 5)] * (2 if open_ends == 2 else 1 if open_ends == 1 else 0.1)
    return total


def main():
    state = json.loads(sys.stdin.read())
    grid = [[int(ch) for ch in row] for row in state["grid"]]
    size, me, opp, w = len(grid), state["myPlayer"], state["opponentPlayer"], state["winLength"]
    mid = (size - 1) / 2
    best, best_score = None, float("-inf")
    for m in state["legalMoves"]:
        r, c = m["to"]["r"], m["to"]["c"]
        mine = score(grid, size, w, r, c, me)
        s = (1e9 if mine >= 1e7 else 0) + ATTACK * mine + DEFEND * score(grid, size, w, r, c, opp) - (abs(r - mid) + abs(c - mid)) * 0.01
        if s > best_score:
            best, best_score = m, s
    sys.stderr.write("chon %s diem %d\n" % (best["to"], best_score))
    print(json.dumps({"to": best["to"]}))


main()
`;

    // ------------------------------------------------------------------ C++
    const cppRandom = String.raw`/**
 * BOT NGẪU NHIÊN - Cờ Caro (C++17)
 * Đọc "grid" từ JSON (mảng chuỗi '0' trống, '1' Xanh, '2' Đỏ), chọn bừa một ô trống.
 * stdout: {"to":{"r":R,"c":C}}      stderr: log
 */
#include <iostream>
#include <iterator>
#include <random>
#include <string>
#include <vector>

int main() {
    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    size_t k = input.find("\"grid\"");
    if (k == std::string::npos) return 0;
    size_t b = input.find('[', k), e = input.find(']', b);
    std::vector<std::string> rows;
    for (size_t p = b; p < e;) {
        size_t q1 = input.find('"', p);
        if (q1 == std::string::npos || q1 > e) break;
        size_t q2 = input.find('"', q1 + 1);
        rows.push_back(input.substr(q1 + 1, q2 - q1 - 1));
        p = q2 + 1;
    }
    std::vector<std::pair<int, int>> empty;
    for (int r = 0; r < (int)rows.size(); r++)
        for (int c = 0; c < (int)rows[r].size(); c++)
            if (rows[r][c] == '0') empty.push_back({r, c});
    if (empty.empty()) return 0;
    std::mt19937 rng(std::random_device{}());
    auto m = empty[rng() % empty.size()];
    std::cerr << "ngau nhien " << m.first << "," << m.second << std::endl;
    std::cout << "{\"to\":{\"r\":" << m.first << ",\"c\":" << m.second << "}}" << std::endl;
    return 0;
}`;

    const base = (window.GAME_TEMPLATES && window.GAME_TEMPLATES.caro) || {};
    const cppBalanced = base.cpp ? base.cpp.blue : null;

    /** id -> { name, level, idea, code: { javascript, python?, cpp? } }  (ordered weakest -> strongest) */
    window.CARO_STRATEGIES = {
        random: { name: '🎲 Ngẫu nhiên', level: 1, idea: 'Đặt bừa một ô trống. Đối thủ yếu nhất, dùng để thử bot.', code: { javascript: jsRandom, python: pyRandom, cpp: cppRandom } },
        center: { name: '🎯 Giữ trung tâm', level: 2, idea: 'Đánh gần tâm và sát quân mình; không biết chặn đối thủ.', code: { javascript: jsCenter } },
        attacker: { name: '⚔️ Tấn công', level: 3, idea: 'Ưu tiên kéo dài chuỗi của mình, chỉ chặn khi bị dọa thắng.', code: { javascript: jsAttacker, python: pyHeuristic('BOT TẤN CÔNG', 'Chiến thuật: ưu tiên kéo dài chuỗi của mình.', 1.8, 0.8) } },
        defender: { name: '🛡 Phòng thủ', level: 3, idea: 'Ưu tiên phá chuỗi 3, chuỗi 4 của đối thủ rồi mới tấn công.', code: { javascript: jsDefensive, python: pyHeuristic('BOT PHÒNG THỦ', 'Chiến thuật: ưu tiên chặn thế của đối thủ.', 0.6, 1.6) } },
        balanced: { name: '⚖️ Cân bằng', level: 4, idea: 'Chấm điểm từng ô theo cả tấn công lẫn phòng thủ (mẫu mặc định).', code: { javascript: jsBalanced, python: pyHeuristic('BOT CÂN BẰNG', 'Chiến thuật: cân bằng tấn công và phòng thủ.', 1.1, 1.0), cpp: cppBalanced } },
        minimax: { name: '🧠 Minimax α-β', level: 5, idea: 'Nhìn trước 3 nước với cắt tỉa alpha-beta trên các ô đáng chú ý.', code: { javascript: jsMinimax } }
    };
})(window);
