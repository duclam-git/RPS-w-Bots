/**
 * 🧠 TACTICAL AI (C++17) - Minimax Heuristic Bot
 * Chiến thuật đa chiều: tiến đích, ăn quân, chặn đối thủ, giữ an toàn.
 */
#include <iostream>
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
    std::string search = "\"" + key + "\":";
    auto pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos += search.size();
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    if (pos < json.size() && json[pos] == '"') {
        auto end = json.find('"', pos + 1);
        if (end != std::string::npos) return json.substr(pos + 1, end - pos - 1);
    }
    return "";
}

int getJsonInt(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\":";
    auto pos = json.find(search);
    if (pos == std::string::npos) return 0;
    pos += search.size();
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
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
    auto pos = json.find("\"myGoal\"");
    if (pos == std::string::npos) return {0, 8};
    auto braceStart = json.find('{', pos);
    if (braceStart == std::string::npos) return {0, 8};
    auto braceEnd = json.find('}', braceStart);
    std::string sub = json.substr(braceStart, braceEnd - braceStart + 1);
    return parseCoord(sub);
}

// Parse opponentGoal from state JSON
Coord parseOpponentGoal(const std::string& json) {
    auto pos = json.find("\"opponentGoal\"");
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
    auto pos = json.find("\"legalMoves\"");
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
        auto fromPos = moveJson.find("\"from\"");
        if (fromPos != std::string::npos) {
            auto fb = moveJson.find('{', fromPos + 5);
            auto fe = moveJson.find('}', fb);
            std::string fs = moveJson.substr(fb, fe - fb + 1);
            m.from = parseCoord(fs);
        }
        // Parse to
        auto toPos = moveJson.find("\"to\"");
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
    std::cout << "{\"from\":{\"r\":" << m.from.r << ",\"c\":" << m.from.c
              << "},\"to\":{\"r\":" << m.to.r << ",\"c\":" << m.to.c << "}}" << std::endl;
}

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
    auto pos = json.find("\"board\"");
    if (pos == std::string::npos) return b;
    // Find board array start
    auto arrStart = json.find('[', pos);
    if (arrStart == std::string::npos) return b;

    int r = 0, c = 0;
    size_t cur = arrStart;
    // Scan for player and type within board cells
    while (cur < json.size() && r < 9) {
        auto nextNull = json.find("null", cur);
        auto nextObj = json.find("\"player\"", cur);

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
}