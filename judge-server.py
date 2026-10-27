#!/usr/bin/env python3
"""Local personal-practice judge for the GitHub Pages problem set.

Runs compilation and contestant programs in bubblewrap, not on the host.
The HTTP endpoint is bound to loopback and accepts browser requests only from
the configured GitHub Pages origin (plus explicit loopback preview origins).
"""

import argparse
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if ROOT.name == "runner" and Path(__file__).name == "server.py":
    ROOT = ROOT.parent
DEFAULT_ORIGINS = {
    "https://lbn233.github.io",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
}
MAX_REQUEST_BYTES = 200_000
MAX_SOURCE_BYTES = 150_000
MAX_CAPTURE_BYTES = 8 * 1024 * 1024
MAX_CASES = 100
COMPILE_TIMEOUT = 40
CASE_TIMEOUT = 12
REQUEST_LOCK = threading.Lock()


def test_file():
    for path in (ROOT / "tests.json", ROOT / "site" / "tests.json", ROOT / "dist" / "tests.json"):
        if path.is_file():
            return path
    raise FileNotFoundError("未找到 tests.json，请从题库根目录启动评测机。")


def problem_file():
    for path in (ROOT / "problems.json", ROOT / "site" / "problems.json", ROOT / "dist" / "problems.json"):
        if path.is_file():
            return path
    raise FileNotFoundError("未找到 problems.json，请从题库根目录启动评测机。")


