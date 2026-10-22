# RPS w/ Bots — v6 (nâng cấp từ v5-final)

Thứ tự làm theo mức độ rủi ro của hệ thống mạng: **xác thực / phân quyền trước**, rồi **luồng trang**, rồi **tính đúng của trò chơi, online và bot**, cuối cùng là **giao diện**. Mục 3 (thống kê tổng quan admin) là phần của bạn cùng nhóm, đã ghép vào ở bản v6.2 (xem bên dưới).

Kiểm thử: `npm test` → **80 qua, 0 lỗi, 2 bỏ qua** (cần nginx / bubblewrap). Bản v5 có 76 test; v6 thêm 6 test mới và mở rộng các test cũ. Ngoài ra đã chạy thử bằng trình duyệt thật (Chromium): đăng ký, đăng nhập admin 2 bước, trang người chơi, Oẳn tù tì, Caro (chơi tay, bot, Python, bot đấu bot, online 2 người), nhánh đấu (giao diện sáng + tối).

---

## 1. Gộp đăng nhập và admin, thêm khóa admin (mục 1)

- **Một trang đăng nhập cho tất cả** (`login.html`). Tài khoản admin được **tạo sẵn lúc khởi động**: tên `ADMIN_USERNAME` (mặc định `admin`), mật khẩu `ADMIN_PASSWORD` (để trống thì máy chủ tự sinh và in ra console một lần).
- **Đăng nhập admin có 2 bước**: đúng mật khẩu thì server **chưa mở phiên**, chỉ cấp một mã thử thách (cookie `HttpOnly`, `SameSite=Strict`, sống 2 phút, dùng 1 lần). Trang hỏi tiếp **khóa admin** (`ADMIN_KEY`). Đúng khóa thì mở phiên admin và chuyển thẳng vào trang quản trị. Sai 3 lần thì phải nhập lại mật khẩu, và mỗi lần sai đều tính vào cơ chế khóa chống dò mật khẩu.
- **Quyền admin = tài khoản admin VÀ phiên đã qua bước khóa.** Phiên admin hết hạn sau 8 giờ (`ADMIN_SESSION_TTL_HOURS`), phiên người chơi vẫn 30 ngày.
- **Bỏ các lỗ hổng của cách cũ:**
  - `claim-admin`: ai biết khóa là thành admin vĩnh viễn. Nay trả về 410.
  - Header `X-Admin-Key`: chỉ cần khóa, không cần mật khẩu. Nay tắt mặc định, bật bằng `ADMIN_KEY_HEADER=1` nếu script cần.
  - Khóa admin bị lưu trong `sessionStorage`, nên XSS đọc được. Đã bỏ.
- Nâng hoặc hạ quyền một người sẽ **thu hồi mọi phiên của người đó**. Admin mới phải đăng nhập lại qua bước khóa.
- **Phiên chết thì socket cũng đóng.** Khi đăng xuất, đổi hoặc đặt lại mật khẩu, hay đổi quyền, server gửi `session_revoked` rồi ngắt các kết nối Socket.io của đúng phiên đó. Trước đây socket vẫn chạy dưới tên tài khoản cho tới khi tải lại trang.
- **Online cần đăng nhập** (`ALLOW_GUEST_ROOMS=1` để cho khách chơi như bản cũ).
- Migration CSDL **v4**: cột `sessions.admin_verified`, và đăng xuất các phiên admin cũ một lần.
- Quên mật khẩu admin: đặt `ADMIN_PASSWORD=...` cùng `ADMIN_PASSWORD_RESET=1`, khởi động lại một lần.

## 2. Luồng trang: Đăng nhập → Trang người chơi → Chọn trò → Trò chơi (mục 5)

- `/` tự điều hướng: chưa đăng nhập thì sang `login.html`; người chơi sang `home.html`; admin sang `arena.html#/admin`.
- **`home.html` (trang người chơi):** Elo, hạng, tổng số trận, thắng–thua–hòa, tỉ lệ thắng; thành tích **theo từng trò chơi** và theo loại trận; giải đã tham gia; 12 trận gần nhất kèm kết quả của bạn và nút xem lại; **thẻ chọn trò chơi** (Oẳn tù tì / Cờ Caro).
- Các trang khu người chơi (`home`, `index`, `caro`) bắt buộc phải có phiên. Sau khi đăng nhập, trang quay về đúng trang bạn định vào (`?next=`, chỉ chấp nhận đường dẫn cùng trang web, chống open-redirect).
- `index.html` (giao diện hiện tại của nhóm) giữ nguyên, chỉ thêm nút “🏠 Chọn trò chơi” và “📘 Luật chơi”. `arena.html` bỏ hộp đăng nhập và nút 🔑, dùng trang đăng nhập chung.
- API `GET /api/users/:tên` có thêm `byGame`.

