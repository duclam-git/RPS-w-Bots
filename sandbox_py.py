# OTTv2 Code Arena - Python bot launcher.
#
#   python3 -X utf8 sandbox_py.py <bot.py>
#
# Applies resource limits and an audit hook, then runs the bot exactly like `python3 bot.py`.
#
# IMPORTANT: an audit hook raises the bar a lot but is NOT a security boundary on its own (Python's
# own docs say so). On Linux the real boundary is bubblewrap (see sandbox.js); this launcher is the
# layer that protects Windows / macOS / Linux-without-bwrap and adds defence in depth everywhere.

import os
import runpy
import sys

sys.dont_write_bytecode = True


def _apply_limits():
    try:
        import resource  # POSIX only
    except ImportError:
        return
    mem = int(os.environ.get("OTT_MEM_MB", "512")) << 20
    cpu = int(os.environ.get("OTT_CPU_SEC", "10"))
    limits = (
        ("RLIMIT_CORE", 0),        # no core dumps
        ("RLIMIT_FSIZE", 0),       # cannot create / grow any file
        ("RLIMIT_NOFILE", 64),
        ("RLIMIT_CPU", cpu),
        ("RLIMIT_AS", mem),
    )
    for name, value in limits:
        try:
            resource.setrlimit(getattr(resource, name), (value, value))
        except Exception:
            pass


def _allowed_read_roots(bot_file):
    import sysconfig
    roots = set()
    for p in (sys.prefix, sys.base_prefix, sys.exec_prefix, sys.base_exec_prefix,
              os.path.dirname(os.__file__)):
        if p:
            roots.add(os.path.normpath(p))
    try:
        for key in ("stdlib", "platstdlib", "purelib", "platlib"):
            p = sysconfig.get_paths().get(key)
            if p:
                roots.add(os.path.normpath(p))
    except Exception:
        pass
    try:
        import site
        for p in list(site.getsitepackages()) + [site.getusersitepackages()]:
            roots.add(os.path.normpath(p))
    except Exception:
        pass
    # distro Pythons keep part of the stdlib outside sys.prefix
    for p in ("/usr/lib", "/usr/lib64", "/usr/local/lib", "/usr/share/zoneinfo", "/lib", "/lib64"):
        roots.add(p)
    roots.add(os.path.normpath(os.path.abspath(bot_file)))
    roots.add(os.path.normpath(os.path.abspath(__file__)))
    return tuple(roots)


_DENY_EVENTS = frozenset((
    # processes
    "os.system", "os.exec", "os.fork", "os.forkpty", "os.posix_spawn", "os.spawn",
    "subprocess.Popen", "os.kill", "os.killpg", "os.startfile",
    # filesystem changes
    "os.remove", "os.rename", "os.rmdir", "os.mkdir", "os.chmod", "os.chown", "os.link",
    "os.symlink", "os.truncate", "os.utime", "os.mkfifo", "os.mknod", "os.chflags",
    "os.lchmod", "os.lchown", "os.setxattr", "os.removexattr", "os.chroot",
    "shutil.copyfile", "shutil.copymode", "shutil.copystat", "shutil.copytree",
    "shutil.move", "shutil.rmtree", "shutil.chown", "shutil.make_archive", "shutil.unpack_archive",
    "tempfile.mkstemp", "tempfile.mkdtemp",
    # native code / network
    "ctypes.dlopen", "ctypes.dlsym", "ctypes.dlsym/handle", "ctypes.cdata", "ctypes.cdata/buffer",
    "ctypes.addressof", "ctypes.call_function", "ctypes.create_string_buffer",
    "ctypes.create_unicode_buffer", "ctypes.get_errno", "ctypes.set_errno",
    "socket.__new__", "socket.bind", "socket.connect", "socket.getaddrinfo", "socket.gethostbyname",
    "socket.gethostbyaddr", "socket.sendto", "socket.sendmsg", "socket.getnameinfo",
    "urllib.Request", "http.client.connect", "ftplib.connect", "smtplib.connect", "telnetlib.Telnet.open",
    # introspection / escape hatches
    "pty.spawn", "webbrowser.open",
))

_DENY_IMPORTS = frozenset((
    "ctypes", "_ctypes", "socket", "_socket", "subprocess", "_posixsubprocess", "multiprocessing",
    "_multiprocessing", "ssl", "_ssl", "http", "urllib", "ftplib", "smtplib", "imaplib", "poplib",
    "telnetlib", "socketserver", "asyncio", "webbrowser", "pty", "tty", "cffi", "_cffi_backend",
    "mmap", "winreg", "_winapi", "msvcrt", "nt", "posix_spawn",
))

_WRITE_FLAGS = 0
for _name in ("O_WRONLY", "O_RDWR", "O_APPEND", "O_CREAT", "O_TRUNC"):
    _WRITE_FLAGS |= getattr(os, _name, 0)


def _install_hook(bot_file):
    roots = _allowed_read_roots(bot_file)
    normpath, abspath = os.path.normpath, os.path.abspath
    deny_events, deny_imports, write_flags = _DENY_EVENTS, _DENY_IMPORTS, _WRITE_FLAGS

    def hook(event, args):
        if event in deny_events:
            raise PermissionError("OTT sandbox: '%s' bi chan" % event)
        if event == "import":
            name = args[0].split(".")[0] if args and isinstance(args[0], str) else ""
            if name in deny_imports:
                raise PermissionError("OTT sandbox: khong duoc import '%s'" % name)
        elif event == "os.listdir" or event == "os.scandir":
            path = args[0]
            if isinstance(path, int):
                raise PermissionError("OTT sandbox: khong duoc liet ke thu muc")
            try:
                p = normpath(abspath(os.fsdecode(path) if path is not None else "."))
            except Exception:
                raise PermissionError("OTT sandbox: duong dan khong hop le")
            for r in roots:
                if p == r or p.startswith(r.rstrip(os.sep) + os.sep):
                    return
            raise PermissionError("OTT sandbox: khong duoc liet ke '%s'" % p)
        elif event == "open":
            path, mode, flags = args[0], args[1], args[2]
            if isinstance(path, int):          # an already-open descriptor (stdin / stdout)
                return
            writing = (isinstance(flags, int) and flags & write_flags) or \
                      (isinstance(mode, str) and any(ch in mode for ch in "wax+"))
            if writing:
                raise PermissionError("OTT sandbox: khong duoc ghi file")
            try:
                p = normpath(abspath(os.fsdecode(path)))
            except Exception:
                raise PermissionError("OTT sandbox: duong dan khong hop le")
            if p == os.devnull or p in ("/dev/urandom", "/dev/random"):
                return
            for r in roots:
                if p == r or p.startswith(r.rstrip(os.sep) + os.sep):
                    return
            raise PermissionError("OTT sandbox: khong duoc doc '%s'" % p)

    sys.addaudithook(hook)


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: sandbox_py.py <bot.py>\n")
        sys.exit(2)
    bot = sys.argv[1]
    _apply_limits()
    # pre-import what the runner needs, BEFORE the hook is armed
    import json  # noqa: F401
    _install_hook(bot)
    # the project directory (where this launcher lives) must not be importable / listable by the bot
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:] = [p for p in sys.path if p and os.path.abspath(p) != here]
    sys.argv = [bot]
    runpy.run_path(bot, run_name="__main__")


if __name__ == "__main__":
    main()
