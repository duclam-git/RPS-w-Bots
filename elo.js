// ===== OTTv2 Code Arena - Elo Rating & Leaderboard Module =====

(function (window) {
    'use strict';

    const STORAGE_KEY_LEADERBOARD = 'ott_elo_leaderboard';
    const STORAGE_KEY_PLAYER = 'ott_current_player';
    const DEFAULT_K = 32;
    const DEFAULT_STARTING_ELO = 1200;

    // Default Seed Leaderboard
    const DEFAULT_LEADERBOARD = [
        { name: "Grandmaster AI", elo: 1650, matches: 84, wins: 68, losses: 12, draws: 4, lang: "cpp", isBot: true },
        { name: "Tactical AI", elo: 1520, matches: 62, wins: 45, losses: 14, draws: 3, lang: "js", isBot: true },
        { name: "Python Hunter", elo: 1430, matches: 49, wins: 32, losses: 15, draws: 2, lang: "py", isBot: true },
        { name: "Goal Rusher AI", elo: 1340, matches: 38, wins: 21, losses: 15, draws: 2, lang: "js", isBot: true },
        { name: "Random AI", elo: 1000, matches: 30, wins: 6, losses: 23, draws: 1, lang: "js", isBot: true }
    ];

    function getStoredLeaderboard() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_LEADERBOARD);
            if (!raw) {
                localStorage.setItem(STORAGE_KEY_LEADERBOARD, JSON.stringify(DEFAULT_LEADERBOARD));
                return [...DEFAULT_LEADERBOARD];
            }
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_LEADERBOARD];
        } catch (e) {
            return [...DEFAULT_LEADERBOARD];
        }
    }

    function saveLeaderboard(list) {
        try {
            list.sort((a, b) => b.elo - a.elo);
            localStorage.setItem(STORAGE_KEY_LEADERBOARD, JSON.stringify(list));
        } catch (e) {
            console.error("Failed to save leaderboard", e);
        }
    }

    function getCurrentPlayer() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_PLAYER);
            if (raw) {
                const p = JSON.parse(raw);
                if (p && p.name) return p;
            }
        } catch (e) {}
        return null;
    }

    function setCurrentPlayer(name, preferredLang = 'javascript') {
        const cleanName = (name || '').trim() || 'Người chơi ' + Math.floor(1000 + Math.random() * 9000);
        let board = getStoredLeaderboard();
        let existing = board.find(p => p.name.toLowerCase() === cleanName.toLowerCase());

        let playerObj;
        if (existing) {
            existing.lang = preferredLang;
            playerObj = existing;
        } else {
            playerObj = {
                name: cleanName,
                elo: DEFAULT_STARTING_ELO,
                matches: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                lang: preferredLang,
                isBot: false
            };
            board.push(playerObj);
        }

        saveLeaderboard(board);
        localStorage.setItem(STORAGE_KEY_PLAYER, JSON.stringify(playerObj));
        return playerObj;
    }

    /**
     * Standard FIDE Elo calculation formula
     * Ra' = Ra + K * (Sa - Ea)
     * Ea = 1 / (1 + 10 ^ ((Rb - Ra) / 400))
     */
    function calculateEloChange(ratingA, ratingB, scoreA, kFactor = DEFAULT_K) {
        const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
        const delta = Math.round(kFactor * (scoreA - expectedA));
        return {
            expectedA,
            deltaA: delta,
            deltaB: -delta,
            newA: Math.max(100, ratingA + delta),
            newB: Math.max(100, ratingB - delta)
        };
    }

    /**
     * Record match outcome
     * winner: 1 (Blue won), 2 (Red won), 'draw'
     */
    function recordMatch({ blueName, redName, blueLang = 'js', redLang = 'js', winner }) {
        let board = getStoredLeaderboard();

        let bluePlayer = board.find(p => p.name.toLowerCase() === blueName.toLowerCase());
        if (!bluePlayer) {
            bluePlayer = { name: blueName, elo: DEFAULT_STARTING_ELO, matches: 0, wins: 0, losses: 0, draws: 0, lang: blueLang, isBot: false };
            board.push(bluePlayer);
        }

        let redPlayer = board.find(p => p.name.toLowerCase() === redName.toLowerCase());
        if (!redPlayer) {
            redPlayer = { name: redName, elo: DEFAULT_STARTING_ELO, matches: 0, wins: 0, losses: 0, draws: 0, lang: redLang, isBot: false };
            board.push(redPlayer);
        }

        let scoreBlue = winner === 1 ? 1 : (winner === 'draw' ? 0.5 : 0);
        const { deltaA, deltaB, newA, newB } = calculateEloChange(bluePlayer.elo, redPlayer.elo, scoreBlue);

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

        const oldBlueElo = bluePlayer.elo;
        const oldRedElo = redPlayer.elo;
        bluePlayer.elo = newA;
        redPlayer.elo = newB;

        saveLeaderboard(board);

        // Update current player if participating
        const cur = getCurrentPlayer();
        if (cur) {
            if (cur.name.toLowerCase() === blueName.toLowerCase()) {
                localStorage.setItem(STORAGE_KEY_PLAYER, JSON.stringify(bluePlayer));
            } else if (cur.name.toLowerCase() === redName.toLowerCase()) {
                localStorage.setItem(STORAGE_KEY_PLAYER, JSON.stringify(redPlayer));
            }
        }

        return {
            blue: { name: blueName, oldElo: oldBlueElo, newElo: newA, delta: deltaA },
            red: { name: redName, oldElo: oldRedElo, newElo: newB, delta: deltaB }
        };
    }

    window.EloSystem = {
        DEFAULT_STARTING_ELO,
        getLeaderboard: getStoredLeaderboard,
        saveLeaderboard,
        getCurrentPlayer,
        setCurrentPlayer,
        calculateEloChange,
        recordMatch
    };

})(window);
