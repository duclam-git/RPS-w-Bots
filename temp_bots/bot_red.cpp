/**
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
    std::regex moveRegex(R"("from":{"r":(d+),"c":(d+)},"to":{"r":(d+),"c":(d+)})");
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
        std::cout << "{"from":{"r":0,"c":0},"to":{"r":0,"c":0}}" << std::endl;
        return 0;
    }

    // 1. Thắng ngay nếu chạm đích A1
    for (const auto& m : legalMoves) {
        if (m.to.r == myGoal.r && m.to.c == myGoal.c) {
            std::cout << "{"from":{"r":" << m.from.r << ","c":" << m.from.c 
                      << "},"to":{"r":" << m.to.r << ","c":" << m.to.c << "}}" << std::endl;
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
    std::cout << "{"from":{"r":" << best.from.r << ","c":" << best.from.c 
              << "},"to":{"r":" << best.to.r << ","c":" << best.to.c << "}}" << std::endl;

    return 0;
}