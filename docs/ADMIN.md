# Trang quản trị (vấn đề #4)

Vào bằng tài khoản admin ở trang đăng nhập chung `login.html`: mật khẩu, rồi **mã 1 lần in ra console** (hoặc khóa cố định `ADMIN_KEY` ở chế độ `static`) — xem `ACCOUNTS.md` mục 1b. Đăng nhập xong được chuyển thẳng tới `arena.html#/admin`. Menu **🛠 Quản trị** chỉ hiện với phiên admin; người khác mở `#/admin` chỉ thấy thông báo khóa.

## 1. Những gì chỉnh được

| Yêu cầu | Ở đâu | Ghi chú |
|---|---|---|
| **Tổng quan** | Tab "📊 Tổng quan" (mở mặc định) | 4 thẻ: số người chơi, giải đấu đang mở / tổng số giải, bài nộp của người dùng (bot đã đăng ký giải bằng tài khoản), trận đang chạy trực tiếp (phòng online + giải đấu). |
| **Trò chơi** | Trình soạn giải, mục "Trò chơi" | RPS hoặc Caro (xem `GAMES.md`); chỉ đổi được khi chưa có bot đăng ký và chưa bắt đầu. |
| **Luật chơi** | Trình soạn giải (`#/admin/edit/…`) | Giới hạn số nước (hòa), ô đích, **cỡ bàn**, **bảng ai ăn được ai** (RPS); cỡ bàn + số quân thắng (Caro). |
| **Setup quân cờ** | Trình soạn thế cờ trên bàn 9×9 | Bấm ô để đặt quân (chọn bên + Đá/Giấy/Kéo), chuột phải hoặc 🧹 để xóa, 🎯 để đặt ô đích, "⇄ Phản chiếu" (Đỏ = Xanh xoay 180°) cho thế cờ công bằng, "↺ Mặc định". |
| **Thời gian mỗi nước đi** | `moveTimeoutMs` (100–10 000 ms) | Như cũ, nay chỉnh được qua giao diện. |
| **Thời gian thi đấu** | `timeBankMs` — *tổng* thời gian suy nghĩ mỗi bên | Chạy như đồng hồ cờ vua: mỗi nước bot dùng bao nhiêu trừ vào quỹ bên đó, hết quỹ là **thua**; nước cuối bị giới hạn bởi phần quỹ còn lại. `0` = không giới hạn. Tính cả thời gian khởi động tiến trình bot (JS ~50–100 ms/nước) nên nên đặt rộng tay. |
| **Chỉnh sửa giải** | Sửa giải | Khi còn mở đăng ký: đổi mọi thứ (tên, thể thức, luật…). Sau khi bắt đầu: chỉ đổi tên, độ trễ trình diễn, số ván chạy song song — luật bị khóa vì các ván đã đấu theo luật cũ (server từ chối 409). |
| **Chỉnh sửa trận đấu** | Thẻ cặp đấu trên trang giải (khi giải đang **tạm dừng**) | **⚑ X thắng / ⚑ Hòa**: admin tự quyết (loại do vắng mặt, vi phạm…); **↺ Đấu lại**: xóa các ván của cặp đó và đấu lại. Đấu lại bị chặn nếu vòng sau đã dùng kết quả (hãy đấu lại từ vòng cuối trở về) hoặc vòng bảng đã sinh ra nhánh knockout. Giải đã kết thúc sẽ tự mở lại và xóa nhà vô địch. |
| **Lịch sử** | Trang xem lại trận | Admin xóa được bản ghi Online/Luyện tập. Ván giải đấu được bảo vệ (dùng "Đấu lại"). |
| **Bảo mật** | Tab "🛡 Bảo mật" | Mức cách ly code bot theo từng ngôn ngữ (mạnh / cơ bản / yếu), driver đang dùng, lý do nếu bubblewrap không chạy được, giới hạn tài nguyên. Xem `SECURITY.md`. |
| **Người dùng** | Tab "Người dùng" | Đổi quyền user/admin (không thể bỏ quyền admin cuối cùng; đổi quyền thu hồi mọi phiên của người đó, admin mới phải đăng nhập lại qua bước khóa), đặt lại mật khẩu (thu hồi mọi phiên đăng nhập của người đó). |

Cỡ bàn và bảng khắc chế RPS nay chỉnh được (xem `GAMES.md`); bot nhận luật qua `state.rules` nên helper của bot đi theo luật của giải.

## 2. Kiểm tra luật (một chỗ duy nhất)

`validateRules()` của từng trò chơi (RPS: `engine.js`; Caro: `games/caro.js`) kiểm tra, ví dụ với RPS: cỡ bàn 5–15, bảng khắc chế hợp lệ, giới hạn số nước 20–2000, thời gian/nước 100–10 000, tổng thời gian 0 hoặc ≥ 1000; ô đích trong bàn và khác nhau; mỗi bên 1–30 quân, đúng loại quân, không ra ngoài bàn, không chồng nhau, **không đặt lên ô đích**; thế xuất phát chưa phân thắng bại và cả hai bên đều có nước đi. Trình soạn gọi `POST /api/rules/validate?game=<id>` (cùng hàm mà server dùng khi lưu) nên báo lỗi trực tiếp và khóa nút Lưu khi luật sai — không có luật kiểm tra thứ hai ở trình duyệt để lệch nhau.

Mỗi ván lưu bản chụp luật (`rules_json`), nên replay đúng bàn cờ xuất phát kể cả khi luật giải sau này đổi.

## 3. API (đều cần admin, trừ hai API luật)

`PATCH /api/tournaments/:id` · `POST /api/tournaments/:id/series/:sid/reset` · `…/series/:sid/result {winner:'a'|'b'|'tie'}` · `DELETE /api/matches/:id` · `GET /api/admin/users` · `POST /api/admin/users/:id/role` · `POST /api/admin/users/:id/password` · công khai: `GET /api/games`, `GET /api/rules/default?game=`, `POST /api/rules/validate?game=`; `GET/POST /api/admin/backups`, `GET /api/admin/sandbox` (admin), `GET /api/admin/overview` (admin: `{users, tournaments:{open,total}, submissions, matches}`).

## 4. Lỗi tìm thấy trong lúc làm

Handler ném `HttpError` **đồng bộ** không được bắt → Express trả trang HTML (kèm stack trace khi không ở production) thay vì JSON, nên giao diện chỉ hiện "Lỗi 409" mà không có lý do. Đã sửa ở mọi route và thêm bộ xử lý lỗi cuối cùng luôn trả JSON (cả JSON hỏng, body quá lớn). Có test.
