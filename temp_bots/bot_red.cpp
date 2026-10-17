/**
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
    while (++p < s.size() && (s[p] == ' ' || s[p] == '\t')) {}
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
}