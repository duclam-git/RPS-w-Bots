# Hướng Dẫn Chi Tiết & Báo Cáo Nâng Cấp: OTTv2 Code Arena

Dự án **OTTv2 Code Arena** (Oẳn Tù Tì Chiến Thuật 9x9) đã được nâng cấp toàn diện và hoàn thiện đầy đủ cả 4 yêu cầu kiến trúc lớn:

---

## 1. Tổng Quan Các Tính Năng Đã Triển Khai

| STT | Tính Năng | Trạng Thái | Mô Tả Kỹ Thuật |
| :--- | :--- | :---: | :--- |
| **1** | **Chế độ Đấu Online (2 Máy Tính)** | ✅ Hoàn tất | Kiến trúc Socket.io + Express Server; Tạo phòng / Vào phòng bằng mã PIN; Đồng bộ trạng thái sẵn sàng và các nước đi thời gian thực. |
| **2** | **Đa Ngôn Ngữ (JS, Python, C++)** | ✅ Hoàn tất | Ace Editor hỗ trợ cú pháp `.js`, `.py`, `.cpp`; Bộ Starter Bot chuẩn; Sandbox Runner tự động biên dịch `g++ -O2 -std=c++17` & thực thi `python 3`; Đấu chéo ngôn ngữ mượt mà. |
| **3** | **Chế Độ Ban Đêm (Dark Mode)** | ✅ Hoàn tất | Hệ thống CSS Variables `[data-theme="dark"]` Neo-Brutalist độ tương phản cao; Nút chuyển đổi nhanh trên Header; Lưu trạng thái vào `localStorage`. |
| **4** | **Bảng Xếp Hạng & Hệ Thống Elo** | ✅ Hoàn tất | Chuẩn FIDE Elo ($K=32$); Modal nhập hồ sơ người chơi; Tab Leaderboard trực quan; Thẻ biến động điểm ($\pm \Delta R$) hiển thị ngay khi kết thúc trận. |

---

## 2. Chi Tiết Kiến Trúc & Các File Đã Xây Dựng / Cập Nhật

