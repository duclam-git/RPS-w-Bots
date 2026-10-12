// ===== OTTv2 Code Arena - Multi-Language Bot Starter Templates =====

(function (window) {
    'use strict';

    window.MULTI_LANG_TEMPLATES = {
        // ==========================================
        // 1. JAVASCRIPT TEMPLATES
        // ==========================================
        javascript: {
            blue: `/**
 * 🔵 BLUE BOT (JavaScript)
 * Mục tiêu: Đưa bất kỳ quân nào tới ô đích I9 (r=0, c=8) để chiến thắng!
 */
function getNextMove(state, helpers, log) {
    const { legalMoves, myGoal } = state;

    // 1. Chiến thắng ngay nếu có nước đi chạm ô đích I9
    const winMove = legalMoves.find(m => m.to.r === myGoal.r && m.to.c === myGoal.c);
    if (winMove) {
        log("🏆 Về đích I9 chiến thắng!", winMove.notation);
        return winMove;
    }

    // 2. Ưu tiên ăn quân cản đường
    const captureMoves = legalMoves.filter(m => m.capture !== null);
    if (captureMoves.length > 0) {
        captureMoves.sort((a, b) => {
            const dA = helpers.distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
            const dB = helpers.distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
            return dA - dB;
        });
        log("⚔️ Tiêu diệt quân địch cản đường:", captureMoves[0].notation);
        return captureMoves[0];
    }

    // 3. Tiến gần nhất về phía đích I9 (khoảng cách Chebyshev)
    const sorted = [...legalMoves].sort((a, b) => {
        const dA = helpers.distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
        const dB = helpers.distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
        return dA - dB;
    });

    log("Tiến về I9:", sorted[0].notation);
    return sorted[0];
}`,
            red: `/**
 * 🔴 RED BOT (JavaScript)
 * Mục tiêu: Đưa bất kỳ quân nào tới ô đích A1 (r=8, c=0) để chiến thắng!
 */
function getNextMove(state, helpers, log) {
    const { legalMoves, myGoal, board, opponentPlayer } = state;

    // 1. Chiến thắng ngay nếu chạm đích A1
    const winMove = legalMoves.find(m => m.to.r === myGoal.r && m.to.c === myGoal.c);
    if (winMove) {
        log("🏆 Chạm đích A1 chiến thắng!", winMove.notation);
        return winMove;
    }

    // 2. Đánh giá điểm số từng nước đi
    let bestMove = legalMoves[0];
    let bestScore = -Infinity;

    for (const move of legalMoves) {
        let score = 0;
        const curDist = helpers.distance(move.from.r, move.from.c, myGoal.r, myGoal.c);
        const newDist = helpers.distance(move.to.r, move.to.c, myGoal.r, myGoal.c);
        score += (curDist - newDist) * 35; // Rút ngắn cự ly

        if (move.capture) score += 100; // Thưởng ăn quân

        const simBoard = helpers.simulateMove(board, move);
        const oppMoves = helpers.getLegalMoves(opponentPlayer, simBoard);
        if (oppMoves.some(em => em.to.r === move.to.r && em.to.c === move.to.c)) {
            score -= 75; // Trừ điểm nếu bị đối phương ăn lại
        }

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    log("Đội Đỏ chọn nước:", bestMove.notation);
    return bestMove;
}`
        },

        // ==========================================
        // 2. PYTHON TEMPLATES
        // ==========================================
        python: {
            blue: `"""
🔵 BLUE BOT (Python 3)
Mục tiêu: Đưa quân tới ô đích I9 (r=0, c=8) để chiến thắng!
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
"""
import sys
import json
import math

def distance(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    my_goal = state.get("myGoal", {"r": 0, "c": 8})
    
    if not legal_moves:
        return None

    # 1. Thắng ngay nếu chạm đích I9
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    # 2. Ưu tiên ăn quân đối phương
    captures = [m for m in legal_moves if m.get("capture") is not None]
    if captures:
        captures.sort(key=lambda m: distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
        return captures[0]

    # 3. Tiến gần nhất về phía đích I9
    legal_moves.sort(key=lambda m: distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
    return legal_moves[0]

if __name__ == "__main__":
    raw_input = sys.stdin.read()
    if raw_input.strip():
        state = json.loads(raw_input)
        chosen_move = get_next_move(state)
        if chosen_move:
            print(json.dumps({
                "from": chosen_move["from"],
                "to": chosen_move["to"]
            }))
`,
            red: `"""
🔴 RED BOT (Python 3)
Mục tiêu: Đưa quân tới ô đích A1 (r=8, c=0) để chiến thắng!
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
"""
import sys
import json
import math

def distance(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    my_goal = state.get("myGoal", {"r": 8, "c": 0})
    
    if not legal_moves:
        return None

    # 1. Thắng ngay nếu chạm đích A1
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    # 2. Đánh giá điểm số di chuyển
    best_move = legal_moves[0]
    best_score = -float('inf')

    for m in legal_moves:
        score = 0
        cur_dist = distance(m["from"]["r"], m["from"]["c"], my_goal["r"], my_goal["c"])
        new_dist = distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"])
        score += (cur_dist - new_dist) * 40

        if m.get("capture") is not None:
            score += 100

        if score > best_score:
            best_score = score
            best_move = m

    return best_move

if __name__ == "__main__":
    raw_input = sys.stdin.read()
    if raw_input.strip():
        state = json.loads(raw_input)
        chosen_move = get_next_move(state)
        if chosen_move:
            print(json.dumps({
                "from": chosen_move["from"],
                "to": chosen_move["to"]
            }))
`
        },

        // ==========================================
        // 3. C++ TEMPLATES (C++17 Compatible, Zero external dependencies)
        // ==========================================
        cpp: {
            blue: `/**
 * 🔵 BLUE BOT (C++17)
 * Mục tiêu: Đưa quân tới ô đích I9 (r=0, c=8) để chiến thắng!
 * Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
 */
#include <iostream>
#include <string>
#include <vector>
#include <cmath>
#include <algorithm>
#include <regex>

struct Coord {
    int r = 0;
    int c = 0;
};

struct Move {
    Coord from;
    Coord to;
    bool hasCapture = false;
};

int distance(int r1, int c1, int r2, int c2) {
    return std::max(std::abs(r1 - r2), std::abs(c1 - c2));
}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)),
                      std::istreambuf_iterator<char>());

    if (input.empty()) return 0;

    // Đích của Đội Xanh: I9 -> {r: 0, c: 8}
    Coord myGoal{0, 8};

    // Parser regex tìm các nước đi hợp lệ từ legalMoves JSON
    std::vector<Move> legalMoves;
    std::regex moveRegex(R"(\"from\":\{\"r\":(\d+),\"c\":(\d+)\},\"to\":\{\"r\":(\d+),\"c\":(\d+)\})");
    auto words_begin = std::sregex_iterator(input.begin(), input.end(), moveRegex);
    auto words_end = std::sregex_iterator();

    for (std::sregex_iterator i = words_begin; i != words_end; ++i) {
        std::smatch match = *i;
        Move m;
        m.from.r = std::stoi(match[1].str());
        m.from.c = std::stoi(match[2].str());
        m.to.r   = std::stoi(match[3].str());
        m.to.c   = std::stoi(match[4].str());
        legalMoves.push_back(m);
    }

    if (legalMoves.empty()) {
        std::cout << "{\"from\":{\"r\":0,\"c\":0},\"to\":{\"r\":0,\"c\":0}}" << std::endl;
        return 0;
    }

    // 1. Thắng ngay nếu chạm đích I9
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            std::cout << "{\"from\":{\"r\":" << m.from.r << ",\"c\":" << m.from.c 
                      << "},\"to\":{\"r\":" << m.to.r << ",\"c\":" << m.to.c << "}}" << std::endl;
            return 0;
        }
    }

    // 2. Tìm nước tiến gần đích nhất
    std::sort(legalMoves.begin(), legalMoves.end(), [&](const Move& a, const Move& b) {
        int dA = distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
        int dB = distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
        return dA < dB;
    });

    const Move& best = legalMoves.front();
    std::cout << "{\"from\":{\"r\":" << best.from.r << ",\"c\":" << best.from.c 
              << "},\"to\":{\"r\":" << best.to.r << ",\"c\":" << best.to.c << "}}" << std::endl;

    return 0;
}`,
            red: `/**
 * 🔴 RED BOT (C++17)
 * Mục tiêu: Đưa quân tới ô đích A1 (r=8, c=0) để chiến thắng!
 * Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
 */
#include <iostream>
#include <string>
#include <vector>
#include <cmath>
#include <algorithm>
#include <regex>

struct Coord {
    int r = 0;
    int c = 0;
};

struct Move {
    Coord from;
    Coord to;
};

int distance(int r1, int c1, int r2, int c2) {
    return std::max(std::abs(r1 - r2), std::abs(c1 - c2));
}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)),
                      std::istreambuf_iterator<char>());

    if (input.empty()) return 0;

    // Đích của Đội Đỏ: A1 -> {r: 8, c: 0}
    Coord myGoal{8, 0};

    std::vector<Move> legalMoves;
    std::regex moveRegex(R"(\"from\":\{\"r\":(\d+),\"c\":(\d+)\},\"to\":\{\"r\":(\d+),\"c\":(\d+)\})");
    auto words_begin = std::sregex_iterator(input.begin(), input.end(), moveRegex);
    auto words_end = std::sregex_iterator();

    for (std::sregex_iterator i = words_begin; i != words_end; ++i) {
        std::smatch match = *i;
        Move m;
        m.from.r = std::stoi(match[1].str());
        m.from.c = std::stoi(match[2].str());
        m.to.r   = std::stoi(match[3].str());
        m.to.c   = std::stoi(match[4].str());
        legalMoves.push_back(m);
    }

    if (legalMoves.empty()) {
        std::cout << "{\"from\":{\"r\":0,\"c\":0},\"to\":{\"r\":0,\"c\":0}}" << std::endl;
        return 0;
    }

    // 1. Thắng ngay nếu chạm đích A1
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            std::cout << "{\"from\":{\"r\":" << m.from.r << ",\"c\":" << m.from.c 
                      << "},\"to\":{\"r\":" << m.to.r << ",\"c\":" << m.to.c << "}}" << std::endl;
            return 0;
        }
    }

    // 2. Tìm nước tiến gần đích nhất
    std::sort(legalMoves.begin(), legalMoves.end(), [&](const Move& a, const Move& b) {
        int dA = distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
        int dB = distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
        return dA < dB;
    });

    const Move& best = legalMoves.front();
    std::cout << "{\"from\":{\"r\":" << best.from.r << ",\"c\":" << best.from.c 
              << "},\"to\":{\"r\":" << best.to.r << ",\"c\":" << best.to.c << "}}" << std::endl;

    return 0;
}`
        }
    };

})(window);
