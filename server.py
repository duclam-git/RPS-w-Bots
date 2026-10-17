"""
OTTv2 Code Arena - Local Runner Server (Python 3)
Serves static web files and provides the /api/run-bot-move endpoint
Compiles C++ with g++ and executes Python scripts.

Usage:
    python server.py [port]
"""

import sys
import os
import json
import subprocess
import tempfile
import time
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMP_DIR = os.path.join(BASE_DIR, 'temp_bots')

os.makedirs(TEMP_DIR, exist_ok=True)


def run_cpp_bot(bot_id, code, state, timeout=2.5):
    src_path = os.path.join(TEMP_DIR, f"bot_{bot_id}.cpp")
    exe_path = os.path.join(TEMP_DIR, f"bot_{bot_id}.exe")

    with open(src_path, 'w', encoding='utf-8') as f:
        f.write(code)

    # Compile
    compile_proc = subprocess.run(
        ['g++', '-O2', '-std=c++17', src_path, '-o', exe_path],
        capture_output=True,
        text=True,
        timeout=15
    )
    if compile_proc.returncode != 0:
        return {
            'success': False,
            'error': f"Lỗi biên dịch C++:\n{compile_proc.stderr or compile_proc.stdout}"
        }

    start_time = time.time()
    try:
        run_proc = subprocess.run(
            [exe_path],
            input=json.dumps(state),
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=timeout
        )
        elapsed = (time.time() - start_time) * 1000
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'error': f"Quá thời gian quy định ({int(timeout*1000)}ms)"
        }

    return parse_bot_output(run_proc.stdout, run_proc.stderr, elapsed)


def run_python_bot(bot_id, code, state, timeout=2.5):
    script_path = os.path.join(TEMP_DIR, f"bot_{bot_id}.py")
    with open(script_path, 'w', encoding='utf-8') as f:
        f.write(code)

    start_time = time.time()
    try:
        run_proc = subprocess.run(
            [sys.executable, script_path],
            input=json.dumps(state),
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=timeout
        )
        elapsed = (time.time() - start_time) * 1000
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'error': f"Quá thời gian quy định ({int(timeout*1000)}ms)"
        }

    return parse_bot_output(run_proc.stdout, run_proc.stderr, elapsed)


def parse_bot_output(stdout_data, stderr_data, elapsed):
    lines = stdout_data.strip().splitlines()
    found_move = None
    for line in reversed(lines):
        line = line.strip()
        if line.startswith('{') and line.endswith('}'):
            try:
                parsed = json.loads(line)
                if 'from' in parsed and 'to' in parsed:
                    found_move = parsed
                    break
            except Exception:
                pass

    if found_move:
        return {
            'success': True,
            'move': found_move,
            'log': stderr_data or stdout_data,
            'elapsed': round(elapsed, 1)
        }
    else:
        return {
            'success': False,
            'log': stderr_data or stdout_data,
            'error': f"Bot không in ra nước đi hợp lệ dưới dạng JSON: {stdout_data[:150]}"
        }


class ArenaRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == '/api/run-bot-move':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                payload = json.loads(post_data)
                bot_id = payload.get('botId', 'local_bot')
                lang = payload.get('lang', '')
                code = payload.get('code', '')
                state = payload.get('state', {})

                if lang == 'cpp':
                    result = run_cpp_bot(bot_id, code, state)
                elif lang == 'python':
                    result = run_python_bot(bot_id, code, state)
                else:
                    result = {'success': False, 'error': f"Ngôn ngữ không được hỗ trợ: {lang}"}

                response_bytes = json.dumps(result).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(response_bytes)))
                self.end_headers()
                self.wfile.write(response_bytes)
            except Exception as e:
                err_bytes = json.dumps({'success': False, 'error': str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(err_bytes)))
                self.end_headers()
                self.wfile.write(err_bytes)
        else:
            self.send_error(404, "Endpoint not found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


def run():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, ArenaRequestHandler)
    print(f"OTTv2 Arena Local Server chạy tại: http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã tắt server.")
        httpd.server_close()


if __name__ == '__main__':
    run()

