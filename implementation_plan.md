# Kế hoạch Triển khai: Đấu trường Code OTTv2 (Multiplayer Online, Đa ngôn ngữ C++/Python/JS, Dark Mode, Bảng xếp hạng Elo)

Dự án hiện tại là một SPA client-side thuần JavaScript. Kế hoạch này sẽ nâng cấp toàn diện dự án thành một nền tảng thi đấu lập trình hoàn chỉnh với Server Node.js, hỗ trợ thi đấu Online giữa 2 máy, đa ngôn ngữ, giao diện ban đêm và bảng xếp hạng Elo.

---

## 1. Mục tiêu và Kiến trúc

```
[Browser Client A] (Máy 1)               [Browser Client B] (Máy 2)
   ├── Ace Editor (JS/Py/C++)               ├── Ace Editor (JS/Py/C++)
   ├── Dark/Light Mode                      ├── Dark/Light Mode
   ├── Elo & Bảng xếp hạng                  ├── Elo & Bảng xếp hạng
   └── Socket.io Client                     └── Socket.io Client
           ▲                                        ▲
           │             WebSocket Realtime         │
           └─────────────────┬──────────────────────┘
                             ▼
              [ Backend Server: Node.js + Express ]
                 ├── HTTP Static Hosting (index.html, assets)
                 ├── Socket.io Matchmaker (Tạo phòng, vào phòng)
                 ├── Code Runner Engine:
                 │     ├── C++ (g++ compiler -> sandbox run)
                 │     ├── Python (python subprocess -> sandbox run)
                 │     └── JavaScript (Node VM sandbox)
                 └── Elo Calculator & Leaderboard Storage (JSON/DB)
```

---

## 2. Các giai đoạn triển khai chi tiết

### Giai đoạn 1: Dark Mode & Hệ thống Bảng Xếp Hạng Elo (Client & UI)
- [x] Tạo CSS tokens cho `[data-theme="dark"]` với bảng màu Cyber/Neo-Brutalist sang trọng.
- [x] Thêm nút gạt Dark/Light Mode trên Header và đồng bộ theme Ace Editor.
- [x] Thêm Modal Profile nhập Tên người chơi trước trận đấu.
- [x] Xây dựng module tính điểm Elo (`elo.js`) chuẩn cờ vua FIDE ($K=32$, $E_A = 1/(1+10^{(R_B-R_A)/400})$).
- [x] Thêm Tab / Modal Bảng Xếp Hạng (Leaderboard) hiển thị Top người chơi, Elo, Winrate, Huy chương 🥇🥈🥉.
- [x] Tích hợp cộng/trừ điểm Elo vào màn hình kết thúc trận (`win-overlay`).

### Giai đoạn 2: Hỗ trợ Đa Ngôn Ngữ (JS, Python, C++) trên Ace Editor
- [x] Bổ sung thư viện Ace Editor cho Python (`mode-python.min.js`) và C++ (`mode-c_cpp.min.js`).
- [x] Thêm thanh chọn ngôn ngữ (`JavaScript`, `Python`, `C++`) cho từng Editor (Blue & Red).
- [x] Soạn thảo Template Bot mẫu chuẩn cho Python (`starter.py`) và C++ (`starter.cpp`) kèm các hàm helper và I/O JSON.
- [x] Cập nhật tính năng Xuất/Nạp file để tương thích đuôi `.js`, `.py`, `.cpp`.

### Giai đoạn 3: Backend Server Node.js & Trình thực thi Code Sandbox (Runner)
- [x] Khởi tạo `package.json` với `express`, `socket.io`, `cors`.
- [x] Xây dựng `server.js`:
  - Phục vụ Static file cho toàn bộ frontend.
  - Quản lý Room WebSocket (Tạo mã phòng, tham gia, ready, kết nối 2 người chơi).
- [x] Xây dựng `runner.js`:
  - Thực thi code bot an toàn theo giao thức JSON stdin/stdout.
  - Hỗ trợ biên dịch C++ (`g++`), chạy Python (`python`), chạy JS (`node`).
  - Xử lý timeout mỗi lượt (2000ms), fallback nếu bot crash hoặc lỗi syntax.
- [x] Xây dựng `storage.js`: Lưu trữ bảng xếp hạng Elo và lịch sử trận đấu vào file JSON.

### Giai đoạn 4: Tích hợp Giao diện Đấu Online giữa 2 Máy
- [x] Thêm nút chế độ `🌐 Đấu Online (2 Máy)` trên Header.
- [x] Modal Phòng Đấu Online:
  - Tạo phòng (sinh mã PIN ví dụ `OTT-7291`).
  - Vào phòng bằng mã PIN.
  - Lobby chờ: hiển thị đối thủ, trạng thái Ready, chọn ngôn ngữ code.
  - Trận đấu bắt đầu: đồng bộ bàn cờ trực tiếp giữa 2 máy qua WebSocket.
- [x] Kiểm thử toàn diện trên cả 2 máy (hoặc 2 tab trình duyệt độc lập):
  - Kiểm thử Python vs C++.
  - Kiểm thử JS vs Python.
  - Kiểm thử cập nhật điểm Elo sau trận.

---

## 3. Kế hoạch xác minh (Testing & Verification)
1. **Kiểm thử Dark Mode:** Bấm nút gạt, kiểm tra độ tương phản bàn cờ, màu chữ, editor theme chuyển đổi mượt mà và lưu lại khi refresh trang.
2. **Kiểm thử Elo:** Chơi 1 ván, kiểm tra điểm cộng/trừ Elo chính xác theo công thức, xem bảng xếp hạng cập nhật ngay lập tức.
3. **Kiểm thử Runner Đa ngôn ngữ:** Chạy thử code Python và C++ qua runner xem có biên dịch và trả về nước đi hợp lệ không.
4. **Kiểm thử Online Multiplayer:** Mở 2 tab trình duyệt khác nhau, tạo phòng và vào phòng, cho 1 tab dùng Python, 1 tab dùng C++, kiểm tra bàn cờ đồng bộ từng nước đi.
