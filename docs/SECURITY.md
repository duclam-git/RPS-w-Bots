# Cách ly code bot (sandbox)

Bot là **code do người khác viết, chạy ngay trên máy chủ**. Không có cách ly thì một bot có thể đọc `data/ott.db` (chứa code của mọi người và băm mật khẩu), đọc `ADMIN_KEY`, mở kết nối mạng ra ngoài, hoặc xóa file. Phiên bản này có hai tầng, tự chọn tầng mạnh nhất có sẵn; trạng thái hiện ở console lúc khởi động và ở **Quản trị → 🛡 Bảo mật**.

## 1. Hai tầng

| | Tầng **mạnh** (Linux + bubblewrap) | Tầng **cơ bản** (mọi hệ điều hành) |
|---|---|---|
| Cách làm | Mỗi lần chạy bot là một *namespace* mới: không mạng, không thấy file của máy chủ (chỉ file bot + thư viện hệ thống chỉ-đọc), `/tmp` là tmpfs rỗng, PID riêng (kill launcher = chết cả cây tiến trình), `prlimit` giới hạn CPU/RAM/file | JS: `node --permission` (cấm tạo tiến trình, cấm ghi file, chỉ đọc đúng 2 file). Python: `sandbox_py.py` (audit-hook chặn tiến trình/socket/ctypes/ghi file/đọc & liệt kê ngoài vùng cho phép + rlimit). C++: chỉ rlimit |
| JavaScript | 🛡 mạnh | 🟡 cơ bản — **mạng không bị chặn** |
| Python | 🛡 mạnh | 🟡 cơ bản |
| C++ | 🛡 mạnh | 🟠 **yếu — code native làm được mọi thứ tài khoản máy chủ làm được** |
| Biên dịch C++ | `g++` cũng chạy trong namespace (giới hạn RAM/CPU/file, không thấy `/etc`, `data/`…) | `g++` chỉ có `ulimit` |
| Chi phí | ~+10–25 ms mỗi nước đi | ~+10–20 ms |

Luôn áp dụng (mọi tầng): bot không thừa hưởng biến môi trường của server (`ADMIN_KEY`…), output tối đa 1 MB, kill đúng hạn, quét `#include "/etc/…"`/`"../…"` ở mã C++.

Đo thực tế (trung vị 25 nước, máy dev): tắt sandbox 44/30/3 ms (JS/Python/C++), cơ bản 52/49/5, mạnh 60/56/11.

## 2. Bật tầng mạnh

```bash
sudo apt install bubblewrap          # Debian/Ubuntu (Fedora: dnf install bubblewrap)
npm start                            # console in: "Sandbox (bwrap): JS 🛡️ mạnh · Python 🛡️ mạnh · C++ 🛡️ mạnh"
```
Nếu bubblewrap có mà không chạy được (Ubuntu 24.04 hạn chế user namespace, hoặc chạy bên trong Docker mặc định), server tự **rơi về tầng cơ bản** và ghi lý do vào console và trang Bảo mật — không âm thầm giả vờ an toàn.

## 3. Cấu hình

| Biến môi trường | Ý nghĩa |
|---|---|
| `SANDBOX=auto` (mặc định) | dùng tầng mạnh nếu có, không thì cơ bản |
| `SANDBOX=bwrap` | **đòi** tầng mạnh; không có thì từ chối chạy bot |
| `SANDBOX=builtin` | chỉ dùng tầng cơ bản |
| `SANDBOX=off` | không cách ly (không khuyến nghị) |
| `SANDBOX_STRICT=1` | ngôn ngữ nào không được cách ly **mạnh** thì bị từ chối ở đăng ký giải / phòng online / luyện tập (khuyến nghị khi mở ra Internet) |
| `SANDBOX_MEM_MB` (512), `SANDBOX_CPU_SEC` (10), `SANDBOX_COMPILE_MEM_MB` (2048) | giới hạn tài nguyên |
| `ALLOW_LOCAL_RUN=0` | tắt hẳn `/api/run-bot-move` (luyện tập Python/C++ qua server) |

## 4. Khuyến nghị theo cách triển khai

- **Lớp học / LAN tin cậy, Windows hay macOS:** mặc định là đủ (JS/Python có bảo vệ cơ bản; chỉ nhận C++ từ người bạn tin).
- **Công khai ra Internet:** Linux + bubblewrap + `SANDBOX_STRICT=1`, chạy server bằng user không đặc quyền, đặt sau reverse proxy HTTPS (đặt `COOKIE_SECURE=1`), đặt `ADMIN_KEY` cố định.

## 5. Giới hạn — đọc kỹ

- **Không phải máy ảo.** Namespace dùng chung nhân Linux với máy chủ; lỗ hổng nhân (hiếm, nhưng có) vượt được. Với dữ liệu quan trọng, chạy cả server trong VM/container riêng.
- Giới hạn tài nguyên áp **cho từng tiến trình bot**, chưa có cgroup tổng: nhiều bot chạy song song (`concurrency` tối đa 4 mỗi giải) vẫn cộng dồn RAM/CPU.
- `node --permission` còn gắn nhãn thử nghiệm và **không chặn mạng**; audit-hook của Python chỉ là hàng rào tự nguyện ở mức ngôn ngữ (docs của Python cũng nói vậy). Hai thứ này là lớp phụ, ranh giới thật chỉ có ở tầng mạnh.
- Trên tầng cơ bản, bot vẫn thấy được vài thứ không nhạy cảm (tên thư viện hệ thống, `process.version`…), và C++ không được cách ly.
- Test: `test/sandbox.test.js` chạy bot tấn công (đọc bí mật, ghi file máy chủ, mở socket, tạo tiến trình, vòng lặp vô hạn, ngốn RAM) trên mọi tầng có sẵn và kiểm tra **máy chủ không bị đụng tới**. Có đối chứng: tắt sandbox thì cùng bot C++ đọc được bí mật, ghi được file và kết nối được mạng.

## 6. Lỗi tìm thấy trong lúc làm
- Audit-hook Python lúc đầu chặn *đọc file* nhưng quên *liệt kê thư mục*: bot Python liệt kê được thư mục dự án. Đã chặn; có test.
- Race ở thao tác "Đấu lại / xử thắng": ngay khi giải kết thúc hoặc vừa tạm dừng, vòng lặp nền còn sống tối đa 250 ms nên thao tác bị từ chối hoặc "Chạy" im lặng không làm gì. Vòng lặp giờ tự dừng khi giải xong và các thao tác chỉnh sửa chờ nó dừng hẳn.