def verify_dependencies():
    missing = [name for name in ("bwrap", "prlimit", "g++", "python3") if not shutil.which(name)]
    if missing:
        raise RuntimeError("缺少 WSL 评测依赖：" + ", ".join(missing))
    test_file()
    problem_file()
    # Fail closed if user namespaces or the network namespace are unavailable.
    test = subprocess.run(
        [shutil.which("bwrap"), "--unshare-all", "--die-with-parent", "--ro-bind", "/usr", "/usr",
         "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "/usr/bin/true"],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=8,
    )
    if test.returncode:
        raise RuntimeError("bubblewrap 隔离环境无法启动：" + test.stderr[:500])


def sandbox_command(directory, command, *, compiling=False):
    # Do not expose /home, /mnt, user credentials, the judge or its test files.
    args = [
        shutil.which("bwrap"), "--unshare-all", "--die-with-parent", "--clearenv",
        "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/tmp",
        "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib",
        "--ro-bind", "/lib64", "/lib64", "--ro-bind", "/bin", "/bin",
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
        "--bind" if compiling else "--ro-bind", str(directory), "/work", "--chdir", "/work",
    ]
    cpu = 30 if compiling else 8
    file_limit = 64 * 1024 * 1024 if compiling else MAX_CAPTURE_BYTES
    args += [
        "/usr/bin/prlimit", "--cpu=" + str(cpu), "--as=" + str(1024 * 1024 * 1024),
        "--fsize=" + str(file_limit), "--nofile=64", "--nproc=64", "--",
    ]
    return args + command


def execute(command, input_data, timeout):
    # Files rather than PIPEs bound the memory consumed by program output.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=out, stderr=err, start_new_session=True)
        timed_out = False
        try:
            process.communicate(input=input_data.encode("utf-8"), timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
        out.seek(0)
        err.seek(0)
        stdout = out.read(MAX_CAPTURE_BYTES + 1)
        stderr = err.read(MAX_CAPTURE_BYTES + 1)
    return {
        "returncode": process.returncode,
        "timed_out": timed_out,
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
    }


def compare(output, expected, floating):
    actual = output.split()
    want = str(expected).split()
    if len(actual) != len(want):
        return False
    if floating:
        for a, b in zip(actual, want):
            try:
                x, y = float(a), float(b)
            except ValueError:
                return False
            if not math.isfinite(x) or not math.isfinite(y):
                return False
            if not (abs(x - y) <= 1e-6 or abs(x - y) <= 1e-6 * abs(y)):
                return False
        return True
    # Integers are parsed exactly rather than through floating point.
    for a, b in zip(actual, want):
        if not re.fullmatch(r"[+-]?\d+", a) or not re.fullmatch(r"[+-]?\d+", b):
            return False
        try:
            if int(a) != int(b):
                return False
        except ValueError:
            return False
    return True


def result(status, message, passed, total, cases):
    return {"status": status, "message": message, "passed": passed, "total": total, "cases": cases}


def judge(problem_id, language, source):
    if not isinstance(problem_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", problem_id):
        raise ValueError("题目编号无效。")
    if language not in ("cpp", "python"):
        raise ValueError("仅支持 C++17 和 Python 3。")
    if not isinstance(source, str) or not source.strip() or len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise ValueError("代码为空或超过大小限制。")
    with test_file().open(encoding="utf-8") as f:
        suite = json.load(f)
    tests = suite.get(problem_id)
    if not isinstance(tests, list) or not 1 <= len(tests) <= MAX_CASES:
        raise ValueError("没有找到这道题的有效测试数据。")
    with problem_file().open(encoding="utf-8") as f:
        problems = json.load(f)
    if not isinstance(problems, list):
        raise ValueError("题目配置格式无效。")
    matches = [entry for entry in problems if isinstance(entry, dict) and entry.get("id") == problem_id]
    if len(matches) != 1:
        raise ValueError("题目配置缺失或存在重复编号。")
    judge_type = matches[0].get("judgeType")
    if judge_type not in ("integer", "integer-lines", "float"):
        raise ValueError("不支持的判题类型：" + str(judge_type))
    cases = []
    with tempfile.TemporaryDirectory(prefix="personal-oj-") as temporary:
        directory = Path(temporary)
        filename = "main.cpp" if language == "cpp" else "main.py"
        (directory / filename).write_text(source, encoding="utf-8")
        build_command = (["/usr/bin/g++", "-std=c++17", "-O2", "-pipe", "/work/main.cpp", "-o", "/work/main"]
                         if language == "cpp" else ["/usr/bin/python3", "-I", "-m", "py_compile", "/work/main.py"])
        build = execute(sandbox_command(directory, build_command, compiling=True), "", COMPILE_TIMEOUT)
        if build["timed_out"]:
            return result("compile_error", "编译超时。", 0, len(tests), cases)
        if build["returncode"] != 0:
            return result("compile_error", "编译失败：\n" + (build["stderr"] or build["stdout"])[:4000], 0, len(tests), cases)
        program = ["/work/main"] if language == "cpp" else ["/usr/bin/python3", "-I", "-B", "/work/main.py"]
        for idx, test in enumerate(tests):
            name = str(test.get("name") or f"测试点 {idx + 1}")[:100]
            run = execute(sandbox_command(directory, program), str(test.get("input", "")), CASE_TIMEOUT)
            # bubblewrap can translate a child's signal into shell-style 128+signal.
            if run["timed_out"] or run["returncode"] in (
                -signal.SIGXCPU, -signal.SIGKILL, 128 + signal.SIGXCPU, 128 + signal.SIGKILL
            ):
                cases.append({"name": name, "status": "time_limit", "message": "运行超时或超出资源限制。"})
                return result("time_limit", "运行超时或超出资源限制。", idx, len(tests), cases)
            if run["returncode"] != 0:
                cases.append({"name": name, "status": "runtime_error", "message": run["stderr"][:4000] or "程序异常退出。"})
                return result("runtime_error", cases[-1]["message"], idx, len(tests), cases)
            if len(run["stdout"].encode("utf-8")) > MAX_CAPTURE_BYTES:
                cases.append({"name": name, "status": "runtime_error", "message": "输出超过限制。"})
                return result("runtime_error", "输出超过限制。", idx, len(tests), cases)
            if not compare(run["stdout"], test.get("expected", ""), judge_type == "float"):
                expected = str(test.get("expected", ""))[:120] or "（空输出）"
                actual = run["stdout"][:120] or "（空输出）"
                msg = "答案错误。期望：" + expected + "；你的输出：" + actual
                cases.append({"name": name, "status": "wrong_answer", "message": msg})
                return result("wrong_answer", msg, idx, len(tests), cases)
            cases.append({"name": name, "status": "accepted", "message": "通过"})
    return result("accepted", f"已通过本练习题的全部 {len(tests)} 组测试。", len(tests), len(tests), cases)


class Handler(BaseHTTPRequestHandler):
    server_version = "PersonalOJ/1"

    def valid_host(self):
        return self.headers.get("Host", "").lower() in ("127.0.0.1:8766", "localhost:8766")

    def valid_origin(self):
        return self.headers.get("Origin", "") in self.server.allowed_origins

    def send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if self.valid_origin():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.valid_host() or not self.valid_origin():
            self.send_json(403, {"error": "来源不允许。"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self.valid_host() or (self.headers.get("Origin") and not self.valid_origin()):
            self.send_json(403, {"error": "来源不允许。"})
            return
        if self.path != "/health":
            self.send_json(404, {"error": "未找到接口。"})
            return
        self.send_json(200, {"status": "ok", "service": "wsl-oj", "languages": ["cpp", "python"], "sandbox": "bubblewrap"})

    def do_POST(self):
        if not self.valid_host() or not self.valid_origin():
            self.send_json(403, {"error": "来源不允许。"})
            return
        if self.path != "/judge":
            self.send_json(404, {"error": "未找到接口。"})
            return
        if self.headers.get_content_type() != "application/json":
            self.send_json(415, {"error": "请求必须使用 JSON。"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self.send_json(413, {"error": "请求为空或超过大小限制。"})
            return
        if not REQUEST_LOCK.acquire(blocking=False):
            self.send_json(429, {"error": "评测机正在处理另一份提交，请稍后重试。"})
            return
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("请求格式无效。")
            answer = judge(data.get("problemId"), data.get("language"), data.get("source"))
            self.send_json(200, answer)
        except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            self.send_json(500, {"error": "评测机错误：" + str(exc)[:300]})
        finally:
            REQUEST_LOCK.release()

    def log_message(self, fmt, *args):
        # Log only method, path and status; never include submitted code.
        super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description="Run the local WSL personal-practice judge")
    parser.add_argument("--check", action="store_true", help="verify local dependencies and sandbox")
    args = parser.parse_args()
    try:
        verify_dependencies()
    except Exception as exc:
        print(f"无法启动评测机：{exc}", file=sys.stderr)
        return 1
    if args.check:
        print("WSL 评测机依赖、题库和 bubblewrap 隔离检查通过。")
        return 0
    server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    server.daemon_threads = True
    server.allowed_origins = DEFAULT_ORIGINS
    print("WSL 评测机已启动：http://127.0.0.1:8766（按 Ctrl+C 停止）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