### 🚀 Backend & Sandbox Runner
1. **[server.js](file:///d:/oantutidemo/RPS-w-Bots/server.js)**:
   - Khởi tạo Express HTTP server phục vụ toàn bộ web app tại cổng `3000`.
   - Tích hợp Socket.io quản lý vòng đời phòng đấu: `create_room`, `join_room`, `player_ready`, `online_move_made`, `online_match_finished`.
   - Cung cấp API `/api/run-bot-move` cho phép chạy bot Python và C++ cho cả chế độ đấu máy nội bộ và đấu trực tuyến.
   - Cung cấp API `/api/leaderboard` lưu trữ và đồng bộ thứ hạng người chơi.
2. **[runner.js](file:///d:/oantutidemo/RPS-w-Bots/runner.js)**:
   - Module sandbox biên dịch và thực thi code độc lập.
   - C++: Tự động ghi ra file tạm, biên dịch bằng `g++ -O2 -std=c++17`, thực thi file `.exe`.
   - Python: Thực thi qua `python` runtime với cơ chế timeout an toàn 3000ms.
   - Giao thức chuẩn hóa JSON qua `stdin` / `stdout`:
     - Input: `{"state": {...}, "myColor": "blue"}`
     - Output: `{"from": {"r": 2, "c": 3}, "to": {"r": 3, "c": 3}}`
3. **[storage.js](file:///d:/oantutidemo/RPS-w-Bots/storage.js)**:
   - Quản lý đọc/ghi bảng xếp hạng file `leaderboard.json` an toàn trên máy chủ.

### 🧠 Logic Client & Ngôn Ngữ
4. **[bot_templates.js](file:///d:/oantutidemo/RPS-w-Bots/bot_templates.js)**:
   - Chứa code mẫu khởi đầu hoàn chỉnh cho cả 3 ngôn ngữ: **JavaScript**, **Python 3**, và **C++17**.
   - Code C++ tích hợp sẵn parser JSON nhẹ không cần cài bất kỳ thư viện ngoài nào (`nlohmann` hay `boost`).
5. **[elo.js](file:///d:/oantutidemo/RPS-w-Bots/elo.js)**:
   - Tính toán biến động điểm FIDE Elo:
     $$E_A = \frac{1}{1 + 10^{(R_B - R_A)/400}}$$
     $$\Delta R = 32 \times (S_A - E_A)$$
   - Khởi tạo Elo mặc định cho người chơi mới: `1200`.
   - Cập nhật số trận thắng, thua, hòa và tỉ lệ thắng.
6. **[logic.js](file:///d:/oantutidemo/RPS-w-Bots/logic.js)**:
   - Nâng cấp `stepBattle` và `executeBot` thành hàm bất đồng bộ (`async/await`) để gọi API chạy bot C++/Python mượt mà mà không làm đơ giao diện bàn cờ.
   - Quản lý logic Online Matchmaking qua Socket.io: tự động chuyển phe, khóa code của đối thủ khi đấu online, và phát hiện nước đi.
   - Xử lý toggle Dark Mode và tích hợp hiển thị điểm Elo sau trận đấu.

### 🎨 Giao Diện (UI/UX)
7. **[index.html](file:///d:/oantutidemo/RPS-w-Bots/index.html)**:
   - Tích hợp CDN Ace Editor modes cho Python và C++.
   - Nạp thư viện `socket.io.js`.
   - Thêm nút `🌐 Đấu Online`, `🌙 Giao diện Tối`, và Huy hiệu Profile trên Header.
   - Thêm Dropdown chọn ngôn ngữ (.js, .py, .cpp) phía trên mỗi khung soạn thảo code.
   - Thêm Tab `🏆 Bảng Xếp Hạng` và các Modal: **Online Lobby**, **Profile**, **Elo Card**.
8. **[style.css](file:///d:/oantutidemo/RPS-w-Bots/style.css)**:
   - Bộ token màu Dark Mode hiện đại: nền `#0f172a`, panel `#1e293b`, chữ `#f8fafc`, viền `#334155`.
   - Styles cho các huy hiệu ngôn ngữ (JS vàng, Python xanh-vàng, C++ xanh dương).
   - Thiết kế giao diện phòng đấu Online và bảng xếp hạng huy chương vàng, bạc, đồng.

---

## 3. Hướng Dẫn Chạy & Kiểm Thử

### Cách 1: Chạy Server
Server hiện đang được khởi động và chạy tại cổng **3000**:
```bash
# Mở terminal tại thư mục d:\oantutidemo\RPS-w-Bots
node server.js
```
Truy cập vào trình duyệt: [http://localhost:3000](http://localhost:3000)

### Cách 2: Thử Nghiệm Đấu 2 Máy (Online Multiplayer)
1. **Trên Máy 1 (Host - Ví dụ phe Xanh)**:
   - Mở trình duyệt vào `http://localhost:3000` (hoặc `http://<IP_LAN_MAY_1>:3000`).
   - Nhập tên của bạn khi hệ thống hỏi (ví dụ: `MasterDev`).
   - Bấm nút **🌐 Đấu Online** trên góc phải màn hình.
   - Bấm **➕ Tạo Phòng Mới** $\rightarrow$ Hệ thống sẽ cấp một mã phòng (ví dụ: `A8B3C1`).
   - Chọn ngôn ngữ bạn thích (ví dụ: `Python` hoặc `C++`), viết code bot và bấm **✅ Tôi Đã Sẵn Sàng**.

2. **Trên Máy 2 (Guest - Ví dụ phe Đỏ)**:
   - Mở trình duyệt vào `http://<IP_LAN_MAY_1>:3000` (hoặc mở thêm một tab trình duyệt khác ở chế độ ẩn danh).
   - Nhập tên của người chơi 2 (ví dụ: `CodeNinja`).
   - Bấm nút **🌐 Đấu Online** $\rightarrow$ Điền mã phòng `A8B3C1` $\rightarrow$ Bấm **Tham Gia Phòng**.
   - Chọn ngôn ngữ bạn thích (ví dụ: `C++` đấu với `Python` của máy 1), viết code và bấm **✅ Tôi Đã Sẵn Sàng**.

3. **Trận Đấu Bắt Đầu**:
   - Trận đấu sẽ tự động diễn ra trên cả 2 màn hình theo thời gian thực.
   - Khi kết thúc, điểm Elo của cả 2 người chơi sẽ được tự động cập nhật và hiển thị trên màn hình cùng Bảng Xếp Hạng!