## 3. Kiểm tra trò chơi còn lại (Cờ Caro) — kết quả và phần đã bổ sung (mục 4)

| Câu hỏi | v5 (trước khi sửa) | v6 |
|---|---|---|
| Bố cục bàn Caro đã có ở phần người chơi chưa? | **Chưa.** `index.html` chỉ có Oẳn tù tì 9×9. Caro chỉ chạy trong giải đấu do admin tạo, xem được qua replay. | Có trang riêng **`caro.html`**, chọn từ trang người chơi. Bàn 3×3, 9×9, 13×13, 15×15, 19×19. |
| Luật chơi thế nào? | Engine ổn và có test: đặt quân luân phiên, Xanh đi trước, 5 quân liên tiếp (6 vẫn tính) thì thắng, kín bàn thì hòa. | Giữ nguyên. Luật hiện ngay trong trang (tab “Luật & API”) và trong `guide.html`. |
| Thi đấu online được chưa? | **Chưa.** Phòng online bị cố định luật Oẳn tù tì. | Phòng có thuộc tính trò chơi; Caro online chọn được cỡ bàn. Trang Caro vào nhầm phòng Oẳn tù tì (hoặc ngược lại) bị từ chối kèm lý do. Trận được lưu lịch sử nhưng không tính Elo (Elo là bảng xếp hạng Oẳn tù tì). |
| Bot đấu với nhau thế nào? | Chỉ trong giải đấu. | Chọn bot cho cả 2 bên để xem từng nước, hoặc dùng “📊 Bot đấu bot” chạy 10–100 ván, đổi màu mỗi ván, báo tỉ lệ thắng. |
| Tạo được các bot chiến thuật khác nhau không? | **Không**, chỉ có 1 mẫu heuristic. | **6 chiến thuật:** Ngẫu nhiên, Giữ trung tâm, Tấn công, Phòng thủ, Cân bằng, Minimax α-β. Độ mạnh được kiểm bằng test. |
| Có code mẫu cho từng chiến thuật không? | 1 mẫu cho mỗi ngôn ngữ. | JS: cả 6; Python: 4; C++: 2. Có nút “⤵ Nạp mẫu” trong tab Code. |
| Có hướng dẫn cho người mới không? | Chỉ có tài liệu cho lập trình viên (`docs/GAMES.md`). | Trang **`guide.html`**: bắt đầu nhanh, luật 2 trò, cách viết bot (JS / Python / C++), bảng `state`/`helpers`, chiến thuật mẫu, online và giải đấu, hỏi đáp. |

**Lỗi phát hiện thêm khi kiểm tra (đã sửa):** ở bản v5, **mọi bot JavaScript khi luyện tập trong trình duyệt** (kể cả Random/Rusher/Hunter/Tactical có sẵn) đều bị chính chính sách CSP chặn `eval`, nên âm thầm đi ngẫu nhiên; Benchmark 50x cũng vậy. Nay bot chạy trong **Web Worker** (`bot_worker.js`) có CSP riêng: được chạy code nhưng **không có mạng**, nên code bot không gọi được API bằng cookie của người chơi. Bot lặp vô hạn bị hủy sau 3 giây thay vì làm treo trang. Helpers lấy từ cùng engine mà server dùng.

## 4. Nhánh đấu có tia nối và màu dễ nhìn (mục 2)

- Đường nối SVG giữa các cặp, vẽ theo vị trí thật và tự vẽ lại khi đổi cỡ màn hình.
  - **Xanh lá đậm**: xuất phát từ đúng dòng người thắng, đi tới vòng sau.
  - **Xanh dương nét đứt chạy**: cặp đang đấu.
  - **Nét đứt xám**: cặp chưa đấu.
- Người thắng có nền xanh và dấu ▶; người bị loại mờ đi và bị gạch ngang.
- Thêm cột **“Vô địch”** với viền vàng, và chú giải màu. Chạy được ở giao diện tối.

