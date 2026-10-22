# Giải đấu & Lịch sử trận (vấn đề #3 và #5)

> Tài khoản & sửa lỗi Ace/chạy bot: xem [`ACCOUNTS.md`](ACCOUNTS.md).

## 1. Kiến trúc

```
Browser (arena.html / arena.js)                 Browser (index.html)
   │  REST  /api/...        Socket.io               │ Socket.io (phòng online, như cũ)
   ▼                          ▼                      ▼
┌────────────────────────── server.js ─────────────────────────────┐
│ api.js         REST: lịch sử, replay, giải đấu, admin             │
│ tournament.js  chia nhánh/bảng, lịch đấu, xếp hạng, chạy nền      │
│ matchplay.js   vòng lặp 1 ván (dùng chung phòng online + giải)    │
│ engine.js      luật chơi thuần (không I/O), có replayAndValidate  │
│ runner.js      chạy bot JS / Python / C++ qua stdin-stdout        │
│ db.js          SQLite (better-sqlite3)  →  data/ott.db            │
└───────────────────────────────────────────────────────────────────┘
```

Nguyên tắc: **server giữ bàn cờ (authoritative)**. Bot chỉ nhận snapshot JSON và trả nước đi; nước sai / timeout / crash → server đi ngẫu nhiên và đánh dấu `fallback` (hiện ⚠️ trong replay).

## 2. Chạy

```bash
npm install
ADMIN_PASSWORD=matkhau_admin ADMIN_KEY=khoa_admin npm start   # PowerShell: $env:ADMIN_KEY="..."; npm start
# mở  http://localhost:3000  (trang đăng nhập)
npm test                                  # 76 test: unit, end-to-end, bot tấn công, nginx thật
```
Không đặt `ADMIN_KEY` → server tự sinh khóa và in ra console (đổi mỗi lần chạy). Admin đăng nhập ở `login.html` bằng tài khoản admin + mật khẩu, rồi nhập khóa này (xem `docs/ACCOUNTS.md` mục 1b).
Biến môi trường khác: `PORT`, `DB_PATH` (mặc định `data/ott.db`), `PYTHON_CMD`.

## 3. Lịch sử & xem lại trận (#3)

- Trận **Online** và trận **giải đấu** được server tự lưu khi kết thúc.
- Trận **luyện tập** trong trình duyệt được client gửi lên `POST /api/matches/local`. Server **chạy lại từng nước bằng engine** và tự suy ra người thắng (client không thể khai gian). Benchmark 50x không lưu.
- Trang `#/matches`: lọc theo loại / tên người chơi, phân trang. Trang `#/match/ID`: replay có Phát/Tạm dừng, tua, tốc độ 0.5×–15×, phím ← → Space Home End, danh sách nước đi, quân đã bắt, nhật ký bot từng nước.
- Mỗi ván lưu `rules_json` (snapshot luật) nên replay vẫn đúng dù sau này đổi luật.

## 4. Giải đấu (#5)

| Thể thức | Mô tả |
|---|---|
| `single_elim` | Loại trực tiếp. Số bot bất kỳ (tự thêm bye lên lũy thừa 2), seed chuẩn (1 gặp hạng thấp nhất…), tùy chọn tranh hạng 3. |
| `round_robin` | Một bảng, mọi người gặp nhau (circle method). |
| `groups_knockout` | Chia N bảng (rắn: 1,2..N,N..2,1), vòng tròn trong bảng, top K mỗi bảng vào nhánh loại trực tiếp (xếp chéo để cùng bảng gặp nhau muộn). |

- **Cặp đấu (series)** = best-of-N ván, **đổi bên Xanh/Đỏ mỗi ván** (Xanh đi trước nên có lợi thế; với bot giống nhau Xanh luôn thắng). Chốt sớm khi một bên đủ số ván thắng.
- Knockout hòa sau N ván → đấu thêm tối đa 4 ván "cái chết đột ngột"; vẫn hòa → bên có seed tốt hơn đi tiếp.
- Vòng bảng: thắng cặp 3đ, hòa 1đ; xếp theo điểm → hiệu số ván → số ván thắng → **đối đầu trực tiếp** → seed. Thể thức vòng tròn mà bảng vẫn đồng hạng hoàn toàn ở ngôi đầu thì **tự đá playoff** giữa các đội đó (loại trực tiếp, số ván như knockout) thay vì để seed quyết định.
- **Hiển thị nhánh đấu:** các cặp được nối bằng đường (SVG vẽ theo vị trí thật của thẻ, tự vẽ lại khi đổi cỡ màn hình). Cặp đã xong: đường **xanh lá đậm** xuất phát từ đúng dòng người thắng tới vòng sau, người thắng có nền xanh + ▶, người thua mờ và gạch ngang; cặp đang đấu: đường **xanh dương nét đứt chạy**; chưa đấu: nét đứt xám. Cột cuối "Vô địch" hiện nhà vô địch (viền vàng). Có chú giải màu ở góc thẻ, chạy được ở giao diện tối.
- Sau vòng bảng, khi xếp nhánh knockout những đội cùng bảng được **tách ra khỏi nhau ở vòng đầu** (trường hợp 4 bảng đi tiếp 2 trước đây ra toàn các cặp cùng bảng).
- Đăng ký bằng **tài khoản** (mặc định; `requireLogin:false` cho giải mở): tên thi đấu = tên tài khoản, 1 bot/tài khoản, tự sửa/rút bot đến khi admin chốt. Server **biên dịch + chạy thử bot** trên thế cờ khởi đầu và từ chối kèm lý do nếu lỗi (trước đây lỗi chỉ lộ ra khi bot âm thầm đi ngẫu nhiên suốt giải). Giải mở (không cần đăng nhập) dùng `editToken` lưu trong trình duyệt.
- Admin (phiên admin đã qua bước khóa; header `X-Admin-Key` chỉ khi bật `ADMIN_KEY_HEADER=1`): tạo giải, chốt & bắt đầu (seed theo **Elo** / thứ tự đăng ký / ngẫu nhiên / thủ công qua API), **chạy toàn bộ**, **chạy 1 cặp**, **tạm dừng**, xóa bot, xóa giải.
- Chế độ trình diễn: `moveDelayMs` 300–500 để khán giả xem từng nước; ván đang chạy phát qua Socket.io cho mọi người xem (người vào muộn nhận snapshot).
- Bền vững: ván chỉ ghi DB khi kết thúc; tạm dừng hoặc server sập → cặp đang dở quay về `ready`, các ván đã xong giữ nguyên; khởi động lại tự chạy tiếp giải đang `auto_run`.

