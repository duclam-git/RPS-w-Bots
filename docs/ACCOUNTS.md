# Tài khoản, đăng nhập, Elo (vấn đề #2) và sửa lỗi chạy bot (vấn đề #1)

## 1. Tài khoản

| Việc | Cách làm |
|---|---|
| Đăng ký / đăng nhập | Nút 🔐 trên `arena.html` (hoặc link "Đăng nhập" ở trang chính). Tên 3–20 ký tự `A-Za-z0-9_.-`, mật khẩu 8–128 ký tự. |
| Lưu mật khẩu | `scrypt` (có sẵn trong Node, không cần thư viện native), salt ngẫu nhiên mỗi người. |
| Phiên đăng nhập | Token ngẫu nhiên 256-bit trong cookie `HttpOnly; SameSite=Lax` (thêm `Secure` khi chạy HTTPS hoặc `COOKIE_SECURE=1`). DB chỉ lưu SHA-256 của token nên lộ DB cũng không dùng lại được. Hết hạn sau 30 ngày. |
| Socket.io | Handshake mang cùng cookie → server biết ai đang ngồi ghế Xanh/Đỏ. Người dùng không thể tự đặt tên khác tên tài khoản của mình. |
| Chống đoán mật khẩu | Giới hạn theo IP + khóa tăng dần theo tên đăng nhập (5 lần sai → khóa 30 giây, nhân đôi mỗi lần sai tiếp). Có hash giả khi tên không tồn tại để không lộ tên nào có thật qua thời gian phản hồi. |
| CSRF | Request ghi (POST/PUT/DELETE) có header `Origin` khác host bị từ chối + cookie `SameSite=Lax`. |
| Đổi mật khẩu | Trang hồ sơ của mình; mọi thiết bị khác bị đăng xuất. |
| Admin | Đăng nhập → bấm 🔑 → nhập `ADMIN_KEY` **một lần** → tài khoản thành admin vĩnh viễn (cột `role`). Header `X-Admin-Key` vẫn dùng được cho script. |

Tên trùng bot hệ thống (Grandmaster AI, Tactical AI…) bị chặn khi đăng ký; khách (chưa đăng nhập) dùng tên đó sẽ bị đổi thành `… (khách)`.

## 2. Thành tích và Elo

- **Elo (bảng xếp hạng)** chỉ đổi ở trận **Online giữa hai tài khoản khác nhau** (K=32, khởi điểm 1200, tối thiểu 100). Đấu với khách, hoặc cùng một tài khoản ngồi hai ghế → vẫn lưu lịch sử nhưng **không** tính điểm. Cách này chặn việc cày Elo bằng tên giả — lỗ hổng của bản cũ, nơi bảng xếp hạng khóa theo *tên do trình duyệt tự gõ*.
- **Hồ sơ** `#/profile/<tên>`: Elo, hạng, thắng-thua-hòa, thành tích theo loại trận (Online / Giải đấu / Luyện tập, tính từ bảng `matches`), giải đã tham gia (🥇 nếu vô địch), 10 trận gần nhất.
- **Ảnh hưởng đến giải đấu:** đăng ký giải bằng tài khoản (mặc định bắt buộc, tắt bằng `requireLogin:false`), mỗi tài khoản 1 bot/giải, tên thi đấu = tên tài khoản; admin có kiểu xếp seed **"Theo Elo"** (mạnh nhất = seed 1, khách tính 1200); mọi ván giải đấu gắn với tài khoản nên hiện trong hồ sơ và bộ lọc "Chỉ trận của tôi".
- Trận luyện tập trong trình duyệt gắn với tài khoản cho phía do bạn điều khiển (bot code / thủ công).
- Bảng xếp hạng cũ trong `leaderboard.json` chỉ còn dùng cho các AI tham chiếu 🤖 (chỉ đọc). Điểm của người chơi cũ theo tên **không** được chuyển sang (vì không xác minh được chủ sở hữu).

API: `POST /api/auth/register|login|logout|password|claim-admin|lang`, `GET /api/auth/me`, `GET /api/leaderboard`, `GET /api/users/:tên`, `GET /api/matches?mine=1|user=<tên>`.
CSDL: migration v2 trong `db.js` — `users`, `sessions`, cột `entries.user_id`, `matches.blue_user_id/red_user_id`.

## 3. Lỗi "Ace Editor không nhận 2 ngôn ngữ / chạy bị lỗi" (#1) — các nguyên nhân thật tìm được

1. **Code mẫu C++ không biên dịch được.** Trong `bot_templates.js`, `\"` và `\d` nằm trong template literal của JS nên bị nuốt thành `"` và `d` → lỗi biên dịch, và regex tìm `d` thay vì chữ số. Viết lại bằng `String.raw`.
2. **Mẫu C++ đọc nhầm `moveHistory` thành `legalMoves`** (regex quét cả chuỗi JSON, mà lịch sử nước đi cũng có `from/to`) → bot đi sai luật, bị thay bằng nước ngẫu nhiên từ giữa ván. Giờ chỉ đọc mảng `legalMoves`, và đích lấy từ `state.myGoal`.
3. **Chế độ textarea dự phòng bị hỏng:** khi Ace không tải được (CDN bị chặn), đổi ngôn ngữ không đổi code, và `getBotCode()` **không bao giờ đọc textarea** nên code người dùng gõ bị bỏ qua hoàn toàn (nộp online cũng gửi chuỗi rỗng). Đã thống nhất qua `getEditorCode()/setEditorCode()`.
4. **Ace + mode Python/C++ phụ thuộc CDN.** Giờ server tự phát (`/vendor/ace/*`, gói `ace-builds`), CDN chỉ còn là dự phòng → chạy được cả trên mạng LAN không Internet. Socket.io client cũng vậy.
5. **C++ chế độ luyện tập biên dịch lại ở *mỗi nước đi*** (vài giây/nước). Giờ cache theo SHA-1 của code.
6. **Thiếu g++/python thì báo lỗi khó hiểu** hoặc im lặng đi ngẫu nhiên. Giờ server dò công cụ lúc khởi động (in ra console, `GET /api/languages`), báo rõ cách cài; lỗi biên dịch không còn lộ đường dẫn thư mục máy chủ.
7. **Python trên Windows** mặc định mã hóa console cũ → bot in log tiếng Việt là crash. Ép `PYTHONUTF8=1`.

### Gia cố khi chạy code người lạ (làm kèm)
- Tiến trình bot **không còn thừa hưởng biến môi trường của server** (trước đây `process.env.ADMIN_KEY` đọc được từ bot!). Có test.
- Bot in quá 1MB bị dừng; JS bot chạy bằng đúng `node` của server.
- `/api/run-bot-move`: giới hạn tần suất, giới hạn 100KB, và `ALLOW_LOCAL_RUN=0` để tắt hẳn khi mở ra Internet.
- Cách ly thật (bubblewrap) đã có từ phiên bản sau — xem [`SECURITY.md`](SECURITY.md).
