# Nhiều trò chơi (vấn đề #6) và luật mở rộng

Giải đấu, lịch sử, replay, xếp hạng, sandbox đều chạy trên một **lớp trò chơi** (`games/`). Hiện có hai trò:

| id | Trò chơi | Nước đi | Luật chỉnh được |
|---|---|---|---|
| `rps` | Oẳn tù tì — đấu trường quân cờ (gốc) | di chuyển quân: `{from, to}` | cỡ bàn 5–15, bảng "ai ăn được ai", thế cờ, ô đích, giới hạn nước, thời gian |
| `caro` | **Cờ Caro / Gomoku** | đặt quân: `{to}` | cỡ bàn 3–19, số quân liên tiếp để thắng 3–6, giới hạn nước, thời gian |

Caro "freestyle": ai có đủ N quân liên tiếp (hàng/cột/chéo) trước thì thắng (6 quân liền cũng tính); bàn kín là hòa; Xanh đi trước. Bàn 3×3 với N=3 là cờ ca-rô 3 ô.

## Viết bot

Hàm `getNextMove(state, helpers, log)` (JS) / đọc JSON từ stdin, in JSON ra stdout (Python, C++) — như cũ. Khác nhau ở `state` và kết quả:

**RPS** — `state.board`, `myPlayer`, `legalMoves`, `myGoal`, `opponentGoal`, `myCounts`, `opponentCounts`, `moveHistory`, và mới: `state.rules` (`rows`, `cols`, `beats`, ô đích…). Trả về `{ "from":{r,c}, "to":{r,c} }`.

**Caro** — `state.grid` (mảng chuỗi, mỗi ký tự: `0` trống, `1` Xanh, `2` Đỏ — dễ đọc nhất cho C++), `state.board`, `myPlayer`, `opponentPlayer`, `winLength`, `legalMoves` (`[{to:{r,c}}]`), `moveHistory`, `rules`. Trả về `{ "to":{r,c} }`.

`helpers` (JS) lấy từ **engine của chính trò chơi** và luôn nhận `state.rules`: `getLegalMoves(player, board)`, `simulateMove(board, move, player)`, `toNotation(r,c)`, `fromNotation(s)`, `randomChoice(arr)`, `distance(...)`; RPS thêm `canCapture`, `getPieceCounts`, `getPieces`; Caro thêm `checkWin(board)`. Các mẫu code (Chèn code mẫu trong form đăng ký) có sẵn cho cả ba ngôn ngữ và cả hai trò — bot mẫu Caro thắng bot ngẫu nhiên ≥ 5/6 ván (có test).

Bot viết cho trò khác bị từ chối ngay lúc đăng ký, kèm lý do (bài kiểm tra chạy thử dùng đúng trò của giải).

## Dùng trong giải đấu

Quản trị → Tạo giải: chọn **Trò chơi**, form luật đổi theo (RPS: cỡ bàn, bảng khắc chế, trình soạn thế cờ; Caro: cỡ bàn, số quân thắng, bàn xem trước). Đổi trò chơi chỉ được khi chưa có bot đăng ký và chưa bắt đầu. Lịch sử có bộ lọc theo trò chơi; replay và xem trực tiếp tự vẽ đúng loại quân (quân Caro, không có ô đích).

## Cờ Caro ở khu người chơi (`caro.html`)

Trước đây Caro chỉ có trong giải đấu. Nay người chơi chọn Caro ở trang người chơi và có trang riêng:

| Chức năng | Chi tiết |
|---|---|
| Chơi tay | Chọn "👤 Người chơi" cho một bên, bấm vào ô. Bàn 3×3 (3 quân), 9×9, 13×13, 15×15, 19×19. |
| Bot có sẵn | 6 chiến thuật (`caro_strategies.js`): 🎲 Ngẫu nhiên, 🎯 Giữ trung tâm, ⚔️ Tấn công, 🛡 Phòng thủ, ⚖️ Cân bằng, 🧠 Minimax α-β. Mỗi cái là một file code hoàn chỉnh có chú thích. |
| Code mẫu | JS: cả 6; Python: ngẫu nhiên, tấn công, phòng thủ, cân bằng; C++: ngẫu nhiên, cân bằng. "⤵ Nạp mẫu" trong tab Code. |
| Code của tôi | JavaScript chạy trong Web Worker của trình duyệt; Python/C++ chạy trên server qua `POST /api/run-bot-move` (có tham số `game`). |
| Bot đấu bot | Xem từng nước (hai bên đều là bot), hoặc "📊 Bot đấu bot" chạy 10–100 ván trong worker, **đổi màu mỗi ván**, báo tỉ lệ thắng. |
| Online | Phòng có `game` (`create_room { game:'caro', rules:{size, winLength} }`). Trang Caro vào phòng RPS (hoặc ngược lại) bị từ chối kèm lý do. Trận Caro online được lưu (`matches.game = 'caro'`) nhưng **không tính Elo** (Elo là bảng xếp hạng Oẳn tù tì). |
| Lịch sử | Ván luyện tập được gửi lên `POST /api/matches/local { game:'caro', rules }`; server chạy lại từng nước bằng engine Caro rồi mới lưu. |

Độ mạnh các chiến thuật được kiểm bằng test (`test/caro.test.js`): mọi bot thắng bot ngẫu nhiên ≥ 5/6 ván, minimax thắng nhiều hơn thua trước ba bot heuristic trên bàn 15×15.

## Luật RPS mở rộng

- **Cỡ bàn** `size` 5–15 (vuông). Đổi cỡ bàn thì phải tự đặt thế cờ (thế mặc định là của bàn 9×9) và ô đích tự về hai góc đối diện.
- **Bảng khắc chế** `beats`: ma trận 3×3, hàng ăn được cột; mặc định Đá > Kéo > Giấy > Đá, có nút đảo chiều. Phải có ít nhất một quan hệ, không quân nào tự ăn chính nó.
- Mọi luật nằm trong `rules_json` của từng ván nên replay đúng dù luật sau này đổi; bot nhận luật qua `state.rules` (và `helpers.canCapture` theo bảng khắc chế riêng của giải).

## Thêm một trò chơi mới

1. `games/<id>.js` — engine **tự đủ, không `require`** (file này được gắn nguyên vào sandbox cho `helpers` của bot JS): `DEFAULT_RULES`, `resolveRules`, `validateRules` → `{ok, errors, rules}`, `createInitialBoard`, `cloneBoard`, `getLegalMoves(player, board, rules)`, `applyMove(board, move, player, rules)`, `checkWin(board, rules)` → `{winner: 1|2|'draw'|null, reason}`, `replayAndValidate(moves, rules)`.
2. `games/index.js` — đăng ký, kèm `botState({board, player, legalMoves, rules, moves})` (dữ liệu bot nhận), `matchMove(legalMoves, botMove)` (nước bot trả về có hợp lệ không), `botHint`, `enginePath`.
3. `bot_templates.js` — mẫu code cho 3 ngôn ngữ trong `GAME_TEMPLATES`.
4. Nếu hình thức khác: thêm cách vẽ quân trong `boardHTML()` ở `arena.js`, và (nếu có luật riêng) khối luật trong trình soạn giải.
5. Test theo `test/caro.test.js`: engine, mẫu bot đấu chéo ba ngôn ngữ, replay khớp kết quả.

CSDL (migration v3): `tournaments.game`, `matches.game` (mặc định `rps` nên dữ liệu cũ nguyên vẹn), và `match_moves.from_*` cho phép NULL (nước đặt quân). Có test nâng cấp từ CSDL v2 thật.