## 5. API

| Method | Đường dẫn | Quyền |
|---|---|---|
| GET | `/api/matches?kind=&player=&tournament=&limit=&offset=` | công khai |
| GET | `/api/matches/:id` (kèm `initialBoard`, `moves`) | công khai |
| POST | `/api/matches/local` | công khai (rate-limit, server kiểm tra lại) |
| GET | `/api/tournaments`, `/api/tournaments/:id` | công khai (không lộ code bot / token) |
| POST | `/api/tournaments/:id/entries` · PUT `/entries/:eid` (`X-Entry-Token`) | công khai, rate-limit |
| POST | `/api/tournaments` · DELETE `/:id` · POST `/:id/start` `/run` `/pause` · DELETE `/:id/entries/:eid` | admin |

Socket.io: client gửi `watch_tournament(id)` → nhận `live_snapshot`, `live_game_start`, `live_game_move`, `live_game_end`, `tournament_updated`.

## 6. CSDL (SQLite)

`tournaments` · `entries` (code bot, edit_token, seed, group_no) · `series` (cặp đấu / nút nhánh, liên kết `win_next`, `lose_next`) · `matches` · `match_moves` (từng nước, PK `(match_id, ply)`). Migration theo `PRAGMA user_version` trong `db.js`.

## 7. Thay đổi ngoài phạm vi, cần biết

- `server.js`: phòng online dùng chung `matchplay.js` (sửa luôn lỗi cũ: rời phòng giữa trận vẫn để vòng lặp bot chạy tiếp). Static chỉ phục vụ **whitelist** file giao diện — trước đây `express.static(__dirname)` sẽ cho tải cả `data/ott.db` (chứa code bot), `server.js`…
- `runner.js`: wrapper JS giờ có đủ `helpers` như README (`simulateMove`, `getLegalMoves`…), `log()` thật; Python dùng `python3` trên Linux/macOS (`PYTHON_CMD` để đổi); dọn `temp_bots` khi khởi động.
- `logic.js` / `index.html`: link sang Giải đấu/Lịch sử, upload trận luyện tập, nút "Xem lại trận này".

## 8. Còn lại

Tất cả hạng mục trong danh sách ban đầu và các việc tồn đọng đã xong. Những điều **chưa làm / chưa kiểm chứng**, nói thẳng:

1. Phòng đấu **Online** và luyện tập ở `index.html` vẫn chỉ có RPS (giải đấu/lịch sử/replay thì đủ hai trò) — xem `GAMES.md`.
2. Giới hạn RAM/CPU áp theo **từng tiến trình bot**; có trần *tổng* số tiến trình (`MAX_BOT_PROCS`) nhưng chưa có cgroup tổng (`SECURITY.md` §5).
3. **Docker/compose chưa được build** (môi trường phát triển không có Docker); nginx đã test thật, Caddy và systemd thì chưa (`DEPLOY.md`).
4. Chưa chạy thử trên **Windows/macOS** (nhất là tầng sandbox cơ bản và biên dịch C++).
5. Điểm Elo cũ theo tên (trước khi có tài khoản) không được chuyển; Elo chỉ tính từ trận Online RPS giữa hai tài khoản.
6. Playoff khi hòa ở ranh giới *đi tiếp* của vòng bảng (hạng 2–3 đồng hạng hoàn toàn) vẫn do seed quyết định; chỉ ngôi đầu vòng tròn mới có playoff.
7. Dọn repo: `npm run cleanup-repo` (bỏ 1.190 tệp `node_modules`/`temp_bots` khỏi git).

Đã xong: #1 Ace/ngôn ngữ, #2 tài khoản (`ACCOUNTS.md`), #3 lịch sử & replay, #4 quản trị (`ADMIN.md`), #5 giải đấu, sandbox (`SECURITY.md`), mạng & vận hành (`DEPLOY.md`), #6 nhiều trò chơi (`GAMES.md`).
