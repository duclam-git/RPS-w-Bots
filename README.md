# ⚔️ OTTv2 Code Arena — Rock-Paper-Scissors Bot Coding Battle

Đấu trường Lập trình Bot Cờ Oẳn Tù Tì 9x9 (OTTv2 Bot Battle).  
Nơi bạn có thể tự tay lập trình các thuật toán AI / Bot bằng JavaScript, cho bot so tài đối kháng trực tiếp, hoặc chạy mô phỏng benchmark hàng chục ván đấu để đo lường tỉ lệ thắng!

---

## 🎯 Giới thiệu trò chơi

Trò chơi diễn ra trên bàn cờ kích thước **9×9**, mỗi bên (Đội Xanh và Đội Đỏ) sở hữu 10 quân cờ:
- **3 quân Đấm (Rock ✊)**
- **4 quân Lá (Paper ✋)**
- **3 quân Kéo (Scissors ✌️)**

### 🏆 Mục Tiêu Chiến Thắng Duy Nhất
Mục tiêu duy nhất để giành chiến thắng là **đưa bất kỳ quân nào tới ô đích ở phía đối diện bàn cờ**:
- **Đội Xanh (Blue):** Đưa quân tới ô **I9** (hàng 9, cột I - góc trên phải).
- **Đội Đỏ (Red):** Đưa quân tới ô **A1** (hàng 1, cột A - góc dưới trái).

> *Lưu ý:* Việc ăn quân đối phương theo luật Oẳn Tù Tì nhằm mục đích dọn đường và cản trở đối thủ tiến công, không còn luật xử thua khi hết 1 loại quân. Chỉ có chạm đích ở phía bên kia mới quyết định chiến thắng!

### ⚔️ Luật di chuyển & ăn quân
- Mỗi quân di chuyển **1 bước theo 8 hướng** (như quân Vua trong cờ vua).
- Quy tắc ăn quân Oẳn Tù Tì:
  - ✊ **Đấm** ăn ✌️ **Kéo**
  - ✌️ **Kéo** ăn ✋ **Lá**
  - ✋ **Lá** ăn ✊ **Đấm**
- **Cùng loại chặn nhau:** Hai quân cùng loại (Đấm vs Đấm, Lá vs Lá, Kéo vs Kéo) không thể ăn nhau và không thể đi đè lên nhau. Quân cùng phe cũng không thể đi vào ô nhau.

---

## 💻 Hướng dẫn Lập Trình Bot (Bot API)

Bot của bạn được định nghĩa thông qua hàm JavaScript:

```javascript
function getNextMove(state, helpers, log) {
    // Thuật toán của bạn ở đây...
    return move; // Trả về nước đi từ state.legalMoves hoặc { from: {r, c}, to: {r, c} }
}
```

### 1. Dữ liệu trạng thái trận đấu (`state`)
| Thuộc tính | Kiểu dữ liệu | Ý nghĩa |
| :--- | :--- | :--- |
| `state.myPlayer` | `number` | Số đại diện phe của bạn (`1` cho Đội Xanh, `2` cho Đội Đỏ). |
| `state.opponentPlayer` | `number` | Số đại diện đối thủ (`2` hoặc `1`). |
| `state.myGoal` | `{ r, c }` | Tọa độ ô đích cần đến (`I9` cho Xanh, `A1` cho Đỏ). |
| `state.opponentGoal` | `{ r, c }` | Tọa độ ô đích của đối thủ. |
| `state.board` | `Array[9][9]` | Bàn cờ 9×9. Ô chứa `{ player, type }` hoặc `null`. |
| `state.legalMoves` | `Array<Move>` | Danh sách các nước đi hợp lệ của bạn lúc này. |
| `state.myCounts` | `Object` | Số lượng quân còn lại của bạn (`{ rock, paper, scissors, total }`). |
| `state.opponentCounts` | `Object` | Số lượng quân còn lại của đối thủ. |
| `state.moveHistory` | `Array` | Lịch sử tất cả các nước đi đã chơi từ đầu trận. |
| `state.turnNumber` | `number` | Số thứ tự vòng đấu hiện tại. |

Mỗi phần tử trong `legalMoves` có cấu trúc:
```javascript
{
  from: { r: 5, c: 1 },    // Tọa độ ô xuất phát
  to: { r: 4, c: 1 },      // Tọa độ ô đích đến
  pieceType: 'rock',       // Loại quân di chuyển
  capture: 'scissors',     // Loại quân địch bị ăn (hoặc null nếu đi vào ô trống)
  notation: 'B4 → B5'     // Tọa độ chuẩn cờ vua
}
```

