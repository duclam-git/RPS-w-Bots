# Tài khoản, đăng nhập, Elo (vấn đề #2) và sửa lỗi chạy bot (vấn đề #1)

## 1. Tài khoản

| Việc | Cách làm |
|---|---|
| Đăng ký / đăng nhập | **Trang riêng `login.html`** (mở `/` khi chưa đăng nhập là tự vào đây). Tên 3–20 ký tự `A-Za-z0-9_.-`, mật khẩu 8–128 ký tự. Xong thì vào **trang người chơi `home.html`** (thành tích, lịch sử, chọn trò chơi) → chọn trò → trang trò chơi (`index.html` Oẳn tù tì, `caro.html` Cờ Caro). Các trang khu người chơi tự chuyển về trang đăng nhập nếu chưa có phiên. |
| Lưu mật khẩu | `scrypt` (có sẵn trong Node, không cần thư viện native), salt ngẫu nhiên mỗi người. |
| Phiên đăng nhập | Token ngẫu nhiên 256-bit trong cookie `HttpOnly; SameSite=Lax` (thêm `Secure` khi chạy HTTPS hoặc `COOKIE_SECURE=1`). DB chỉ lưu SHA-256 của token nên lộ DB cũng không dùng lại được. Hết hạn sau 30 ngày (phiên admin: 8 giờ). |
| Socket.io | Handshake mang cùng cookie → server biết ai đang ngồi ghế Xanh/Đỏ. Người dùng không thể tự đặt tên khác tên tài khoản của mình. **Tạo/vào phòng online cần đăng nhập** (`ALLOW_GUEST_ROOMS=1` để cho khách như bản cũ). Khi phiên chết (đăng xuất, đổi/đặt lại mật khẩu, đổi quyền) server báo `session_revoked` và **đóng luôn các socket của phiên đó** — trước đây socket vẫn chạy dưới tên tài khoản cho tới khi tải lại trang. |
| Chống đoán mật khẩu | Giới hạn theo IP + khóa tăng dần theo tên đăng nhập (5 lần sai → khóa 30 giây, nhân đôi mỗi lần sai tiếp). Có hash giả khi tên không tồn tại để không lộ tên nào có thật qua thời gian phản hồi. |
| CSRF | Request ghi (POST/PUT/DELETE) có header `Origin` khác host bị từ chối + cookie `SameSite=Lax`. |
| Đổi mật khẩu | Trang hồ sơ của mình; mọi thiết bị khác bị đăng xuất. |
| Admin | Xem mục 1b. |

## 1b. Đăng nhập admin (gộp với đăng nhập người chơi)

Một trang đăng nhập cho tất cả. Tài khoản admin đăng nhập **hai bước**:

1. Tên + mật khẩu như người chơi. Nếu tài khoản có quyền admin, server **chưa** tạo phiên mà chỉ trả `{ needAdminKey: true }` kèm một cookie thử thách `ott_admin_challenge` (ngẫu nhiên 256-bit, `HttpOnly; SameSite=Strict; Path=/api/auth`, sống 2 phút, dùng một lần, chỉ lưu SHA-256 trong bộ nhớ).
2. Trang hỏi **bước thứ hai** → `POST /api/auth/admin-verify`. Có hai chế độ (`ADMIN_KEY_MODE`):
   - `console` (mặc định khi không đặt `ADMIN_KEY`): **mỗi lần đăng nhập** server in ra console một **mã 6 số** riêng cho lần đó (`crypto.randomInt`, chỉ lưu băm, sống cùng thử thách 2 phút, dùng một lần). Không có bí mật nào nằm trong `.env` hay repo.
   - `static` (mặc định khi có `ADMIN_KEY`): nhập khóa cố định `ADMIN_KEY`, dành cho admin không xem được console của server.

   Đúng mã/khóa Đúng → phiên admin (`sessions.admin_verified = 1`, hết hạn sau `ADMIN_SESSION_TTL_HOURS`, mặc định 8 giờ) và chuyển thẳng tới `arena.html#/admin`. Sai 3 lần → thử thách bị hủy, phải nhập lại mật khẩu; mỗi lần sai cũng tính vào khóa chống dò theo tên đăng nhập.

