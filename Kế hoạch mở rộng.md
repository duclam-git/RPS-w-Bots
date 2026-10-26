# Kế hoạch mở rộng 
Sau bản mới nhất, chạy bot không còn là nút cổ chai CPU nữa, mà là RAM của các tiến trình bot đang được giữ lại. Bậc 2 giải quyết chuyện đó bằng cách đưa bot sang máy riêng. Bậc 3 chỉ cần khi chính server web (một tiến trình Node) quá tải, hoặc khi muốn hệ thống vẫn chạy lúc một máy chết.

## Tóm tắt

|  | Bậc 1: tách máy chạy bot | Bậc 2: nhiều server web |
| --- | --- | --- |
| Giải quyết | CPU và RAM của bot, cách ly code lạ khỏi máy có database | Giới hạn một tiến trình Node, máy chết là sập cả hệ thống |
| Khi nào cần | Máy web luôn trên 70% CPU, hoặc trang Bảo mật báo nhiều nước đi "phải khởi động riêng" vì hết RAM | Tiến trình `server.js` tự nó chiếm hơn khoảng 60–70% một nhân, hoặc cần chạy liên tục khi bảo trì |
| Thêm vào hệ thống | Redis, 1 hoặc nhiều máy chạy bot | Thêm nginx cân bằng tải, PostgreSQL, 2 hoặc nhiều server web |
| Sửa code ở | `runner.js`, file mới `bot-worker-service.js` | Gần như mọi file server: `db.js`, `auth.js`, `tournament.js`, `server.js`, `api.js`, `netguard.js` |

Số đo hiện tại (máy 4 nhân, 16 GB): 200 trận online cùng lúc, tiến trình `server.js` chỉ dùng khoảng 6 giây CPU trong 30 giây, tức khoảng 20% một nhân. Phần còn lại là bot. Vì vậy với lớp học hay một trường, nên làm bậc 1 trước và có thể không bao giờ cần bậc 2. Ước lượng công là ước lượng cho một người đã quen code, chưa đo.

## Bậc 1: tách máy chạy bot

Server web vẫn điều phối trận như cũ, nhưng không tự chạy code bot nữa. Mỗi nước đi được gửi qua Redis sang một "máy chạy bot" (bot worker), máy đó chạy bằng đúng `runner.js` hiện tại (bubblewrap, tiến trình giữ lại) rồi trả kết quả về. Thiếu sức thì thêm máy chạy bot, không phải đụng vào server web.

### Điểm mấu chốt: một bot luôn về đúng một máy

Nếu dùng một hàng đợi chung, nước 1 của bot chạy ở máy A, nước 2 lại ở máy B. Khi đó tiến trình giữ lại của v6.6 mất tác dụng, và C++ phải biên dịch lại ở mỗi máy. Vì vậy thiết kế theo "phiên bot":

1. **Nạp bot.** Khi trận bắt đầu (hoặc khi giải đấu cần một bot), server web chọn máy còn trống nhiều nhất từ danh sách máy đang sống trong Redis, gửi `load {botKey, lang, code, game}` vào hàng đợi riêng của máy đó. Máy biên dịch (nếu là C++), giữ handler theo `botKey`, trả `{ok, error}`.
2. **Đi nước.** Server web gửi `move {botKey, state, timeoutMs}` vào hàng đợi của đúng máy đó. Máy chạy `executeBotMove` và trả `{move, log, elapsed, error}`.
3. **Tháo bot.** Trận xong thì gửi `unload {botKey}`. Máy nào không nhận lệnh tháo thì tự dọn bot rảnh quá 10 phút.
4. **Nhịp tim.** Mỗi máy ghi khóa `bw:alive:<id>` hết hạn sau 5 giây, kèm số slot trống và RAM còn lại. Mất nhịp tim là coi như máy chết.

### Giao thức qua Redis

| Khóa Redis | Loại | Ai ghi / ai đọc |
| --- | --- | --- |
| `bw:q:<workerId>` | list, đọc bằng `BLPOP` | server web đẩy việc vào, máy chạy bot lấy ra |
| `bw:reply:<webId>` | list | máy chạy bot đẩy kết quả, server web đọc và khớp theo `reqId` |
| `bw:alive:<workerId>` | chuỗi có TTL 5 giây | máy chạy bot ghi mỗi 2 giây, server web đọc khi chọn máy |
| `bw:bot:<botKey>` | chuỗi | `workerId` đang giữ bot đó, để server web nào cũng gửi đúng máy |

Dùng list thuần thay vì thư viện hàng đợi như BullMQ, vì mỗi nước đi chỉ vài mili giây và không cần lưu lại khi Redis khởi động lại: trận đang chạy đã có cơ chế hết giờ và đi nước thay. Thư viện client: `ioredis`.

