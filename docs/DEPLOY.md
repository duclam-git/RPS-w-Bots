# Triển khai & vận hành

## 1. Chạy tại máy (lớp học / LAN)

```bash
npm install
cp .env.example .env        # sửa ADMIN_PASSWORD (và ADMIN_KEY nếu dùng khóa cố định); server tự đọc .env (biến môi trường thật luôn thắng)
npm start                   # http://<IP máy>:3000 — trang đăng nhập; cho học sinh vào bằng IP đó
```
`sudo apt install bubblewrap` nếu là Linux (cách ly bot, xem `SECURITY.md`). Windows/macOS chạy được, chỉ có tầng bảo vệ cơ bản.

## 2. Công khai ra Internet (khuyến nghị)

Thứ tự: máy Linux → user riêng không đặc quyền → `bubblewrap` → reverse proxy HTTPS → `.env` đúng.

```
Internet ──HTTPS──> nginx/Caddy ──http://127.0.0.1:3000──> node server.js (user "ott", systemd)
```

`.env` tối thiểu:
```
ADMIN_PASSWORD=<mật khẩu admin dài>
ADMIN_KEY_MODE=console     # bước 2 của đăng nhập admin: mã 1 lần in ra console (cần xem được log server)
# ADMIN_KEY=<chuỗi ngẫu nhiên dài>   # hoặc khóa cố định (static) nếu admin không xem được log
TRUST_PROXY=1               # BẮT BUỘC sau proxy: để giới hạn tần suất thấy IP thật (xem §4)
COOKIE_SECURE=1             # cookie Secure + HSTS
SANDBOX_STRICT=1            # từ chối ngôn ngữ không được cách ly mạnh
```

| Thành phần | Tệp | Ghi chú |
|---|---|---|
| nginx | `deploy/nginx-ott.conf` | **Đã kiểm thử thật** (`test/proxy.test.js` chạy nginx thật trước server thật: HTTP, WebSocket, chặn Origin lạ, IP thật, giới hạn body 2MB) |
| Caddy | `deploy/Caddyfile` | HTTPS tự động; chưa kiểm thử ở đây |
| systemd | `deploy/ott.service` | `KillSignal=SIGTERM` để tắt êm; **đừng** thêm `RestrictNamespaces=`/`PrivateUsers=` (bubblewrap cần user namespace) |
| Docker | `Dockerfile`, `docker-compose.yml` | **Chưa build/chạy được trong môi trường phát triển** (không có Docker) — thử `docker compose up --build` trước khi tin |

Hai bẫy khi đặt proxy (cả hai đều đã được test):
1. **`Host` phải giữ cả cổng** (`proxy_set_header Host $http_host;`, không phải `$host`). Server từ chối WebSocket có `Origin` khác `Host` (chống chiếm WebSocket từ trang web lạ); `$host` làm mất cổng nên WebSocket hỏng. Test đối chứng đã xác nhận.
2. **`TRUST_PROXY` đúng số tầng proxy.** Để trống khi khách nối thẳng — nếu tin `X-Forwarded-For` mà không có proxy thật, ai cũng giả IP để né mọi giới hạn. Đặt `1` khi có đúng một proxy; server chỉ tin phần tử *cuối* (do proxy thêm), không tin phần client tự gửi.

Docker + bubblewrap: bubblewrap cần user namespace mà seccomp/AppArmor mặc định của Docker cấm, nên `docker-compose.yml` bỏ hai hàng rào đó (`seccomp=unconfined`, `apparmor=unconfined`) và đổi lại bỏ mọi capability, chạy non-root, root filesystem chỉ đọc. Nếu không chấp nhận, đặt `SANDBOX=builtin` và bỏ `SANDBOX_STRICT` — chấp nhận tầng cơ bản, và C++ **không** được cách ly.

## 3. Các biến cấu hình mạng / giới hạn

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `TRUST_PROXY` | rỗng | số tầng reverse proxy tin cậy |
| `COOKIE_SECURE` | rỗng | `1` khi dùng HTTPS |
| `ALLOWED_ORIGINS` | rỗng | origin khác được gọi API / mở WebSocket (cùng origin luôn được) |
| `MAX_SOCKETS_PER_IP` | 40 | kết nối WebSocket đồng thời / IP |
| `MAX_ROOMS` | 200 | số phòng online tối đa |
| `MAX_BOT_PROCS` | số CPU (≥2) | tiến trình bot đồng thời cho **toàn máy chủ** (phòng online + giải + luyện tập) |
| `MAX_COMPILES` | 2 | số `g++` chạy cùng lúc |
| `WARM_BOTS` | `1` | `0` = mỗi nước đi khởi động một tiến trình bot mới (như bản ≤ v6.5) |
| `WARM_BOTS_MEM_MB` | 40% RAM máy | RAM dành cho các tiến trình bot đang được giữ lại (JS ~48MB, Python ~16MB mỗi tiến trình) |
| `WARM_BOTS_IDLE_SEC` / `WARM_BOTS_MAX_MOVES` | 30 / 100 | tiến trình rảnh quá lâu thì dừng; phục vụ đủ số nước thì thay mới |
| `SANDBOX_WARM_CPU_SEC` | 120 | hạn mức CPU của cả một tiến trình bot được giữ lại (mỗi nước đi vẫn bị `SANDBOX_CPU_SEC` chặn) |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` / `BACKUP_DIR` | 24 / 14 / `data/backups` | sao lưu tự động |

Giới hạn tự động (không cấu hình): 60 sự kiện socket dồn / 30 mỗi giây; tạo phòng 5/phút/socket; nộp code 8/phút/socket và 40/phút/IP; body JSON ≤ 2MB; code bot ≤ 100KB; một socket chỉ ở một phòng.

## 4. Vận hành

- **Sức khỏe:** `GET /healthz` → `{"ok":true,"uptime":…}` (503 nếu DB hỏng). Dùng cho Docker `HEALTHCHECK`, uptime monitor, load balancer.
- **Tắt máy êm:** `SIGTERM`/`SIGINT` → ngừng nhận kết nối, dừng các giải đang chạy **nhưng giữ cờ tự chạy** (khởi động lại là chạy tiếp, ván dở bị hủy và đấu lại), hủy trận đang đấu, kill tiến trình bot, xóa tệp tạm, đóng CSDL, thoát mã 0. Quá 12 giây thì thoát cưỡng bức. Có test (`test/network.test.js`).
- **Sao lưu:** tự động mỗi 24 giờ (SQLite online backup, nhất quán khi server vẫn chạy), giữ 14 bản. Quản trị → 💾 Sao lưu để sao lưu ngay hoặc tải về. **Bản sao lưu chứa băm mật khẩu và code mọi bot — cất kỹ.** Khôi phục: tắt server → chép file `.db` đè `data/ott.db` → xóa `ott.db-wal`, `ott.db-shm` → bật lại.
- **Tải:** Quản trị → 🛡 Bảo mật cho thấy số tiến trình bot đang chạy/đang chờ trên toàn máy chủ.
- **Lỗi không lường trước:** `unhandledRejection` được ghi log; `uncaughtException` ghi log rồi tắt êm (để systemd/Docker khởi động lại). Handler socket bọc try/catch và ép payload thành object nên gói tin xấu không làm sập server.