Quyền admin = **tài khoản role admin VÀ phiên đã qua bước khóa**. Hệ quả:
- Biết mã/khóa admin mà không có mật khẩu admin thì không làm gì được (đường cũ `claim-admin` "ai có khóa cũng thành admin" đã bỏ, trả 410). Lộ mật khẩu admin mà không có khóa cũng vậy.
- Admin nâng/hạ quyền ai đó → mọi phiên của người đó bị thu hồi; người mới lên admin phải đăng nhập lại và qua bước khóa.
- Migration v4 đăng xuất mọi phiên admin cũ (chúng chưa qua bước khóa).
- Header `X-Admin-Key` (chỉ cần khóa) **tắt mặc định**; bật bằng `ADMIN_KEY_HEADER=1` khi cần cho script/CI.

Tài khoản admin được **tạo sẵn lúc khởi động** nếu chưa có: tên `ADMIN_USERNAME` (mặc định `admin`), mật khẩu `ADMIN_PASSWORD` (để trống → sinh ngẫu nhiên và in ra console một lần). Tên này bị chặn khi đăng ký. Nếu tên đã thuộc một tài khoản thường, server **không** nâng quyền nó mà cảnh báo trên console. Quên mật khẩu admin: đặt `ADMIN_PASSWORD=...` + `ADMIN_PASSWORD_RESET=1`, khởi động lại một lần rồi bỏ biến đó.

Tên trùng bot hệ thống (Grandmaster AI, Tactical AI…) bị chặn khi đăng ký; khách (chưa đăng nhập) dùng tên đó sẽ bị đổi thành `… (khách)`.

## 2. Thành tích và Elo

- **Elo (bảng xếp hạng)** chỉ đổi ở trận **Online giữa hai tài khoản khác nhau** (K=32, khởi điểm 1200, tối thiểu 100). Đấu với khách, hoặc cùng một tài khoản ngồi hai ghế → vẫn lưu lịch sử nhưng **không** tính điểm. Cách này chặn việc cày Elo bằng tên giả — lỗ hổng của bản cũ, nơi bảng xếp hạng khóa theo *tên do trình duyệt tự gõ*.
- **Hồ sơ** `#/profile/<tên>`: Elo, hạng, thắng-thua-hòa, thành tích theo loại trận (Online / Giải đấu / Luyện tập, tính từ bảng `matches`), giải đã tham gia (🥇 nếu vô địch), 10 trận gần nhất.
- **Ảnh hưởng đến giải đấu:** đăng ký giải bằng tài khoản (mặc định bắt buộc, tắt bằng `requireLogin:false`), mỗi tài khoản 1 bot/giải, tên thi đấu = tên tài khoản; admin có kiểu xếp seed **"Theo Elo"** (mạnh nhất = seed 1, khách tính 1200); mọi ván giải đấu gắn với tài khoản nên hiện trong hồ sơ và bộ lọc "Chỉ trận của tôi".
- Trận luyện tập trong trình duyệt gắn với tài khoản cho phía do bạn điều khiển (bot code / thủ công).
- Bảng xếp hạng cũ trong `leaderboard.json` chỉ còn dùng cho các AI tham chiếu 🤖 (chỉ đọc). Điểm của người chơi cũ theo tên **không** được chuyển sang (vì không xác minh được chủ sở hữu).

API: `POST /api/auth/register|login|admin-verify|logout|password|lang`, `GET /api/auth/me`, `GET /api/leaderboard`, `GET /api/users/:tên`, `GET /api/matches?mine=1|user=<tên>`.
CSDL: migration v2 trong `db.js` — `users`, `sessions`, cột `entries.user_id`, `matches.blue_user_id/red_user_id`; v4 — `sessions.admin_verified`. `GET /api/users/:tên` có thêm `byGame` (thắng/thua/hòa theo từng trò chơi) cho trang người chơi.

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
- `/api/run-bot-move`: chỉ cho tài khoản đã đăng nhập, hạn mức theo tài khoản (`LOCAL_RUN_PER_MIN`, `LOCAL_RUN_PARALLEL`, `LOCAL_NEW_CODE_PER_MIN`) cộng giới hạn theo IP, giới hạn 100KB, và `ALLOW_LOCAL_RUN=0` để tắt hẳn khi mở ra Internet.
- Cách ly thật (bubblewrap) đã có từ phiên bản sau — xem [`SECURITY.md`](SECURITY.md).