### Sửa code ở đâu

- `runner.js` có 2 "backend" với cùng 3 hàm `prepareBot`, `executeBotMove`, `cleanupBot`. `BOT_BACKEND=local` (mặc định) giữ nguyên như bây giờ. `BOT_BACKEND=remote` thì handler chỉ là `{botKey, workerId}` và 3 hàm trên gửi lệnh qua Redis. Nhờ vậy `matchplay.js`, `tournament.js`, `server.js` và luyện tập `/api/run-bot-move` **không phải sửa**.
- File mới `bot-worker-service.js` (khoảng 200 dòng): vòng `BLPOP`, gọi `runner.js` bản local, ghi nhịp tim, dọn bot rảnh.
- Thời gian: máy chạy bot đếm giờ thật của bot (`elapsed`), nên độ trễ mạng không bị tính vào quỹ thời gian của bot. Server web chờ tối đa `timeoutMs + 500 ms`.
- Máy chết giữa nước: server web hết giờ chờ, nạp lại bot ở máy khác, chạy lại nước đó một lần. Giống cách v6.6 xử lý tiến trình chết, bot không bị phạt.

### Triển khai

- **Redis:** 1 máy nhỏ (1 nhân, 1 GB là đủ), bật mật khẩu, chỉ mở cổng 6379 cho mạng nội bộ. Tạo user ACL riêng cho máy chạy bot, chỉ được đụng khóa `bw:*`.
- **Máy chạy bot:** Linux có `bubblewrap`, `python3`, `g++`, Node. Chạy `REDIS_URL=... WORKER_SLOTS=<số nhân> node bot-worker-service.js` (hoặc một service trong `docker-compose.yml`). Máy này **không có database và không có `.env` của server**, nên dù bot vượt được sandbox cũng không đọc được mật khẩu hay code của người khác. Tường lửa chỉ cho phép kết nối tới Redis.
- **Server web:** thêm `BOT_BACKEND=remote` và `REDIS_URL`. Máy web giờ không cần `g++` hay `bubblewrap` nữa.

### Kiểm thử

- Chạy toàn bộ `npm test` hai lần: một lần local, một lần `BOT_BACKEND=remote` với Redis và một máy chạy bot chạy cục bộ. Test bảo mật (`sandbox.test.js`) thì chạy trên máy chạy bot.
- Test mới: giết máy chạy bot giữa một giải 16 bot, giải vẫn phải xong và không có nước đi nào bị tính lỗi cho bot.
- Đo tải bằng script đã dùng cho v6.6 ở 400 và 800 trận, với 1, 2, 4 máy chạy bot. Kỳ vọng số trận chạy mượt tăng gần theo số máy.

## Bậc 2: nhiều server web

Chạy 2 hoặc nhiều bản `server.js` sau một nginx. Việc khó không phải là nginx, mà là mọi thứ hiện đang nằm trong RAM của một tiến trình (bảng ở mục tiếp theo) phải chuyển sang Redis, và SQLite phải đổi sang PostgreSQL vì SQLite chỉ dùng được trên một máy.

### 1. Nginx và kết nối socket

- Cho mọi trang kết nối Socket.io chỉ bằng WebSocket: `io({ transports: ['websocket'] })` trong `logic.js`, `caro_page.js`, `arena.js`. Mỗi kết nối khi đó nằm trọn trên một server từ đầu đến cuối, nên không cần sticky session.
- Nếu vẫn cần long-polling (mạng trường chặn WebSocket) thì phải sticky. Đừng dùng `ip_hash`: cả lớp cùng một wifi sẽ chung một IP và dồn hết vào một server. Dùng `hash $cookie_ott_sid consistent;` với cookie do server đặt cho mọi khách.
- `upstream` trỏ tới các server web, kiểm tra sức khỏe bằng `GET /healthz` đã có. Giữ `TRUST_PROXY=1`.

### 2. Socket.io nói chuyện giữa các server

- Cài `@socket.io/redis-adapter`. Sau đó `io.to(room).emit(...)` ở bất kỳ server nào cũng tới được người xem ở server khác. Phần lớn code phát sự kiện hiện tại giữ nguyên.
- **Thu hồi phiên phải sửa.** Hiện `server.js` duyệt `io.sockets.sockets`, tức chỉ socket của server đó. Đổi thành: khi kết nối, cho socket vào phòng `user:<id>` và `sess:<hash>`; khi thu hồi, gọi `io.in('sess:<hash>').disconnectSockets(true)`. Adapter sẽ ngắt ở mọi server.

### 3. Phòng online

