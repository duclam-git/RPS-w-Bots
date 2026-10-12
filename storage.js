// ===== OTTv2 Code Arena - Server Storage & Leaderboard Data =====

const fs = require('fs');
const path = require('path');

const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

const DEFAULT_LEADERBOARD = [
    { name: "Grandmaster AI", elo: 1650, matches: 84, wins: 68, losses: 12, draws: 4, lang: "cpp", isBot: true },
    { name: "Tactical AI", elo: 1520, matches: 62, wins: 45, losses: 14, draws: 3, lang: "js", isBot: true },
    { name: "Python Hunter", elo: 1430, matches: 49, wins: 32, losses: 15, draws: 2, lang: "py", isBot: true },
    { name: "Goal Rusher AI", elo: 1340, matches: 38, wins: 21, losses: 15, draws: 2, lang: "js", isBot: true },
    { name: "Random AI", elo: 1000, matches: 30, wins: 6, losses: 23, draws: 1, lang: "js", isBot: true }
];

function getLeaderboard() {
    try {
        if (!fs.existsSync(LEADERBOARD_FILE)) {
            fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(DEFAULT_LEADERBOARD, null, 2), 'utf-8');
            return [...DEFAULT_LEADERBOARD];
        }
        const data = fs.readFileSync(LEADERBOARD_FILE, 'utf-8');
        const list = JSON.parse(data);
        return Array.isArray(list) ? list : [...DEFAULT_LEADERBOARD];
    } catch (e) {
        return [...DEFAULT_LEADERBOARD];
    }
}

function saveLeaderboard(list) {
    try {
        list.sort((a, b) => b.elo - a.elo);
        fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
        console.error("Lỗi lưu file leaderboard.json:", e);
    }
}

function updateMatchResult({ blueName, redName, blueLang = 'js', redLang = 'js', winner }) {
    let board = getLeaderboard();

    let bluePlayer = board.find(p => p.name.toLowerCase() === blueName.toLowerCase());
    if (!bluePlayer) {
        bluePlayer = { name: blueName, elo: 1200, matches: 0, wins: 0, losses: 0, draws: 0, lang: blueLang, isBot: false };
        board.push(bluePlayer);
    }

    let redPlayer = board.find(p => p.name.toLowerCase() === redName.toLowerCase());
    if (!redPlayer) {
        redPlayer = { name: redName, elo: 1200, matches: 0, wins: 0, losses: 0, draws: 0, lang: redLang, isBot: false };
        board.push(redPlayer);
    }

    const K = 32;
    const scoreBlue = winner === 1 ? 1 : (winner === 'draw' ? 0.5 : 0);
    const expectedBlue = 1 / (1 + Math.pow(10, (redPlayer.elo - bluePlayer.elo) / 400));
    const deltaBlue = Math.round(K * (scoreBlue - expectedBlue));
    const deltaRed = -deltaBlue;

    bluePlayer.matches++;
    redPlayer.matches++;
    bluePlayer.lang = blueLang;
    redPlayer.lang = redLang;

    if (winner === 1) {
        bluePlayer.wins++;
        redPlayer.losses++;
    } else if (winner === 2) {
        bluePlayer.losses++;
        redPlayer.wins++;
    } else {
        bluePlayer.draws++;
        redPlayer.draws++;
    }

    const oldBlue = bluePlayer.elo;
    const oldRed = redPlayer.elo;
    bluePlayer.elo = Math.max(100, bluePlayer.elo + deltaBlue);
    redPlayer.elo = Math.max(100, redPlayer.elo + deltaRed);

    saveLeaderboard(board);

    return {
        blue: { name: blueName, oldElo: oldBlue, newElo: bluePlayer.elo, delta: deltaBlue },
        red: { name: redName, oldElo: oldRed, newElo: redPlayer.elo, delta: deltaRed },
        updatedLeaderboard: board
    };
}

module.exports = {
    getLeaderboard,
    saveLeaderboard,
    updateMatchResult
};
