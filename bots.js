// ===== OTTv2 Bot Coding Battle - Bot Presets & Templates =====

window.BOT_PRESETS = {
    // 1. Starter Bot for Blue (Player 1)
    starterBlue: `/**
 * 🔵 BLUE BOT - Starter Code
 * Mục tiêu DUY NHẤT để chiến thắng:
 * 👉 Đưa bất kỳ quân nào tới ô đích I9 (r=0, c=8) ở phía bên kia bàn cờ!
 *
 * Luật di chuyển & ăn quân:
 * - Đi 1 ô theo 8 hướng (như vua trong cờ vua).
 * - ✊ Đấm ăn ✌️ Kéo | ✌️ Kéo ăn ✋ Lá | ✋ Lá ăn ✊ Đấm.
 * - Cùng loại chặn nhau. Ăn quân giúp dọn đường và hạn chế nước đi của đối thủ!
 */
function getNextMove(state, helpers, log) {
    const { legalMoves, myGoal } = state;

    // 1. Kiểm tra nước đi tới ô đích I9 để chiến thắng ngay lập tức
    const winMove = legalMoves.find(m => m.to.r === myGoal.r && m.to.c === myGoal.c);
    if (winMove) {
        log("🏆 Về đích I9 ở phía bên kia chiến thắng!", winMove.notation);
        return winMove;
    }

    // 2. Nếu có nước ăn quân cản đường, ưu tiên ăn để mở đường tiến lên
    const captureMoves = legalMoves.filter(m => m.capture !== null);
    if (captureMoves.length > 0) {
        // Ưu tiên ăn quân đối phương đang ở gần hơn về phía đích
        captureMoves.sort((a, b) => {
            const distA = helpers.distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
            const distB = helpers.distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
            return distA - distB;
        });
        const bestCapture = captureMoves[0];
        log(\`⚔️ Ăn quân cản đường \${bestCapture.capture}:\`, bestCapture.notation);
        return bestCapture;
    }

    // 3. Tiến quân gần nhất về phía đích I9 (khoảng cách bước Vua ngắn nhất)
    const sortedByGoal = [...legalMoves].sort((a, b) => {
        const distA = helpers.distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
        const distB = helpers.distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
        return distA - distB;
    });

    log("Tiến về phía bên kia (I9):", sortedByGoal[0].notation);
    return sortedByGoal[0];
}`,

    // 2. Starter Bot for Red (Player 2)
    starterRed: `/**
 * 🔴 RED BOT - Starter Code
 * Mục tiêu DUY NHẤT để chiến thắng:
 * 👉 Đưa bất kỳ quân nào tới ô đích A1 (r=8, c=0) ở phía bên kia bàn cờ!
 */
function getNextMove(state, helpers, log) {
    const { legalMoves, myGoal, opponentPlayer, board } = state;

    // 1. Nước thắng ngay bằng cách chiếm ô A1
    const winMove = legalMoves.find(m => m.to.r === myGoal.r && m.to.c === myGoal.c);
    if (winMove) {
        log("🏆 Về đích A1 ở phía bên kia chiến thắng!", winMove.notation);
        return winMove;
    }

    // 2. Đánh giá tất cả nước đi hợp lệ theo điểm số chiến thuật
    let bestMove = legalMoves[0];
    let bestScore = -Infinity;

    for (const move of legalMoves) {
        let score = 0;

        // Điểm thưởng khi rút ngắn khoảng cách tới đích A1
        const curDist = helpers.distance(move.from.r, move.from.c, myGoal.r, myGoal.c);
        const newDist = helpers.distance(move.to.r, move.to.c, myGoal.r, myGoal.c);
        score += (curDist - newDist) * 35;

        // Điểm thưởng khi ăn quân đối thủ (dọn đường tiến công)
        if (move.capture) {
            score += 100;
        }

        // Điểm trừ an toàn: nếu đi vào ô có nguy cơ bị quân địch ăn
        const simBoard = helpers.simulateMove(board, move);
        const enemyMoves = helpers.getLegalMoves(opponentPlayer, simBoard);
        const isVulnerable = enemyMoves.some(em => em.to.r === move.to.r && em.to.c === move.to.c);
        if (isVulnerable) {
            score -= 70;
        }

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    log(\`Đội Đỏ chọn nước \${bestMove.notation} (Điểm: \${bestScore})\`);
    return bestMove;
}`,

    // 3. Random Bot
    random: `/**
 * 🎲 RANDOM BOT
 * Chọn ngẫu nhiên một nước đi hợp lệ.
 * Nếu có nước đi thẳng vào ô đích thì đi ngay để thắng!
 */
function getNextMove(state, helpers, log) {
    // 1. Kiểm tra nếu có nước chạm đích ở phía bên kia
    const winMove = state.legalMoves.find(m => m.to.r === state.myGoal.r && m.to.c === state.myGoal.c);
    if (winMove) return winMove;

    // 2. Chọn ngẫu nhiên trong danh sách legalMoves
    const move = helpers.randomChoice(state.legalMoves);
    log("Random bot chọn:", move.notation);
    return move;
}`,

    // 4. Goal Rusher Bot
    rusher: `/**
 * 🚀 GOAL RUSHER BOT
 * Chiến thuật: Thần tốc lao về đích ở phía đối diện (I9 đối với Xanh, A1 đối với Đỏ)!
 * Dùng khoảng cách Chebyshev (bước đi của Vua) để tìm đường ngắn nhất.
 */
function getNextMove(state, helpers, log) {
    const { legalMoves, myGoal } = state;

    // 1. Thắng ngay nếu chạm đích bên kia
    const winMove = legalMoves.find(m => m.to.r === myGoal.r && m.to.c === myGoal.c);
    if (winMove) {
        log("🚀 Chạm vạch đích chiến thắng!", winMove.notation);
        return winMove;
    }

    // 2. Sắp xếp các nước đi đưa quân lại gần đích nhất
    const sorted = [...legalMoves].sort((a, b) => {
        const distA = helpers.distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
        const distB = helpers.distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
        if (distA !== distB) return distA - distB;
        // Nếu khoảng cách bằng nhau, ưu tiên ăn quân cản đường
        return (b.capture ? 1 : 0) - (a.capture ? 1 : 0);
    });

    log(\`Lao về đích (\${helpers.toNotation(myGoal.r, myGoal.c)}): \${sorted[0].notation}\`);
    return sorted[0];
}`,

    // 5. Aggressive Hunter Bot
    hunter: `/**
 * ⚔️ AGGRESSIVE HUNTER BOT
 * Chiến thuật: Tiêu diệt quân cản đường và dọn sạch tuyến phòng thủ của đối thủ,
 * sau đó hộ tống quân cờ tiến về đích ở phía bên kia.
 */
function getNextMove(state, helpers, log) {
    const { legalMoves, myGoal } = state;

    // 1. Thắng ngay nếu có thể chạm đích
    const winGoal = legalMoves.find(m => m.to.r === myGoal.r && m.to.c === myGoal.c);
    if (winGoal) return winGoal;

    // 2. Tìm tất cả nước ăn quân
    const captures = legalMoves.filter(m => m.capture !== null);
    if (captures.length > 0) {
        // Ưu tiên ăn quân đối phương đang cản đường hoặc gần đích
        captures.sort((a, b) => {
            const distA = helpers.distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
            const distB = helpers.distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
            return distA - distB;
        });
        const best = captures[0];
        log(\`⚔️ Tiêu diệt quân cản đường \${best.capture}:\`, best.notation);
        return best;
    }

    // 3. Tiến quân về phía ô đích
    const sorted = [...legalMoves].sort((a, b) => {
        const distA = helpers.distance(a.to.r, a.to.c, myGoal.r, myGoal.c);
        const distB = helpers.distance(b.to.r, b.to.c, myGoal.r, myGoal.c);
        return distA - distB;
    });

    log("Tiến công về phía đích:", sorted[0].notation);
    return sorted[0];
}`,

    // 6. Tactical AI (Minimax / Advanced Heuristic Bot)
    tactical: `/**
 * 🧠 TACTICAL AI - Minimax Heuristic Bot
 * Chiến thuật đa chiều:
 * - Ưu tiên hàng đầu: Tiến về ô đích ở phía đối diện
 * - Chặn đứng đối thủ khi họ có nguy cơ áp sát ô đích của họ
 * - Dọn dẹp các quân địch đang đe dọa hoặc cản đường
 * - Giữ an toàn cho các quân đang ở vị trí dẫn đầu
 */
function getNextMove(state, helpers, log) {
    const { legalMoves, myGoal, opponentGoal, opponentPlayer, board } = state;

    // 1. Kiểm tra thắng ngay lập tức bằng cách bước vào ô đích
    for (const move of legalMoves) {
        if (move.to.r === myGoal.r && move.to.c === myGoal.c) {
            log("🏆 Chạm đích chiến thắng!", move.notation);
            return move;
        }
    }

    // 2. Đánh giá từng nước đi
    let bestMove = legalMoves[0];
    let bestScore = -Infinity;

    for (const move of legalMoves) {
        let score = 0;

        // A. Rút ngắn cự ly tới đích ở phía đối diện (Trọng số cao nhất)
        const curGoalDist = helpers.distance(move.from.r, move.from.c, myGoal.r, myGoal.c);
        const newGoalDist = helpers.distance(move.to.r, move.to.c, myGoal.r, myGoal.c);
        score += (curGoalDist - newGoalDist) * 50;

        // B. Thưởng ăn quân (dọn sạch đường đi)
        if (move.capture) {
            score += 120;
        }

        // C. Phân tích an toàn sau khi đi (1-ply lookahead)
        const simBoard = helpers.simulateMove(board, move);
        const oppMoves = helpers.getLegalMoves(opponentPlayer, simBoard);

        // Kiểm tra đối phương có thể ăn quân mình ở ô vừa đi đến không
        const isVulnerable = oppMoves.some(em => em.to.r === move.to.r && em.to.c === move.to.c);
        if (isVulnerable) {
            score -= 100;
        }

        // D. Phòng thủ: Chặn đối phương nếu đối phương sắp chạm đích (cách đích đối thủ <= 2 ô)
        const oppThreat = oppMoves.some(em => helpers.distance(em.to.r, em.to.c, opponentGoal.r, opponentGoal.c) <= 1);
        if (oppThreat) {
            const distToDefend = helpers.distance(move.to.r, move.to.c, opponentGoal.r, opponentGoal.c);
            score += (9 - distToDefend) * 25; // Cản phá ô đích
        }

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    log(\`Tactical AI tính toán: \${bestMove.notation} (Điểm: \${bestScore})\`);
    return bestMove;
}`
};