### 2. Các hàm bổ trợ (`helpers`)
- `helpers.distance(r1, c1, r2, c2)`: Khoảng cách bước Vua (Chebyshev distance).
- `helpers.canCapture(attackerType, defenderType)`: Kiểm tra `attacker` có ăn được `defender` không.
- `helpers.simulateMove(board, move)`: Giả lập nước đi và trả về bàn cờ mới (cho thuật toán Minimax / Lookahead).
- `helpers.getLegalMoves(player, board)`: Lấy toàn bộ nước đi hợp lệ của `player` trên `board`.
- `helpers.toNotation(r, c)`: Đổi tọa độ sang tên ô (ví dụ `r=4, c=1` thành `"B5"`).
- `helpers.fromNotation("B5")`: Đổi tên ô thành tọa độ `{ r, c }`.
- `helpers.randomChoice(array)`: Chọn ngẫu nhiên 1 phần tử trong mảng.
- `helpers.getPieceCounts(player, board)`: Đếm số lượng quân của người chơi.
- `helpers.getPieces(player, board)`: Lấy danh sách vị trí và loại quân của người chơi.

### 3. Debug nhật ký (`log`)
Sử dụng `log(...)` để ghi lại suy nghĩ và lý do chọn nước đi của bot. Nhật ký sẽ hiển thị trực tiếp theo thời gian thực tại tab **Bot Console**:
```javascript
log("Đang săn quân Kéo của đối thủ:", bestMove.notation);
```

---

## 🤖 Các Mẫu Bot Tích Hợp Sẵn

1. **🎲 Random Bot:** Chọn ngẫu nhiên nước đi hợp lệ.
2. **🚀 Goal Rusher Bot:** Ưu tiên tìm đường ngắn nhất lao thẳng về ô đích đối phương (`I9` hoặc `A1`).
3. **⚔️ Aggressive Hunter Bot:** Tấn công tiêu diệt quân đối phương, ưu tiên săn chủng loại quân sắp bị diệt chủng.
4. **🧠 Tactical AI (Minimax):** Đánh giá bàn cờ đa chiều (an toàn quân, phòng thủ ô đích, cản phá diệt chủng, tiến công thông minh).

---

## ⚡ Tính năng nổi bật

- 🌐 **Đấu Online Giữa 2 Máy (Multiplayer 1v1):** Hỗ trợ 2 người chơi ở 2 máy tính khác nhau kết nối qua mã phòng (Room Code), cùng nạp code và so tài trực tiếp theo thời gian thực qua WebSocket.
- 💻 **Đa Ngôn Ngữ & Đấu Chéo Ngôn Ngữ (Cross-Language Arena):**
  - Hỗ trợ **JavaScript (.js)**, **Python (.py)** và **C++17 (.cpp)** trên trình soạn thảo Ace Editor.
  - Hỗ trợ các cuộc đấu không cùng ngôn ngữ (ví dụ: một bên dùng file Python đấu với một bên dùng C++).
  - Trọng tài Server biên dịch và thực thi code an toàn với timeout quy chuẩn.
- 🌙 **Chế độ Ban Đêm (Dark Mode):** Giao diện Dark Theme hiện đại, dịu mắt, độ tương phản cao, tự động chuyển đổi theme Ace Editor và lưu trạng thái vào trình duyệt.
- 🏆 **Bảng Xếp Hạng & Hệ Thống Điểm Elo (FIDE Rating):**
  - Bắt buộc nhập tên người chơi trước khi đấu.
  - Công thức tính điểm Elo chuẩn cờ vua (khởi đầu 1200 điểm, K-factor = 32).
  - Bảng xếp hạng vinh danh Top người chơi kèm huy chương 🥇🥈🥉, thống kê số trận, tỷ lệ thắng.
- 💾 **Tự động lưu & Xuất/Nạp file:** Tự động lưu theo từng ngôn ngữ, hỗ trợ xuất và nạp file `.js`, `.py`, `.cpp`.
- ⏯️ **Điều khiển trận đấu linh hoạt:** Chạy tự động, Tạm dừng, Đi từng bước, Điều chỉnh tốc độ từ 800ms đến 5ms.
- 📊 **Benchmark Simulator (50x):** Chạy giải đấu 50 hoặc 100 trận siêu tốc để đo tỉ lệ thắng bot.
- 🔊 **Hiệu ứng âm thanh:** Web Audio sống động khi đi cờ, ăn quân và chiến thắng.

---

## 🚀 Hướng Dẫn Chạy Dự Án

### Chạy Server để đấu Online và hỗ trợ Python / C++:
```bash
# Di chuyển vào thư mục dự án
cd RPS-w-Bots

# Cài đặt thư viện (nếu chưa cài)
npm install

# Khởi động server
npm start
```
Truy cập trình duyệt: **`http://localhost:3000`** (hoặc `http://<dia_chi_ip_lan>:3000` từ máy tính khác trong cùng mạng LAN / Wi-Fi để cùng đấu Online).