- Mỗi phòng có một "server chủ": nơi tạo phòng, giữ trạng thái phòng và chạy `playMatch`. Thông tin phòng (ghế, giai đoạn, trò chơi, server chủ) ghi vào Redis `room:<code>` để server nào cũng trả lời được `join_room` và đếm được `MAX_ROOMS`.
- Người chơi nối vào server khác vẫn vào phòng được, nhờ adapter. Các hành động của họ (`player_ready`, `request_rematch`, `leave_room`) được chuyển tới server chủ bằng `io.serverSideEmit`.
- Server chủ chết thì trận đang đấu mất: các server còn lại thấy khóa `room:<code>` hết nhịp tim và báo phòng đóng. Với trận chỉ vài phút thì đây là đánh đổi chấp nhận được.

### 4. Giải đấu chỉ chạy ở một nơi

- Hai server cùng bấm "Chạy toàn bộ giải" sẽ chạy trùng cặp đấu. Dùng khóa Redis: `SET tour:lock:<tid> <serverId> NX PX 10000`, gia hạn mỗi 3 giây. Server nào giữ khóa thì chạy vòng lặp `run()`, server khác chuyển lệnh chạy / tạm dừng sang đó.
- Server giữ khóa chết: khóa tự hết hạn, server khác nhận và chạy tiếp từ các cặp còn `ready`. Phần này đã gần sẵn, vì `tournament.js` vốn đưa cặp đang `running` về `ready` khi dừng.
- Ván đang đấu (`liveGames`) ghi bản chụp vào Redis `tour:live:<tid>` mỗi nước, để người mới mở trang ở server khác vẫn thấy bàn cờ hiện tại.

### 5. Đăng nhập admin bằng mã trên console

Với nhiều server, mã 6 số được in ra console của **server đã nhận yêu cầu đăng nhập**, admin không biết phải xem server nào. Có hai cách: gom log mọi server về một chỗ (ví dụ `docker compose logs -f web`), hoặc chuyển sang khóa cố định (`ADMIN_KEY_MODE=static`). Thử thách đăng nhập (`challenges` trong `auth.js`) cũng chuyển sang Redis `adm:ch:<sha>` với TTL 120 giây, đếm lần sai bằng `HINCRBY`.

### 6. SQLite sang PostgreSQL

Phần này tốn công nhất, vì `better-sqlite3` chạy đồng bộ mà driver `pg` chạy bất đồng bộ. Hiện có khoảng 100 câu lệnh `db.prepare` (57 trong `tournament.js`, 35 trong `auth.js`), và mọi hàm gọi chúng sẽ phải thành `async`.

1. Tách một lớp truy cập dữ liệu (`repo/users.js`, `repo/matches.js`, `repo/tournaments.js`) với các hàm `async`, **vẫn chạy trên SQLite trước**. Chạy `npm test` cho tới khi xanh.
2. Viết bản PostgreSQL của lớp đó, chọn bằng `DATABASE_URL`. Khác biệt chính: `?` thành `$1`, `AUTOINCREMENT` thành `GENERATED ALWAYS AS IDENTITY`, `pragma user_version` thành bảng `schema_migrations`, `db.transaction` thành `BEGIN ... COMMIT` trên một client.
3. Script chuyển dữ liệu: đọc `data/ott.db`, ghi sang PostgreSQL theo thứ tự khóa ngoại (users, sessions, tournaments, entries, series, matches, moves), rồi đặt lại sequence. Chạy thử trên bản sao trước.
4. `backup.js` thay bằng `pg_dump` theo lịch, hoặc dùng PostgreSQL có sẵn sao lưu của nhà cung cấp.

### Triển khai

- 1 nginx, 2 server web trở lên (`BOT_BACKEND=remote`, `REDIS_URL`, `DATABASE_URL`), 1 Redis, 1 PostgreSQL, các máy chạy bot của bậc 2.
- Cập nhật không gián đoạn: tắt từng server web một. Trước khi tắt, server ngừng nhận phòng mới, nhả khóa giải đấu và chờ các trận của mình đấu xong.

&#91;embedded content: kiến trúc sau bậc 3 · bậc 2 là phần Redis và máy chạy bot\]

Bậc 1 chỉ thêm Redis và máy chạy bot, vẫn một server web với SQLite. Bậc 2 thêm nginx, server web thứ hai và PostgreSQL.

## Trạng thái đang nằm trong RAM và chỗ mới của chúng

Đây là danh sách kiểm tra cho bậc 2, lấy từ code hiện tại. Những dòng ghi "giữ nguyên" là trạng thái chỉ cần đúng trên từng server.

