// ===== OTTv2 Code Arena - Multi-Language Bot Starter Templates =====

(function (window) {
    'use strict';

    // C++ starter code. Written with String.raw so backslashes (\" and friends) reach the editor
    // untouched - inside a normal template literal they would be silently eaten and the code would
    // not compile.
    const CPP_COMMON_HEADER = String.raw`#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <ctime>
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

bool readInt(const std::string& s, const std::string& key, size_t& pos, int& out) {
    size_t k = s.find("\"" + key + "\"", pos);
    if (k == std::string::npos) return false;
    size_t colon = s.find(':', k);
    if (colon == std::string::npos) return false;
    out = std::atoi(s.c_str() + colon + 1);
    pos = colon + 1;
    return true;
}

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
            m.hasCapture = (v != std::string::npos && arr[v] != 'n');
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
`;

    function cppTemplate(o) {
        return (String.raw`/**
 * %ICON% %NAME% BOT (C++17)
 * Mục tiêu: Đưa quân tới ô đích %GOALNAME% (r=%GOALR%, c=%GOALC%) để chiến thắng!
 * Giao thức: Đọc JSON state từ stdin, in JSON nước đi ra stdout.
 */
` + CPP_COMMON_HEADER + String.raw`
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
}`)
            .replace(/%ICON%/g, o.icon).replace(/%NAME%/g, o.name).replace(/%TEAM%/g, o.team)
            .replace(/%GOALNAME%/g, o.goalName).replace(/%GOALR%/g, o.goalR).replace(/%GOALC%/g, o.goalC);
    }

    const cppRusher = String.raw`/**
 * 🚀 GOAL RUSHER BOT (C++17)
 * Chiến thuật: Thần tốc lao về đích ở phía đối diện (I9 đối với Xanh, A1 đối với Đỏ)!
 * Dùng khoảng cách Chebyshev (bước đi của Vua) để tìm đường ngắn nhất.
 * Giao thức: Đọc JSON state từ stdin, in JSON nước đi ra stdout.
 */
` + CPP_COMMON_HEADER + String.raw`
int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal{0, 8};
    size_t gp = input.find("\"myGoal\"");
    if (gp != std::string::npos) {
        readInt(input, "r", gp, myGoal.r);
        readInt(input, "c", gp, myGoal.c);
    }

    std::vector<Move> legalMoves = parseLegalMoves(input);
    if (legalMoves.empty()) return 0;

    // 1. Thắng ngay nếu chạm đích
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            printMove(m);
            return 0;
        }
    }

    // 2. Sắp xếp đưa quân tới gần đích nhất (Chebyshev)
    std::stable_sort(legalMoves.begin(), legalMoves.end(), [&](const Move& a, const Move& b) {
        int distA = distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
        int distB = distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
        if (distA != distB) return distA < distB;
        return a.hasCapture > b.hasCapture;
    });

    printMove(legalMoves.front());
    return 0;
}`;

    const cppHunter = String.raw`/**
 * ⚔️ AGGRESSIVE HUNTER BOT (C++17)
 * Chiến thuật: Tiêu diệt quân cản đường và dọn sạch tuyến phòng thủ của đối thủ,
 * sau đó hộ tống quân cờ tiến về đích ở phía bên kia.
 * Giao thức: Đọc JSON state từ stdin, in JSON nước đi ra stdout.
 */
` + CPP_COMMON_HEADER + String.raw`
int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal{0, 8};
    size_t gp = input.find("\"myGoal\"");
    if (gp != std::string::npos) {
        readInt(input, "r", gp, myGoal.r);
        readInt(input, "c", gp, myGoal.c);
    }

    std::vector<Move> legalMoves = parseLegalMoves(input);
    if (legalMoves.empty()) return 0;

    // 1. Thắng ngay nếu chạm đích
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            printMove(m);
            return 0;
        }
    }

    // 2. Tìm tất cả nước ăn quân cản đường
    std::vector<Move> captures;
    for (const auto& m : legalMoves) {
        if (m.hasCapture) captures.push_back(m);
    }
    if (!captures.empty()) {
        std::stable_sort(captures.begin(), captures.end(), [&](const Move& a, const Move& b) {
            return distance(a.to.r, a.to.c, myGoal.r, myGoal.c) < distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
        });
        printMove(captures.front());
        return 0;
    }

    // 3. Tiến quân về phía ô đích
    std::stable_sort(legalMoves.begin(), legalMoves.end(), [&](const Move& a, const Move& b) {
        return distance(a.to.r, a.to.c, myGoal.r, myGoal.c) < distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
    });

    printMove(legalMoves.front());
    return 0;
}`;

    const cppRandom = String.raw`/**
 * 🎲 RANDOM BOT (C++17)
 * Chiến thuật: Chọn ngẫu nhiên một nước đi hợp lệ.
 * Nếu có nước đi thẳng vào ô đích thì đi ngay để chiến thắng!
 * Giao thức: Đọc JSON state từ stdin, in JSON nước đi ra stdout.
 */
` + CPP_COMMON_HEADER + String.raw`
int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal{0, 8};
    size_t gp = input.find("\"myGoal\"");
    if (gp != std::string::npos) {
        readInt(input, "r", gp, myGoal.r);
        readInt(input, "c", gp, myGoal.c);
    }

    std::vector<Move> legalMoves = parseLegalMoves(input);
    if (legalMoves.empty()) return 0;

    // 1. Thắng ngay nếu có nước chạm đích
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            printMove(m);
            return 0;
        }
    }

    // 2. Chọn ngẫu nhiên một nước đi hợp lệ
    std::srand((unsigned int)std::time(nullptr));
    int idx = std::rand() % (int)legalMoves.size();
    printMove(legalMoves[idx]);
    return 0;
}`;

    const cppTactical = String.raw`/**
 * 🧠 TACTICAL AI BOT (C++17)
 * Chiến thuật đa chiều:
 * - Ưu tiên hàng đầu: Tiến về ô đích ở phía đối diện
 * - Chặn đứng đối thủ khi họ có nguy cơ áp sát ô đích của họ
 * - Dọn dẹp các quân địch đang cản đường
 * Giao thức: Đọc JSON state từ stdin, in JSON nước đi ra stdout.
 */
` + CPP_COMMON_HEADER + String.raw`
int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal{0, 8};
    size_t gp = input.find("\"myGoal\"");
    if (gp != std::string::npos) {
        readInt(input, "r", gp, myGoal.r);
        readInt(input, "c", gp, myGoal.c);
    }

    Coord oppGoal{8, 0};
    size_t ogp = input.find("\"opponentGoal\"");
    if (ogp != std::string::npos) {
        readInt(input, "r", ogp, oppGoal.r);
        readInt(input, "c", ogp, oppGoal.c);
    }

    std::vector<Move> legalMoves = parseLegalMoves(input);
    if (legalMoves.empty()) return 0;

    // 1. Thắng ngay nếu có nước chạm đích
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            printMove(m);
            return 0;
        }
    }

    // 2. Đánh giá từng nước đi
    const Move* bestMove = &legalMoves.front();
    int bestScore = -999999;

    for (const auto& m : legalMoves) {
        int score = 0;

        // A. Rút ngắn cự ly tới đích (Trọng số cao nhất)
        int curDist = distance(m.from.r, m.from.c, myGoal.r, myGoal.c);
        int newDist = distance(m.to.r, m.to.c, myGoal.r, myGoal.c);
        score += (curDist - newDist) * 50;

        // B. Thưởng ăn quân
        if (m.hasCapture) {
            score += 120;
        }

        // C. Phòng thủ cản phá nếu đối phương áp sát đích
        if (distance(m.to.r, m.to.c, oppGoal.r, oppGoal.c) <= 2) {
            score += (9 - distance(m.to.r, m.to.c, oppGoal.r, oppGoal.c)) * 20;
        }

        if (score > bestScore) {
            bestScore = score;
            bestMove = &m;
        }
    }

    printMove(*bestMove);
    return 0;
}`;

    // ==========================================
    // PYTHON TEMPLATES
    // ==========================================
    const pyStarterBlue = `"""
🔵 BLUE BOT (Python 3)
Mục tiêu: Đưa quân tới ô đích I9 (r=0, c=8) để chiến thắng!
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
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
`;

    const pyStarterRed = `"""
🔴 RED BOT (Python 3)
Mục tiêu: Đưa quân tới ô đích A1 (r=8, c=0) để chiến thắng!
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
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
`;

    const pyRusher = `"""
🚀 GOAL RUSHER BOT (Python 3)
Chiến thuật: Thần tốc lao về đích ở phía đối diện (I9 đối với Xanh, A1 đối với Đỏ)!
Dùng khoảng cách Chebyshev (bước đi của Vua) để tìm đường ngắn nhất.
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
"""
import sys
import json

def distance(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    if not legal_moves:
        return None

    my_goal = state.get("myGoal", {"r": 0, "c": 8} if state.get("myPlayer") == 1 else {"r": 8, "c": 0})

    # 1. Thắng ngay nếu chạm đích
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    # 2. Sắp xếp đưa quân tới gần đích nhất
    def sort_key(m):
        dist = distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"])
        has_cap = 1 if m.get("capture") is not None else 0
        return (dist, -has_cap)

    legal_moves.sort(key=sort_key)
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
`;

    const pyHunter = `"""
⚔️ AGGRESSIVE HUNTER BOT (Python 3)
Chiến thuật: Tiêu diệt quân cản đường và dọn sạch tuyến phòng thủ của đối thủ,
sau đó hộ tống quân cờ tiến về đích ở phía bên kia.
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
"""
import sys
import json

def distance(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    if not legal_moves:
        return None

    my_goal = state.get("myGoal", {"r": 0, "c": 8} if state.get("myPlayer") == 1 else {"r": 8, "c": 0})

    # 1. Thắng ngay nếu có thể chạm đích
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    # 2. Tìm tất cả nước ăn quân cản đường
    captures = [m for m in legal_moves if m.get("capture") is not None]
    if captures:
        captures.sort(key=lambda m: distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
        return captures[0]

    # 3. Tiến quân về phía ô đích
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
`;

    const pyTactical = `"""
🧠 TACTICAL AI BOT (Python 3)
Chiến thuật đa chiều:
- Rút ngắn cự ly tới ô đích (trọng số cao nhất)
- Ăn quân dọn đường tiến công
- Phòng thủ khi đối phương áp sát ô đích của họ
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
"""
import sys
import json

def distance(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    if not legal_moves:
        return None

    my_player = state.get("myPlayer", 1)
    my_goal = state.get("myGoal", {"r": 0, "c": 8} if my_player == 1 else {"r": 8, "c": 0})
    opp_goal = state.get("opponentGoal", {"r": 8, "c": 0} if my_player == 1 else {"r": 0, "c": 8})

    # 1. Thắng ngay nếu chạm đích
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    best_move = legal_moves[0]
    best_score = -float('inf')

    for m in legal_moves:
        score = 0
        cur_dist = distance(m["from"]["r"], m["from"]["c"], my_goal["r"], my_goal["c"])
        new_dist = distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"])
        score += (cur_dist - new_dist) * 50

        # Thưởng ăn quân
        if m.get("capture") is not None:
            score += 120

        # Phòng thủ: đối thủ đang gần đích của họ thì cản phá
        dist_to_opp_goal = distance(m["to"]["r"], m["to"]["c"], opp_goal["r"], opp_goal["c"])
        if dist_to_opp_goal <= 2:
            score += (9 - dist_to_opp_goal) * 20

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
`;

    const pyRandom = `"""
🎲 RANDOM BOT (Python 3)
Chiến thuật: Chọn ngẫu nhiên một nước đi hợp lệ.
Nếu có nước đi thẳng vào ô đích thì đi ngay để chiến thắng!
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
"""
import sys
import json
import random

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    if not legal_moves:
        return None

    my_goal = state.get("myGoal", {"r": 0, "c": 8} if state.get("myPlayer") == 1 else {"r": 8, "c": 0})

    # 1. Thắng ngay nếu chạm đích
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    # 2. Chọn ngẫu nhiên
    return random.choice(legal_moves)

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
`;

    window.MULTI_LANG_TEMPLATES = {
        // ==========================================
        // 1. JAVASCRIPT TEMPLATES
        // ==========================================
        javascript: {
            get blue() { return window.BOT_PRESETS ? window.BOT_PRESETS.starterBlue : ''; },
            get red() { return window.BOT_PRESETS ? window.BOT_PRESETS.starterRed : ''; },
            get starterBlue() { return window.BOT_PRESETS ? window.BOT_PRESETS.starterBlue : ''; },
            get starterRed() { return window.BOT_PRESETS ? window.BOT_PRESETS.starterRed : ''; },
            get random() { return window.BOT_PRESETS ? window.BOT_PRESETS.random : ''; },
            get rusher() { return window.BOT_PRESETS ? window.BOT_PRESETS.rusher : ''; },
            get hunter() { return window.BOT_PRESETS ? window.BOT_PRESETS.hunter : ''; },
            get tactical() { return window.BOT_PRESETS ? window.BOT_PRESETS.tactical : ''; }
        },

        // ==========================================
        // 2. PYTHON TEMPLATES
        // ==========================================
        python: {
            blue: pyStarterBlue,
            red: pyStarterRed,
            starterBlue: pyStarterBlue,
            starterRed: pyStarterRed,
            random: pyRandom,
            rusher: pyRusher,
            hunter: pyHunter,
            tactical: pyTactical
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
            }),
            starterBlue: cppTemplate({
                icon: '🔵', name: 'BLUE', team: 'Xanh', goalName: 'I9', goalR: 0, goalC: 8
            }),
            starterRed: cppTemplate({
                icon: '🔴', name: 'RED', team: 'Đỏ', goalName: 'A1', goalR: 8, goalC: 0
            }),
            random: cppRandom,
            rusher: cppRusher,
            hunter: cppHunter,
            tactical: cppTactical
        }
    };


    // ==========================================
    // Starter templates per GAME. rps = the classic set above; caro = Cờ Caro (Gomoku).
    // ==========================================
    const caroJs = String.raw`/**
 * ⚫ BOT CỜ CARO (JavaScript)
 * state.grid       : mảng chuỗi, mỗi ký tự là một ô: '0' trống, '1' Xanh, '2' Đỏ
 * state.myPlayer   : bạn là 1 (Xanh, đi trước) hay 2 (Đỏ);  state.winLength: số quân liên tiếp để thắng
 * state.legalMoves : mọi ô trống, dạng { to: { r, c } }
 * Trả về một phần tử của legalMoves (hoặc { to: { r, c } }).
 */
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
            if (n >= W) total += 1e7;                                   // thắng ngay (hoặc chặn thua ngay)
            else total += [0, 1, 10, 100, 1000, 10000][Math.min(n, 5)] * (open === 2 ? 2 : open === 1 ? 1 : 0.1);
        }
        return total;
    }

    const mid = (N - 1) / 2;
    let best = null, bestScore = -Infinity;
    for (const m of state.legalMoves) {
        const { r, c } = m.to;
        const s = score(r, c, me) * 1.1 + score(r, c, opp) - (Math.abs(r - mid) + Math.abs(c - mid)) * 0.01;
        if (s > bestScore) { bestScore = s; best = m; }
    }
    log('chọn', best.to, 'điểm', Math.round(bestScore));
    return best;
}`;
    const caroPy = String.raw`"""
BOT CỜ CARO (Python 3)
state["grid"]       : danh sách chuỗi, mỗi ký tự là một ô: '0' trống, '1' Xanh, '2' Đỏ
state["myPlayer"]   : bạn là 1 (Xanh, đi trước) hay 2 (Đỏ);  state["winLength"]: số quân liên tiếp để thắng
state["legalMoves"] : mọi ô trống, dạng {"to": {"r": r, "c": c}}
In ra một dòng JSON: {"to": {"r": r, "c": c}}.  Ghi log: in ra stderr.
"""
import json
import sys


def line(grid, n_size, r, c, p, dr, dc):
    n, open_ends = 1, 0
    for s in (1, -1):
        i = 1
        while True:
            rr, cc = r + s * dr * i, c + s * dc * i
            if rr < 0 or cc < 0 or rr >= n_size or cc >= n_size:
                break
            if grid[rr][cc] == p:
                n += 1
                i += 1
            else:
                if grid[rr][cc] == 0:
                    open_ends += 1
                break
    return n, open_ends


def score(grid, n_size, w, r, c, p):
    total = 0.0
    weights = [0, 1, 10, 100, 1000, 10000]
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        n, open_ends = line(grid, n_size, r, c, p, dr, dc)
        if n >= w:
            total += 1e7                      # thắng ngay (hoặc chặn thua ngay)
        else:
            total += weights[min(n, 5)] * (2 if open_ends == 2 else 1 if open_ends == 1 else 0.1)
    return total


def main():
    state = json.loads(sys.stdin.read())
    grid = [[int(ch) for ch in row] for row in state["grid"]]
    n_size, me, opp, w = len(grid), state["myPlayer"], state["opponentPlayer"], state["winLength"]
    mid = (n_size - 1) / 2
    best, best_score = None, float("-inf")
    for m in state["legalMoves"]:
        r, c = m["to"]["r"], m["to"]["c"]
        s = score(grid, n_size, w, r, c, me) * 1.1 + score(grid, n_size, w, r, c, opp) - (abs(r - mid) + abs(c - mid)) * 0.01
        if s > best_score:
            best, best_score = m, s
    sys.stderr.write("chon %s diem %d\n" % (best["to"], best_score))
    print(json.dumps({"to": best["to"]}))


main()`;
    const caroCpp = String.raw`/**
 * BOT CỜ CARO (C++17)
 * stdin : JSON state. Dùng "grid" (mảng chuỗi: '0' trống, '1' Xanh, '2' Đỏ), "myPlayer", "winLength".
 * stdout: {"to":{"r":R,"c":C}}      stderr: log
 */
#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

// ---------- đọc JSON tối giản ----------
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

int readInt(const std::string& s, const std::string& key, int fallback) {
    size_t k = s.find("\"" + key + "\"");
    if (k == std::string::npos) return fallback;
    size_t colon = s.find(':', k);
    return colon == std::string::npos ? fallback : std::atoi(s.c_str() + colon + 1);
}

std::vector<std::string> parseGrid(const std::string& input) {
    std::vector<std::string> rows;
    const std::string arr = extractArray(input, "grid");
    size_t pos = 0;
    while (true) {
        size_t a = arr.find('"', pos);
        if (a == std::string::npos) break;
        size_t b = arr.find('"', a + 1);
        if (b == std::string::npos) break;
        rows.push_back(arr.substr(a + 1, b - a - 1));
        pos = b + 1;
    }
    return rows;
}

std::vector<std::string> grid;
int N = 0, W = 5;

// Nếu đặt quân p vào (r, c): chuỗi dài bao nhiêu và có mấy đầu còn mở?
void line(int r, int c, char p, int dr, int dc, int& n, int& open) {
    n = 1; open = 0;
    for (int s = 1; s >= -1; s -= 2) {
        for (int i = 1;; i++) {
            int rr = r + s * dr * i, cc = c + s * dc * i;
            if (rr < 0 || cc < 0 || rr >= N || cc >= N) break;
            if (grid[rr][cc] == p) n++;
            else { if (grid[rr][cc] == '0') open++; break; }
        }
    }
}

double score(int r, int c, char p) {
    static const double weights[] = {0, 1, 10, 100, 1000, 10000};
    double total = 0;
    const int dirs[4][2] = {{0, 1}, {1, 0}, {1, 1}, {1, -1}};
    for (auto& d : dirs) {
        int n, open;
        line(r, c, p, d[0], d[1], n, open);
        if (n >= W) total += 1e7;                       // thắng ngay (hoặc chặn thua ngay)
        else total += weights[std::min(n, 5)] * (open == 2 ? 2 : open == 1 ? 1 : 0.1);
    }
    return total;
}

int main() {
    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    grid = parseGrid(input);
    N = (int)grid.size();
    if (N == 0) return 0;
    int meNum = readInt(input, "myPlayer", 1);
    W = readInt(input, "winLength", 5);
    char me = (char)('0' + meNum), opp = (char)('0' + (meNum == 1 ? 2 : 1));

    double mid = (N - 1) / 2.0, bestScore = -1e18;
    int br = -1, bc = -1;
    for (int r = 0; r < N; r++) {
        for (int c = 0; c < N; c++) {
            if (grid[r][c] != '0') continue;
            double s = score(r, c, me) * 1.1 + score(r, c, opp) - (std::abs(r - mid) + std::abs(c - mid)) * 0.01;
            if (s > bestScore) { bestScore = s; br = r; bc = c; }
        }
    }
    if (br < 0) return 0;
    std::cerr << "chon " << br << "," << bc << std::endl;
    std::cout << "{\"to\":{\"r\":" << br << ",\"c\":" << bc << "}}" << std::endl;
    return 0;
}`;
    window.GAME_TEMPLATES = {
        rps: window.MULTI_LANG_TEMPLATES,
        caro: {
            javascript: { blue: caroJs, red: caroJs },
            python: { blue: caroPy, red: caroPy },
            cpp: { blue: caroCpp, red: caroCpp }
        }
    };
})(window);
