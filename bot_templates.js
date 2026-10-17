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
Blue Bot (Python 3)
Muc tieu: Dua quan toi o dich I9 (r=0, c=8) de chien thang!
Giao thuc: Doc JSON state tu stdin, in JSON move ra stdout.
"""
import sys
import json

def distance(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    my_goal = state.get("myGoal", {"r": 0, "c": 8})

    if not legal_moves:
        return None

    # 1. Thang ngay neu cham dich I9
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    # 2. Uu tien an quan doi phuong
    captures = [m for m in legal_moves if m.get("capture") is not None]
    if captures:
        captures.sort(key=lambda m: distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
        return captures[0]

    # 3. Tien gan nhat ve phia dich I9
    legal_moves.sort(key=lambda m: distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
    return legal_moves[0]

if __name__ == "__main__":
    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    raw_input = sys.stdin.read()
    if raw_input.strip():
        state = json.loads(raw_input)
        chosen_move = get_next_move(state)
        if chosen_move:
            print(json.dumps({
                "from": chosen_move["from"],
                "to": chosen_move["to"]
            }), flush=True)
`,
            red: `"""
Red Bot (Python 3)
Muc tieu: Dua quan toi o dich A1 (r=8, c=0) de chien thang!
Giao thuc: Doc JSON state tu stdin, in JSON move ra stdout.
"""
import sys
import json

def distance(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    my_goal = state.get("myGoal", {"r": 8, "c": 0})

    if not legal_moves:
        return None

    # 1. Thang ngay neu cham dich A1
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    # 2. Danh gia diem so di chuyen
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
    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    raw_input = sys.stdin.read()
    if raw_input.strip():
        state = json.loads(raw_input)
        chosen_move = get_next_move(state)
        if chosen_move:
            print(json.dumps({
                "from": chosen_move["from"],
                "to": chosen_move["to"]
            }), flush=True)
`
        },

        // ==========================================
        // 3. C++ TEMPLATES
        // NOTE: These templates deliberately avoid embedding escaped double-quotes
        // inside C++ string literals. Instead they use:
        //   - std::string keys ("legalMoves", "from", etc.) which survive localStorage
        //   - R"(...)" raw string literals for JSON output fragments
        //   - Character-based bracket matching instead of regex
        // This avoids the bug where localStorage strips backslash-escapes, turning
        // \"legalMoves\" into "legalMoves" and breaking the C++ compiler.
        // ==========================================
        cpp: {
            blue: `/**
 * BLUE BOT (C++17)
 * Goal: Move any piece to square I9 (r=0, c=8) to win!
 * Protocol: Read JSON state from stdin, print JSON move to stdout.
 */
#include <iostream>
#include <string>
#include <vector>
#include <cmath>
#include <algorithm>

struct Coord { int r = 0, c = 0; };
struct Move  { Coord from, to; bool hasCapture = false; };

int chebyshev(int r1, int c1, int r2, int c2) {
    return std::max(std::abs(r1 - r2), std::abs(c1 - c2));
}

// Extract the integer value after "key": in a JSON substring
int extractInt(const std::string& s, size_t pos, const std::string& key) {
    size_t p = s.find(key, pos);
    if (p == std::string::npos) return -1;
    p = s.find(':', p + key.size());
    if (p == std::string::npos) return -1;
    while (++p < s.size() && (s[p] == ' ' || s[p] == '\\t')) {}
    return std::stoi(s.substr(p));
}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)),
                       std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    // Goal for Blue: I9 -> r=0, c=8
    Coord myGoal{0, 8};

    std::vector<Move> legalMoves;

    // Locate the legalMoves array with bracket matching (no escaped-quote strings needed)
    size_t lmPos = input.find("legalMoves");
    if (lmPos != std::string::npos) {
        size_t start = input.find('[', lmPos);
        if (start != std::string::npos) {
            int depth = 0;
            size_t end = std::string::npos;
            for (size_t i = start; i < input.size(); ++i) {
                if (input[i] == '[') depth++;
                else if (input[i] == ']') { if (--depth == 0) { end = i; break; } }
            }
            if (end != std::string::npos) {
                std::string lmStr = input.substr(start, end - start + 1);
                // Keys we search for inside each move object
                const std::string fromKey = "from";
                const std::string toKey   = "to";
                const std::string rKey    = "r";
                const std::string cKey    = "c";
                const std::string capKey  = "hasCapture";

                size_t pos = 0;
                while (pos < lmStr.size()) {
                    size_t objStart = lmStr.find('{', pos);
                    if (objStart == std::string::npos) break;

                    // Find the matching closing brace for this move object
                    int od = 0;
                    size_t objEnd = std::string::npos;
                    for (size_t i = objStart; i < lmStr.size(); ++i) {
                        if (lmStr[i] == '{') od++;
                        else if (lmStr[i] == '}') { if (--od == 0) { objEnd = i; break; } }
                    }
                    if (objEnd == std::string::npos) break;

                    std::string obj = lmStr.substr(objStart, objEnd - objStart + 1);

                    size_t fPos = obj.find(fromKey);
                    size_t tPos = obj.find(toKey, fPos == std::string::npos ? 0 : fPos + 4);
                    if (fPos != std::string::npos && tPos != std::string::npos) {
                        size_t fBlock    = obj.find('{', fPos);
                        size_t fBlockEnd = obj.find('}', fBlock);
                        size_t tBlock    = obj.find('{', tPos);
                        size_t tBlockEnd = obj.find('}', tBlock);

                        if (fBlock != std::string::npos && fBlockEnd != std::string::npos &&
                            tBlock != std::string::npos && tBlockEnd != std::string::npos) {
                            std::string fromObj = obj.substr(fBlock, fBlockEnd - fBlock + 1);
                            std::string toObj   = obj.substr(tBlock, tBlockEnd - tBlock + 1);

                            int fr = extractInt(fromObj, 0, rKey);
                            int fc = extractInt(fromObj, 0, cKey);
                            int tr = extractInt(toObj,   0, rKey);
                            int tc = extractInt(toObj,   0, cKey);

                            if (fr >= 0 && fc >= 0 && tr >= 0 && tc >= 0) {
                                Move m;
                                m.from.r = fr; m.from.c = fc;
                                m.to.r   = tr; m.to.c   = tc;
                                size_t capPos = obj.find(capKey);
                                if (capPos != std::string::npos) {
                                    size_t col = obj.find(':', capPos);
                                    if (col != std::string::npos) {
                                        size_t v = col + 1;
                                        while (v < obj.size() && obj[v] == ' ') v++;
                                        m.hasCapture = (obj.substr(v, 4) == "true");
                                    }
                                }
                                legalMoves.push_back(m);
                            }
                        }
                    }
                    pos = objEnd + 1;
                }
            }
        }
    }

    // Output helper using R"..." raw literals so no escaped quotes in the C++ source
    auto printMove = [](const Move& m) {
        std::cout << R"({"from":{"r":)" << m.from.r
                  << R"(,"c":)"         << m.from.c
                  << R"(},"to":{"r":)"  << m.to.r
                  << R"(,"c":)"         << m.to.c
                  << "}}" << std::endl;
    };

    if (legalMoves.empty()) {
        std::cout << R"({"from":{"r":0,"c":0},"to":{"r":0,"c":0}})" << std::endl;
        return 0;
    }

    // 1. Win immediately if we can reach the goal
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            printMove(m);
            return 0;
        }
    }

    // 2. Prefer captures, closest to goal first
    std::vector<Move> captureMoves;
    for (const auto& m : legalMoves)
        if (m.hasCapture) captureMoves.push_back(m);

    if (!captureMoves.empty()) {
        std::sort(captureMoves.begin(), captureMoves.end(), [&](const Move& a, const Move& b) {
            return chebyshev(a.to.r, a.to.c, myGoal.r, myGoal.c)
                 < chebyshev(b.to.r, b.to.c, myGoal.r, myGoal.c);
        });
        printMove(captureMoves.front());
        return 0;
    }

    // 3. Move closest to goal
    std::sort(legalMoves.begin(), legalMoves.end(), [&](const Move& a, const Move& b) {
        return chebyshev(a.to.r, a.to.c, myGoal.r, myGoal.c)
             < chebyshev(b.to.r, b.to.c, myGoal.r, myGoal.c);
    });
    printMove(legalMoves.front());
    return 0;
}`,
            red: `/**
 * RED BOT (C++17)
 * Goal: Move any piece to square A1 (r=8, c=0) to win!
 * Protocol: Read JSON state from stdin, print JSON move to stdout.
 */
#include <iostream>
#include <string>
#include <vector>
#include <cmath>
#include <algorithm>

struct Coord { int r = 0, c = 0; };
struct Move  { Coord from, to; bool hasCapture = false; };

int chebyshev(int r1, int c1, int r2, int c2) {
    return std::max(std::abs(r1 - r2), std::abs(c1 - c2));
}

int extractInt(const std::string& s, size_t pos, const std::string& key) {
    size_t p = s.find(key, pos);
    if (p == std::string::npos) return -1;
    p = s.find(':', p + key.size());
    if (p == std::string::npos) return -1;
    while (++p < s.size() && (s[p] == ' ' || s[p] == '\\t')) {}
    return std::stoi(s.substr(p));
}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)),
                       std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    // Goal for Red: A1 -> r=8, c=0
    Coord myGoal{8, 0};

    std::vector<Move> legalMoves;

    size_t lmPos = input.find("legalMoves");
    if (lmPos != std::string::npos) {
        size_t start = input.find('[', lmPos);
        if (start != std::string::npos) {
            int depth = 0;
            size_t end = std::string::npos;
            for (size_t i = start; i < input.size(); ++i) {
                if (input[i] == '[') depth++;
                else if (input[i] == ']') { if (--depth == 0) { end = i; break; } }
            }
            if (end != std::string::npos) {
                std::string lmStr = input.substr(start, end - start + 1);
                const std::string fromKey = "from";
                const std::string toKey   = "to";
                const std::string rKey    = "r";
                const std::string cKey    = "c";
                const std::string capKey  = "hasCapture";

                size_t pos = 0;
                while (pos < lmStr.size()) {
                    size_t objStart = lmStr.find('{', pos);
                    if (objStart == std::string::npos) break;

                    int od = 0;
                    size_t objEnd = std::string::npos;
                    for (size_t i = objStart; i < lmStr.size(); ++i) {
                        if (lmStr[i] == '{') od++;
                        else if (lmStr[i] == '}') { if (--od == 0) { objEnd = i; break; } }
                    }
                    if (objEnd == std::string::npos) break;

                    std::string obj = lmStr.substr(objStart, objEnd - objStart + 1);

                    size_t fPos = obj.find(fromKey);
                    size_t tPos = obj.find(toKey, fPos == std::string::npos ? 0 : fPos + 4);
                    if (fPos != std::string::npos && tPos != std::string::npos) {
                        size_t fBlock    = obj.find('{', fPos);
                        size_t fBlockEnd = obj.find('}', fBlock);
                        size_t tBlock    = obj.find('{', tPos);
                        size_t tBlockEnd = obj.find('}', tBlock);

                        if (fBlock != std::string::npos && fBlockEnd != std::string::npos &&
                            tBlock != std::string::npos && tBlockEnd != std::string::npos) {
                            std::string fromObj = obj.substr(fBlock, fBlockEnd - fBlock + 1);
                            std::string toObj   = obj.substr(tBlock, tBlockEnd - tBlock + 1);

                            int fr = extractInt(fromObj, 0, rKey);
                            int fc = extractInt(fromObj, 0, cKey);
                            int tr = extractInt(toObj,   0, rKey);
                            int tc = extractInt(toObj,   0, cKey);

                            if (fr >= 0 && fc >= 0 && tr >= 0 && tc >= 0) {
                                Move m;
                                m.from.r = fr; m.from.c = fc;
                                m.to.r   = tr; m.to.c   = tc;
                                size_t capPos = obj.find(capKey);
                                if (capPos != std::string::npos) {
                                    size_t col = obj.find(':', capPos);
                                    if (col != std::string::npos) {
                                        size_t v = col + 1;
                                        while (v < obj.size() && obj[v] == ' ') v++;
                                        m.hasCapture = (obj.substr(v, 4) == "true");
                                    }
                                }
                                legalMoves.push_back(m);
                            }
                        }
                    }
                    pos = objEnd + 1;
                }
            }
        }
    }

    auto printMove = [](const Move& m) {
        std::cout << R"({"from":{"r":)" << m.from.r
                  << R"(,"c":)"         << m.from.c
                  << R"(},"to":{"r":)"  << m.to.r
                  << R"(,"c":)"         << m.to.c
                  << "}}" << std::endl;
    };

    if (legalMoves.empty()) {
        std::cout << R"({"from":{"r":0,"c":0},"to":{"r":0,"c":0}})" << std::endl;
        return 0;
    }

    // 1. Win immediately if we can reach the goal
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            printMove(m);
            return 0;
        }
    }

    // 2. Score-based selection: advance to goal + capture bonus
    int bestScore = -999999;
    Move bestMove = legalMoves.front();

    for (const auto& m : legalMoves) {
        int score = 0;
        int curDist = chebyshev(m.from.r, m.from.c, myGoal.r, myGoal.c);
        int newDist = chebyshev(m.to.r,   m.to.c,   myGoal.r, myGoal.c);
        score += (curDist - newDist) * 40;
        if (m.hasCapture) score += 100;

        if (score > bestScore) {
            bestScore = score;
            bestMove  = m;
        }
    }

    printMove(bestMove);
    return 0;
}`
        }
    };

})(window);