| Trạng thái | Nằm ở | Chỗ mới | Bậc |
| --- | --- | --- | --- |
| Phòng online (`rooms`) | `server.js` | Redis `room:<code>` + server chủ chạy trận | 2 |
| Thu hồi phiên, ngắt socket | `server.js` (`auth.events`) | Phòng `sess:<hash>` + `disconnectSockets` qua adapter | 2 |
| Thử thách đăng nhập admin (`challenges`) | `auth.js` | Redis `adm:ch:<sha>`, TTL 120 giây | 2 |
| Khóa chống dò mật khẩu (`failures`) | `auth.js` | Redis `INCR` + `EXPIRE` theo tên đăng nhập | 2 |
| Giới hạn tần suất API theo IP (`hits`) | `api.js` | Redis, thư viện `rate-limiter-flexible` | 2 |
| Giới hạn sự kiện socket theo IP, số kết nối mỗi IP | `netguard.js` | Redis (phần theo IP). Phần theo từng socket giữ nguyên | 2 |
| Hạn mức luyện tập mỗi tài khoản (`localRunUsage`) | `server.js` | Redis theo `userId` | 2 |
| Vòng lặp chạy giải (`loops`) | `tournament.js` | Khóa `tour:lock:<tid>` trong Redis | 2 |
| Ván đang đấu của giải (`liveGames`) | `tournament.js` | Redis `tour:live:<tid>` | 2 |
| Bot đã biên dịch của giải (`handlers`) | `tournament.js` | Máy chạy bot, theo `botKey` | 1 |
| Bot luyện tập đã biên dịch (`localBotCache`) | `server.js` | Máy chạy bot. Bản cache trên server web giữ nguyên | 1 |
| Tiến trình bot giữ lại (`warm`) | `runner.js` | Máy chạy bot | 1 |
| Bảng xếp hạng bot có sẵn | `leaderboard.json` (chỉ đọc) | Giữ nguyên, đi kèm mỗi server | — |
| Tài khoản, phiên, trận, nước đi, giải đấu | SQLite `data/ott.db` | PostgreSQL | 2 |

## Thứ tự làm và rủi ro

Mỗi bước đều chạy được một mình và có công tắc để quay lại cách cũ. Sau mỗi bước thì đo lại, đủ thì dừng.

1. **Bậc 1, máy chạy bot qua Redis** . Công tắc: `BOT_BACKEND=local`. Đạt khi: 800 trận online chạy mượt với 2 máy chạy bot, và giết một máy giữa giải không làm bot nào bị tính lỗi.
2. **Bậc 2a, chuyển trạng thái RAM sang Redis + Socket.io adapter** , vẫn chạy một server web, vẫn SQLite. Công tắc: không đặt `REDIS_URL` thì dùng bản trong RAM như cũ. Đạt khi: `npm test` xanh ở cả hai chế độ.
3. **Bậc 2b, lớp truy cập dữ liệu async, rồi PostgreSQL** . Công tắc: không đặt `DATABASE_URL` thì dùng SQLite. Đạt khi: script chuyển dữ liệu chạy đúng trên bản sao `data/ott.db` thật, số trận và số nước đi khớp trước và sau.
4. **Bậc 2c, bật server web thứ hai sau nginx.** Đạt khi: tắt một server giữa lúc đang có người chơi, giải đấu chạy tiếp trên server còn lại, đăng xuất ở server này ngắt socket ở server kia.

| Rủi ro | Ảnh hưởng | Cách giảm |
| --- | --- | --- |
| Redis chết | Mọi trận đang chạy dừng, không tạo được phòng mới | Redis có bản dự phòng (Sentinel hoặc dịch vụ có sẵn). Trận đang chạy vốn đã có cơ chế đi nước thay khi bot không trả lời |
| Độ trễ mạng tới máy chạy bot | Mỗi nước chậm thêm khoảng 1–3 ms trong cùng trung tâm dữ liệu (ước lượng) | Để mọi máy cùng một mạng nội bộ. Thời gian của bot đếm ở máy chạy bot nên bot không bị thiệt |
| Chuyển sang async làm lộ lỗi tranh chấp | Hai yêu cầu cùng sửa một giải đấu, trước đây vô tình được SQLite đồng bộ bảo vệ | Mỗi thao tác giải đấu trong một transaction, dùng `SELECT ... FOR UPDATE`. Chạy test song song |
| Mã admin in ở console của server khác | Admin không đăng nhập được | Gom log về một chỗ, hoặc dùng `ADMIN_KEY_MODE=static` |
| Chi phí vận hành | Từ 1 máy lên 5–6 máy phải theo dõi | Chỉ làm bậc 3 khi số đo bậc 2 cho thấy server web là nút cổ chai |

**Cách đo** dùng lại script tải của bản mới nhất: bao nhiêu trận online cùng lúc mà khoảng cách giữa hai nước vẫn dưới 0,6 giây, CPU của riêng `server.js`, và số nước "phải khởi động riêng" trên trang Quản trị → Bảo mật.
