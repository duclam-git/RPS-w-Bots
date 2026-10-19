// ===== OTTv2 Code Arena - Multi-Language Bot Starter Templates =====

(function (window) {
    'use strict';

    // C++ starter code. Written with String.raw so backslashes (\" and friends) reach the editor
    // untouched - inside a normal template literal they would be silently eaten and the code would
    // not compile.
    function cppTemplate(o) {
        return String.raw`/**
 * %ICON% %NAME% BOT (C++17)
 * Mục tiêu: Đưa quân tới ô đích %GOALNAME% (r=%GOALR%, c=%GOALC%) để chiến thắng!
 * Giao thức: Đọc JSON state từ stdin, in JSON nước đi ra stdout.
 */
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

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

// ---------- Đọc JSON tối giản (không cần thư viện ngoài) ----------

// Trả về đoạn "[ ... ]" của một khoá, ví dụ "legalMoves":[ ... ]
std::string extractArray(const std::string& s, const std::string& key) {
    size_t k = s.find("\"" + key + "\"");
    if (k == std::string::npos) return "";
    size_t b = s.find('[', k);
    if (b == std::string::npos) return "";
    int depth = 0;
    for (size_t i = b; i < s.size(); i++) {
        if (s[i] == '[') depth++;
        else if (s[i] == ']' && --depth == 0) return s.substr(b, i - b + 1);
    }
    return "";
}

// Đọc số nguyên đứng sau khoá, tìm từ vị trí pos rồi dịch pos tới sau khoá đó
bool readInt(const std::string& s, const std::string& key, size_t& pos, int& out) {
    size_t k = s.find("\"" + key + "\"", pos);
    if (k == std::string::npos) return false;
    size_t colon = s.find(':', k);
    if (colon == std::string::npos) return false;
    out = std::atoi(s.c_str() + colon + 1);
    pos = colon + 1;
    return true;
}

// Chỉ đọc mảng legalMoves (không đọc nhầm moveHistory cũng có from/to)
std::vector<Move> parseLegalMoves(const std::string& input) {
    std::vector<Move> moves;
    const std::string arr = extractArray(input, "legalMoves");
    size_t pos = 0;
    while (true) {
        size_t f = arr.find("\"from\"", pos);
        if (f == std::string::npos) break;
        Move m;
        size_t p = f;
        if (!readInt(arr, "r", p, m.from.r) || !readInt(arr, "c", p, m.from.c) ||
            !readInt(arr, "r", p, m.to.r) || !readInt(arr, "c", p, m.to.c)) break;
        size_t nextFrom = arr.find("\"from\"", p);
        size_t cap = arr.find("\"capture\"", p);
        if (cap != std::string::npos && (nextFrom == std::string::npos || cap < nextFrom)) {
            size_t colon = arr.find(':', cap);
            size_t v = arr.find_first_not_of(" ", colon + 1);
            m.hasCapture = (v != std::string::npos && arr[v] != 'n');  // "null" = không ăn quân
        }
        moves.push_back(m);
        pos = p;
    }
    return moves;
}

void printMove(const Move& m) {
    std::cout << "{\"from\":{\"r\":" << m.from.r << ",\"c\":" << m.from.c
              << "},\"to\":{\"r\":" << m.to.r << ",\"c\":" << m.to.c << "}}" << std::endl;
}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    // Đích của Đội %TEAM%: %GOALNAME% -> {r: %GOALR%, c: %GOALC%} (cũng có trong state.myGoal)
    Coord myGoal{%GOALR%, %GOALC%};
    size_t gp = input.find("\"myGoal\"");
    if (gp != std::string::npos) {
        readInt(input, "r", gp, myGoal.r);
        readInt(input, "c", gp, myGoal.c);
    }

    std::vector<Move> legalMoves = parseLegalMoves(input);
    if (legalMoves.empty()) return 0;  // không có nước nào -> server sẽ chọn dự phòng

    // 1. Thắng ngay nếu chạm đích %GOALNAME%
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            printMove(m);
            return 0;
        }
    }

    // 2. Ưu tiên ăn quân (nếu có), rồi chọn nước tiến gần đích nhất
    std::stable_sort(legalMoves.begin(), legalMoves.end(), [&](const Move& a, const Move& b) {
        if (a.hasCapture != b.hasCapture) return a.hasCapture;
        return distance(a.to.r, a.to.c, myGoal.r, myGoal.c) < distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
    });

    printMove(legalMoves.front());
    return 0;
}`
            .replace(/%ICON%/g, o.icon).replace(/%NAME%/g, o.name).replace(/%TEAM%/g, o.team)
            .replace(/%GOALNAME%/g, o.goalName).replace(/%GOALR%/g, o.goalR).replace(/%GOALC%/g, o.goalC);
    }

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
            blue: cppTemplate({
                icon: '🔵', name: 'BLUE', team: 'Xanh', goalName: 'I9', goalR: 0, goalC: 8
            }),
            red: cppTemplate({
                icon: '🔴', name: 'RED', team: 'Đỏ', goalName: 'A1', goalR: 8, goalC: 0
            })
        }
    };

})(window);