## Bản vá sau đánh giá mạng (v6.1)

- **Rời phòng giữa trận không còn hủy trận.** Trận online là bot đấu bot trên server nên không cần người chơi còn kết nối. Trước đây người sắp thua chỉ cần thoát là trận bị hủy, không bị trừ Elo; mạng chập chờn cũng làm mất trận. Nay trận đánh tiếp đến hết, kết quả và Elo vẫn được ghi; người còn lại nhận thông báo `player_left_match`. Phòng trống được xóa khi trận xong.
- **Khán giả không hủy được trận.** `request_rematch` chỉ nhận từ người đang ngồi ghế và chỉ khi không có trận đang chạy.
- **`/api/run-bot-move` bắt buộc đăng nhập** (401 nếu không) và có hạn mức theo tài khoản: 600 nước/phút, 2 nước chạy cùng lúc, 20 phiên bản code mới (lần biên dịch) mỗi phút. Chỉnh bằng `LOCAL_RUN_PER_MIN`, `LOCAL_RUN_PARALLEL`, `LOCAL_NEW_CODE_PER_MIN`.
- Thêm 2 test e2e. `npm test`: **82 qua, 0 lỗi, 2 bỏ qua**.

## Ghép phần thống kê tổng quan của bạn cùng nhóm (v6.2, mục 3)

Lấy từ nhánh `anh` (commit `c407a94` "admin overview dashboard…") **chỉ phần thống kê tổng quan**:

- `GET /api/admin/overview` (chỉ admin): số người chơi, giải đang mở / tổng số giải, bài nộp của người dùng, trận đang chạy (phòng online + giải đấu). Kèm `tournament.liveGameCount()`.
- Tab **📊 Tổng quan** trong trang Quản trị, mở mặc định, 4 thẻ thống kê và CSS đi kèm. Giữ nguyên code và giao diện của bạn ấy, chỉ thêm màu cho giao diện tối ở thẻ "Giải đấu đang mở".
- Thêm 1 test cho API này, cập nhật `docs/ADMIN.md`. `npm test`: **83 qua, 0 lỗi, 2 bỏ qua**.

**Không lấy** phần đăng nhập trong cùng nhánh (`auth-gate.js`, hộp đăng nhập có ô ADMIN_KEY, tài khoản mặc định `admin` / `adminadmin`), vì v6 đã có trang đăng nhập riêng và đăng nhập admin 2 bước. Hai bên giải cùng một yêu cầu, giữ cả hai sẽ xung đột. Ngoài ra mật khẩu mặc định cố định là rủi ro, v6 dùng `ADMIN_PASSWORD` hoặc tự sinh.

## Khác

- `npm test` chạy tuần tự (`--test-concurrency=1`). Khi chạy song song, bot Python/C++ đôi khi vượt 2,5 giây mỗi nước vì máy quá tải, làm test đỏ ngẫu nhiên (bản v5 cũng bị: 2/76).
- Sửa ô thông báo (toast) rỗng luôn lộ một vệt đen ở đáy màn hình.
- Tài liệu cập nhật: `README.md`, `.env.example`, `docs/ACCOUNTS.md` (mục 1b), `docs/ADMIN.md`, `docs/GAMES.md`, `docs/SECURITY.md`, `docs/TOURNAMENT.md`, `docs/DEPLOY.md`.

## Lưu ý khi merge

- Phần thống kê tổng quan đã được ghép (v6.2). Nếu nhóm merge thêm code khác từ nhánh cũ: thêm migration thì xếp sau `v4` trong `MIGRATIONS` (`db.js`); script gọi API admin bằng header `X-Admin-Key` cần `ADMIN_KEY_HEADER=1`.
- Repo GitHub đang commit file `.env` với `ADMIN_KEY=ADMIN`. Nên xóa `.env` khỏi repo, thêm `.env` vào `.gitignore`, và đổi sang khóa dài, ngẫu nhiên (khóa đã lộ coi như không còn bí mật).

## Tệp mới

`login.html` `login.js` · `home.html` `home.js` · `guide.html` · `portal.css` · `caro.html` `caro_page.js` `caro_strategies.js` · `bot_worker.js` `bot_client.js` · `CHANGELOG-v6.md`
