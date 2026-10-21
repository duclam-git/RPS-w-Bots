// ===== OTTv2 Code Arena - Multi-Language Bot Starter & Strategy Templates =====
// Mỗi ngôn ngữ (JS, Python, C++) đều có đầy đủ 5 mẫu bot:
//   starterBlue, starterRed, random, rusher, hunter, tactical

(function (window) {
    'use strict';

    // ============================================================
    //  COMMON C++ HEADER: JSON parser + board utilities (no deps)
    // ============================================================
    const CPP_HEADER = `#include <iostream>
#include <string>
#include <vector>
#include <cmath>
#include <algorithm>
#include <sstream>
#include <cstdlib>
#include <climits>

struct Coord { int r = 0, c = 0; };
struct Move {
    Coord from, to;
    std::string pieceType;
    std::string capture; // empty = no capture
    std::string notation;
};
struct Cell {
    int player = 0; // 0=empty, 1=blue, 2=red
    std::string type; // rock, paper, scissors
};

int chebyshev(int r1, int c1, int r2, int c2) {
    return std::max(std::abs(r1 - r2), std::abs(c1 - c2));
}

// Minimal JSON helpers -----------------------------------------------
std::string getJsonString(const std::string& json, const std::string& key) {
    std::string search = "\\"" + key + "\\":";
    auto pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos += search.size();
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\\t')) pos++;
    if (pos < json.size() && json[pos] == '"') {
        auto end = json.find('"', pos + 1);
        if (end != std::string::npos) return json.substr(pos + 1, end - pos - 1);
    }
    return "";
}

int getJsonInt(const std::string& json, const std::string& key) {
    std::string search = "\\"" + key + "\\":";
    auto pos = json.find(search);
    if (pos == std::string::npos) return 0;
    pos += search.size();
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\\t')) pos++;
    std::string num;
    while (pos < json.size() && (json[pos] >= '0' && json[pos] <= '9')) {
        num += json[pos++];
    }
    return num.empty() ? 0 : std::stoi(num);
}

// Parse {r:X, c:Y}
Coord parseCoord(const std::string& s, size_t start = 0) {
    Coord c;
    c.r = getJsonInt(s.substr(start), "r");
    c.c = getJsonInt(s.substr(start), "c");
    return c;
}

// Parse myGoal from state JSON
Coord parseGoal(const std::string& json) {
    auto pos = json.find("\\"myGoal\\"");
    if (pos == std::string::npos) return {0, 8};
    auto braceStart = json.find('{', pos);
    if (braceStart == std::string::npos) return {0, 8};
    auto braceEnd = json.find('}', braceStart);
    std::string sub = json.substr(braceStart, braceEnd - braceStart + 1);
    return parseCoord(sub);
}

// Parse opponentGoal from state JSON
Coord parseOpponentGoal(const std::string& json) {
    auto pos = json.find("\\"opponentGoal\\"");
    if (pos == std::string::npos) return {8, 0};
    auto braceStart = json.find('{', pos);
    if (braceStart == std::string::npos) return {8, 0};
    auto braceEnd = json.find('}', braceStart);
    std::string sub = json.substr(braceStart, braceEnd - braceStart + 1);
    return parseCoord(sub);
}

// Parse legalMoves array
std::vector<Move> parseLegalMoves(const std::string& json) {
    std::vector<Move> moves;
    auto pos = json.find("\\"legalMoves\\"");
    if (pos == std::string::npos) return moves;
    auto arrStart = json.find('[', pos);
    if (arrStart == std::string::npos) return moves;

    // Find each move object {...}
    size_t cursor = arrStart + 1;
    while (cursor < json.size()) {
        auto objStart = json.find('{', cursor);
        if (objStart == std::string::npos || objStart > json.find(']', arrStart)) break;
        // Find matching closing brace (depth-aware)
        int depth = 1;
        size_t objEnd = objStart + 1;
        while (objEnd < json.size() && depth > 0) {
            if (json[objEnd] == '{') depth++;
            else if (json[objEnd] == '}') depth--;
            objEnd++;
        }
        std::string moveJson = json.substr(objStart, objEnd - objStart);

        Move m;
        // Parse from
        auto fromPos = moveJson.find("\\"from\\"");
        if (fromPos != std::string::npos) {
            auto fb = moveJson.find('{', fromPos + 5);
            auto fe = moveJson.find('}', fb);
            std::string fs = moveJson.substr(fb, fe - fb + 1);
            m.from = parseCoord(fs);
        }
        // Parse to
        auto toPos = moveJson.find("\\"to\\"");
        if (toPos != std::string::npos) {
            auto tb = moveJson.find('{', toPos + 3);
            auto te = moveJson.find('}', tb);
            std::string ts = moveJson.substr(tb, te - tb + 1);
            m.to = parseCoord(ts);
        }
        m.pieceType = getJsonString(moveJson, "pieceType");
        m.capture = getJsonString(moveJson, "capture");
        m.notation = getJsonString(moveJson, "notation");
        moves.push_back(m);
        cursor = objEnd;
    }
    return moves;
}

void printMove(const Move& m) {
    std::cout << "{\\"from\\":{\\"r\\":" << m.from.r << ",\\"c\\":" << m.from.c
              << "},\\"to\\":{\\"r\\":" << m.to.r << ",\\"c\\":" << m.to.c << "}}" << std::endl;
}`;

    // ============================================================
    //  COMMON PYTHON HEADER: JSON I/O + distance helper
    // ============================================================
    const PY_HEADER = `import sys, json, math, random

def chebyshev(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

raw = sys.stdin.read().strip()
if not raw:
    sys.exit(0)
state = json.loads(raw)
legal_moves = state.get("legalMoves", [])
my_goal = state.get("myGoal", {"r": 0, "c": 8})
opponent_goal = state.get("opponentGoal", {"r": 8, "c": 0})
board = state.get("board", [])
my_player = state.get("myPlayer", 1)
opp_player = state.get("opponentPlayer", 2)

if not legal_moves:
    sys.exit(0)

def output(m):
    print(json.dumps({"from": m["from"], "to": m["to"]}))
    sys.exit(0)`;

    // ============================================================
    //  TEMPLATES
    // ============================================================

    window.MULTI_LANG_TEMPLATES = {

        // ==========================================
        // 1. JAVASCRIPT TEMPLATES
        // ==========================================
        javascript: {
            get starterBlue() { return (window.BOT_PRESETS && window.BOT_PRESETS.starterBlue) || ''; },
            get starterRed()  { return (window.BOT_PRESETS && window.BOT_PRESETS.starterRed)  || ''; },
            get random()      { return (window.BOT_PRESETS && window.BOT_PRESETS.random)      || ''; },
            get rusher()      { return (window.BOT_PRESETS && window.BOT_PRESETS.rusher)      || ''; },
            get hunter()      { return (window.BOT_PRESETS && window.BOT_PRESETS.hunter)      || ''; },
            get tactical()    { return (window.BOT_PRESETS && window.BOT_PRESETS.tactical)    || ''; },

            // keep old blue/red keys for backward compat
            get blue() { return (window.BOT_PRESETS && window.BOT_PRESETS.starterBlue) || ''; },
            get red()  { return (window.BOT_PRESETS && window.BOT_PRESETS.starterRed)  || ''; }
        },

        // ==========================================
        // 2. PYTHON TEMPLATES
        // ==========================================
        python: {
            // --- Starter Blue ---
            starterBlue: `"""
🔵 BLUE BOT (Python 3) - Mẫu Cơ Bản
Mục tiêu: Đưa quân tới ô đích I9 (r=0, c=8) để chiến thắng!
"""
${PY_HEADER}

# 1. Thắng ngay nếu chạm đích
for m in legal_moves:
    if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
        output(m)

# 2. Ưu tiên ăn quân đối phương
captures = [m for m in legal_moves if m.get("capture")]
if captures:
    captures.sort(key=lambda m: chebyshev(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
    output(captures[0])

# 3. Tiến gần nhất về phía đích
legal_moves.sort(key=lambda m: chebyshev(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
output(legal_moves[0])
`,

            // --- Starter Red ---
            starterRed: `"""
🔴 RED BOT (Python 3) - Mẫu Cơ Bản
Mục tiêu: Đưa quân tới ô đích A1 (r=8, c=0) để chiến thắng!
"""
${PY_HEADER}

# 1. Thắng ngay nếu chạm đích
for m in legal_moves:
    if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
        output(m)

# 2. Đánh giá điểm số di chuyển
best_move = legal_moves[0]
best_score = -float('inf')

for m in legal_moves:
    score = 0
    cur_dist = chebyshev(m["from"]["r"], m["from"]["c"], my_goal["r"], my_goal["c"])
    new_dist = chebyshev(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"])
    score += (cur_dist - new_dist) * 40
    if m.get("capture"):
        score += 100
    if score > best_score:
        best_score = score
        best_move = m

output(best_move)
`,

            // --- Random ---
            random: `"""
🎲 RANDOM BOT (Python 3)
Chọn ngẫu nhiên nước đi. Nếu có nước chạm đích thì đi ngay!
"""
${PY_HEADER}

# 1. Thắng ngay
for m in legal_moves:
    if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
        output(m)

# 2. Chọn ngẫu nhiên
output(random.choice(legal_moves))
`,

            // --- Rusher ---
            rusher: `"""
🚀 GOAL RUSHER BOT (Python 3)
Chiến thuật: Thần tốc lao về đích ở phía đối diện!
"""
${PY_HEADER}

# 1. Thắng ngay
for m in legal_moves:
    if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
        output(m)

# 2. Sắp xếp theo khoảng cách tới đích, ưu tiên ăn quân khi bằng nhau
def rusher_key(m):
    d = chebyshev(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"])
    cap = 0 if m.get("capture") else 1  # có capture thì ưu tiên
    return (d, cap)

legal_moves.sort(key=rusher_key)
output(legal_moves[0])
`,

            // --- Hunter ---
            hunter: `"""
⚔️ AGGRESSIVE HUNTER BOT (Python 3)
Chiến thuật: Ưu tiên tiêu diệt quân cản đường, sau đó tiến về đích!
"""
${PY_HEADER}

# 1. Thắng ngay
for m in legal_moves:
    if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
        output(m)

# 2. Ăn quân đối phương, ưu tiên quân gần đích
captures = [m for m in legal_moves if m.get("capture")]
if captures:
    captures.sort(key=lambda m: chebyshev(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
    output(captures[0])

# 3. Tiến về đích
legal_moves.sort(key=lambda m: chebyshev(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"]))
output(legal_moves[0])
`,

            // --- Tactical ---
            tactical: `"""
🧠 TACTICAL AI (Python 3) - Minimax Heuristic Bot
Chiến thuật đa chiều: tiến về đích, ăn quân, chặn đối thủ, giữ an toàn.
"""
${PY_HEADER}

ROWS = len(board) if board else 9
COLS = len(board[0]) if board and board[0] else 9
BEATS = {"rock": "scissors", "scissors": "paper", "paper": "rock"}

def can_capture(atk_type, def_type):
    return BEATS.get(atk_type) == def_type

def clone_board(b):
    return [[dict(cell) if cell else None for cell in row] for row in b]

def simulate(b, mv):
    nb = clone_board(b)
    nb[mv["to"]["r"]][mv["to"]["c"]] = nb[mv["from"]["r"]][mv["from"]["c"]]
    nb[mv["from"]["r"]][mv["from"]["c"]] = None
    return nb

def get_legal_moves(player, b):
    moves = []
    dirs = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
    for r in range(ROWS):
        for c in range(COLS):
            cell = b[r][c]
            if not cell or cell.get("player") != player:
                continue
            for dr, dc in dirs:
                nr, nc = r + dr, c + dc
                if 0 <= nr < ROWS and 0 <= nc < COLS:
                    target = b[nr][nc]
                    if target is None:
                        moves.append({"from":{"r":r,"c":c},"to":{"r":nr,"c":nc},"capture":None})
                    elif target.get("player") != player and can_capture(cell.get("type",""), target.get("type","")):
                        moves.append({"from":{"r":r,"c":c},"to":{"r":nr,"c":nc},"capture":target.get("type")})
    return moves

# 1. Thắng ngay
for m in legal_moves:
    if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
        output(m)

# 2. Đánh giá từng nước
best_move = legal_moves[0]
best_score = -float('inf')

for m in legal_moves:
    score = 0
    # A. Rút ngắn khoảng cách tới đích
    cur_d = chebyshev(m["from"]["r"], m["from"]["c"], my_goal["r"], my_goal["c"])
    new_d = chebyshev(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"])
    score += (cur_d - new_d) * 50

    # B. Ăn quân
    if m.get("capture"):
        score += 120

    # C. An toàn (1-ply lookahead)
    sim = simulate(board, m)
    opp_moves = get_legal_moves(opp_player, sim)
    if any(em["to"]["r"] == m["to"]["r"] and em["to"]["c"] == m["to"]["c"] for em in opp_moves):
        score -= 100

    # D. Phòng thủ: chặn đối thủ gần đích
    if any(chebyshev(em["to"]["r"], em["to"]["c"], opponent_goal["r"], opponent_goal["c"]) <= 1 for em in opp_moves):
        defend_d = chebyshev(m["to"]["r"], m["to"]["c"], opponent_goal["r"], opponent_goal["c"])
        score += (9 - defend_d) * 25

    if score > best_score:
        best_score = score
        best_move = m

output(best_move)
`,

            // backward compat keys
            blue: null,
            red:  null
        },

        // ==========================================
        // 3. C++ TEMPLATES (C++17, zero external deps)
        // ==========================================
        cpp: {
            // --- Starter Blue ---
            starterBlue: `/**
 * 🔵 BLUE BOT (C++17) - Mẫu Cơ Bản
 * Mục tiêu: Đưa quân tới ô đích I9 (r=0, c=8) để chiến thắng!
 */
${CPP_HEADER}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                      std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal = parseGoal(input);
    auto moves = parseLegalMoves(input);
    if (moves.empty()) return 0;

    // 1. Thắng ngay
    for (auto& m : moves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) { printMove(m); return 0; }
    }

    // 2. Ưu tiên ăn quân gần đích
    std::vector<Move> captures;
    for (auto& m : moves) if (!m.capture.empty()) captures.push_back(m);
    if (!captures.empty()) {
        std::sort(captures.begin(), captures.end(), [&](const Move& a, const Move& b) {
            return chebyshev(a.to.r, a.to.c, myGoal.r, myGoal.c) < chebyshev(b.to.r, b.to.c, myGoal.r, myGoal.c);
        });
        printMove(captures.front()); return 0;
    }

    // 3. Tiến gần đích nhất
    std::sort(moves.begin(), moves.end(), [&](const Move& a, const Move& b) {
        return chebyshev(a.to.r, a.to.c, myGoal.r, myGoal.c) < chebyshev(b.to.r, b.to.c, myGoal.r, myGoal.c);
    });
    printMove(moves.front());
    return 0;
}`,

            // --- Starter Red ---
            starterRed: `/**
 * 🔴 RED BOT (C++17) - Mẫu Cơ Bản
 * Mục tiêu: Đưa quân tới ô đích A1 (r=8, c=0) để chiến thắng!
 */
${CPP_HEADER}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                      std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal = parseGoal(input);
    auto moves = parseLegalMoves(input);
    if (moves.empty()) return 0;

    // 1. Thắng ngay
    for (auto& m : moves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) { printMove(m); return 0; }
    }

    // 2. Đánh giá điểm
    Move best = moves[0];
    int bestScore = INT_MIN;
    for (auto& m : moves) {
        int score = 0;
        int curD = chebyshev(m.from.r, m.from.c, myGoal.r, myGoal.c);
        int newD = chebyshev(m.to.r, m.to.c, myGoal.r, myGoal.c);
        score += (curD - newD) * 40;
        if (!m.capture.empty()) score += 100;
        if (score > bestScore) { bestScore = score; best = m; }
    }
    printMove(best);
    return 0;
}`,

            // --- Random ---
            random: `/**
 * 🎲 RANDOM BOT (C++17)
 * Chọn ngẫu nhiên nước đi. Nếu có nước chạm đích thì đi ngay!
 */
${CPP_HEADER}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                      std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal = parseGoal(input);
    auto moves = parseLegalMoves(input);
    if (moves.empty()) return 0;

    // 1. Thắng ngay
    for (auto& m : moves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) { printMove(m); return 0; }
    }

    // 2. Random
    srand(time(NULL));
    printMove(moves[rand() % moves.size()]);
    return 0;
}`,

            // --- Rusher ---
            rusher: `/**
 * 🚀 GOAL RUSHER BOT (C++17)
 * Chiến thuật: Thần tốc lao về đích, ưu tiên ăn quân cản đường!
 */
${CPP_HEADER}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                      std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal = parseGoal(input);
    auto moves = parseLegalMoves(input);
    if (moves.empty()) return 0;

    // 1. Thắng ngay
    for (auto& m : moves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) { printMove(m); return 0; }
    }

    // 2. Sort: gần đích nhất, ưu tiên capture nếu cùng khoảng cách
    std::sort(moves.begin(), moves.end(), [&](const Move& a, const Move& b) {
        int dA = chebyshev(a.to.r, a.to.c, myGoal.r, myGoal.c);
        int dB = chebyshev(b.to.r, b.to.c, myGoal.r, myGoal.c);
        if (dA != dB) return dA < dB;
        return (!a.capture.empty()) > (!b.capture.empty());
    });
    printMove(moves.front());
    return 0;
}`,

            // --- Hunter ---
            hunter: `/**
 * ⚔️ AGGRESSIVE HUNTER BOT (C++17)
 * Chiến thuật: Ưu tiên tiêu diệt quân cản đường, sau đó tiến về đích!
 */
${CPP_HEADER}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                      std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal = parseGoal(input);
    auto moves = parseLegalMoves(input);
    if (moves.empty()) return 0;

    // 1. Thắng ngay
    for (auto& m : moves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) { printMove(m); return 0; }
    }

    // 2. Ăn quân gần đích
    std::vector<Move> captures;
    for (auto& m : moves) if (!m.capture.empty()) captures.push_back(m);
    if (!captures.empty()) {
        std::sort(captures.begin(), captures.end(), [&](const Move& a, const Move& b) {
            return chebyshev(a.to.r, a.to.c, myGoal.r, myGoal.c) < chebyshev(b.to.r, b.to.c, myGoal.r, myGoal.c);
        });
        printMove(captures.front()); return 0;
    }

    // 3. Tiến về đích
    std::sort(moves.begin(), moves.end(), [&](const Move& a, const Move& b) {
        return chebyshev(a.to.r, a.to.c, myGoal.r, myGoal.c) < chebyshev(b.to.r, b.to.c, myGoal.r, myGoal.c);
    });
    printMove(moves.front());
    return 0;
}`,

            // --- Tactical ---
            tactical: `/**
 * 🧠 TACTICAL AI (C++17) - Minimax Heuristic Bot
 * Chiến thuật đa chiều: tiến đích, ăn quân, chặn đối thủ, giữ an toàn.
 */
${CPP_HEADER}

// Board simulation for 1-ply lookahead
struct BoardCell { int player; std::string type; };

bool beats(const std::string& atk, const std::string& def) {
    return (atk == "rock" && def == "scissors") ||
           (atk == "scissors" && def == "paper") ||
           (atk == "paper" && def == "rock");
}

struct Board9x9 {
    BoardCell cells[9][9];
};

Board9x9 parseBoard(const std::string& json) {
    Board9x9 b{};
    auto pos = json.find("\\"board\\"");
    if (pos == std::string::npos) return b;
    // Find board array start
    auto arrStart = json.find('[', pos);
    if (arrStart == std::string::npos) return b;

    int r = 0, c = 0;
    size_t cur = arrStart;
    // Scan for player and type within board cells
    while (cur < json.size() && r < 9) {
        auto nextNull = json.find("null", cur);
        auto nextObj = json.find("\\"player\\"", cur);

        if (nextNull != std::string::npos && (nextObj == std::string::npos || nextNull < nextObj)) {
            cur = nextNull + 4;
            c++;
            if (c >= 9) { c = 0; r++; }
        } else if (nextObj != std::string::npos) {
            int p = getJsonInt(json.substr(nextObj - 1, 30), "player");
            std::string t = getJsonString(json.substr(nextObj - 1, 80), "type");
            if (r < 9 && c < 9) { b.cells[r][c] = {p, t}; }
            cur = nextObj + 10;
            c++;
            if (c >= 9) { c = 0; r++; }
        } else break;
    }
    return b;
}

std::vector<Move> getOppMoves(const Board9x9& b, int oppPlayer) {
    std::vector<Move> moves;
    int dirs[][2] = {{-1,-1},{-1,0},{-1,1},{0,-1},{0,1},{1,-1},{1,0},{1,1}};
    for (int r = 0; r < 9; r++) {
        for (int c = 0; c < 9; c++) {
            if (b.cells[r][c].player != oppPlayer) continue;
            for (auto& d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr < 0 || nr >= 9 || nc < 0 || nc >= 9) continue;
                auto& target = b.cells[nr][nc];
                if (target.player == 0) {
                    Move m; m.from = {r,c}; m.to = {nr,nc};
                    moves.push_back(m);
                } else if (target.player != oppPlayer && beats(b.cells[r][c].type, target.type)) {
                    Move m; m.from = {r,c}; m.to = {nr,nc}; m.capture = target.type;
                    moves.push_back(m);
                }
            }
        }
    }
    return moves;
}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                      std::istreambuf_iterator<char>());
    if (input.empty()) return 0;

    Coord myGoal = parseGoal(input);
    Coord oppGoal = parseOpponentGoal(input);
    int oppPlayer = getJsonInt(input, "opponentPlayer");
    auto moves = parseLegalMoves(input);
    if (moves.empty()) return 0;

    Board9x9 board = parseBoard(input);

    // 1. Thắng ngay
    for (auto& m : moves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) { printMove(m); return 0; }
    }

    // 2. Đánh giá
    Move best = moves[0];
    int bestScore = INT_MIN;

    for (auto& m : moves) {
        int score = 0;

        // A. Rút ngắn khoảng cách tới đích
        int curD = chebyshev(m.from.r, m.from.c, myGoal.r, myGoal.c);
        int newD = chebyshev(m.to.r, m.to.c, myGoal.r, myGoal.c);
        score += (curD - newD) * 50;

        // B. Ăn quân
        if (!m.capture.empty()) score += 120;

        // C. An toàn (simulate move)
        Board9x9 sim = board;
        sim.cells[m.to.r][m.to.c] = sim.cells[m.from.r][m.from.c];
        sim.cells[m.from.r][m.from.c] = {0, ""};
        auto oppMoves = getOppMoves(sim, oppPlayer);

        bool vulnerable = false;
        bool oppThreat = false;
        for (auto& em : oppMoves) {
            if (em.to.r == m.to.r && em.to.c == m.to.c) vulnerable = true;
            if (chebyshev(em.to.r, em.to.c, oppGoal.r, oppGoal.c) <= 1) oppThreat = true;
        }
        if (vulnerable) score -= 100;

        // D. Phòng thủ
        if (oppThreat) {
            int defendD = chebyshev(m.to.r, m.to.c, oppGoal.r, oppGoal.c);
            score += (9 - defendD) * 25;
        }

        if (score > bestScore) { bestScore = score; best = m; }
    }
    printMove(best);
    return 0;
}`,

            // backward compat keys
            blue: null,
            red:  null
        }
    };

    // Fill backward compat blue/red keys
    window.MULTI_LANG_TEMPLATES.python.blue = window.MULTI_LANG_TEMPLATES.python.starterBlue;
    window.MULTI_LANG_TEMPLATES.python.red  = window.MULTI_LANG_TEMPLATES.python.starterRed;
    window.MULTI_LANG_TEMPLATES.cpp.blue    = window.MULTI_LANG_TEMPLATES.cpp.starterBlue;
    window.MULTI_LANG_TEMPLATES.cpp.red     = window.MULTI_LANG_TEMPLATES.cpp.starterRed;

})(window);
