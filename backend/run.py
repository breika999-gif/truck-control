"""
run.py — TruckAI dev launcher.

Does two things concurrently:
  1. Runs app.py and auto-restarts it if it crashes (exponential back-off, max 30 s).
  2. Keeps the adb reverse tunnel tcp:5050 alive — re-establishes it every 20 s
     so the phone never loses access to Flask even after USB reconnects or sleep.

Usage:
  python backend/run.py
  (run from any directory — paths are resolved relative to this file)

Stop with Ctrl+C.
"""

import os
import subprocess
import sys
import threading
import time

# ── Paths ─────────────────────────────────────────────────────────────────────
HERE   = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "app.py")

# Common adb locations on Windows
_ADB_CANDIDATES = [
    r"C:\Users\breik\AppData\Local\Android\Sdk\platform-tools\adb.exe",
    r"C:\Program Files\Android\platform-tools\adb.exe",
    "adb",  # if it's on PATH
]

def _find_adb() -> str | None:
    for candidate in _ADB_CANDIDATES:
        try:
            r = subprocess.run(
                [candidate, "version"],
                capture_output=True, timeout=3,
            )
            if r.returncode == 0:
                return candidate
        except Exception:
            pass
    return None


# ── adb tunnel keepalive (background thread) ──────────────────────────────────

def _tunnel_loop(adb: str, stop_event: threading.Event) -> None:
    """Re-establish adb reverse tcp:5050 every 20 s."""
    PORTS    = [("tcp:5050", "tcp:5050"), ("tcp:8081", "tcp:8081")]
    INTERVAL = 20

    while not stop_event.wait(INTERVAL):
        try:
            # Only do anything if a device is connected
            r = subprocess.run(
                [adb, "devices"], capture_output=True, text=True, timeout=5
            )
            lines = [l for l in r.stdout.splitlines() if "\tdevice" in l]
            if not lines:
                continue  # no device — skip silently

            for local, remote in PORTS:
                subprocess.run(
                    [adb, "reverse", local, remote],
                    capture_output=True, timeout=5,
                )
            print("[tunnel] adb reverse tcp:5050 + tcp:8081 refreshed", flush=True)
        except Exception as exc:
            print(f"[tunnel] warning: {exc}", flush=True)


# ── Flask auto-restart loop (main thread) ────────────────────────────────────

def _flask_loop() -> None:
    MIN_WAIT = 2
    MAX_WAIT = 30
    wait     = MIN_WAIT

    while True:
        print(f"[flask] Starting …", flush=True)
        start = time.time()

        proc = subprocess.run([sys.executable, SCRIPT])

        uptime = time.time() - start

        if proc.returncode == 0:
            print("[flask] Clean exit.", flush=True)
            return

        if uptime > 60:
            wait = MIN_WAIT
        else:
            wait = min(wait * 2, MAX_WAIT)

        print(
            f"[flask] Crashed (exit {proc.returncode}, uptime {uptime:.0f}s). "
            f"Restarting in {wait}s …",
            flush=True,
        )
        time.sleep(wait)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    adb = _find_adb()
    stop_event = threading.Event()

    if adb:
        print(f"[tunnel] adb found: {adb}", flush=True)
        t = threading.Thread(target=_tunnel_loop, args=(adb, stop_event), daemon=True)
        t.start()
    else:
        print("[tunnel] adb not found — skipping tunnel keepalive", flush=True)

    try:
        _flask_loop()
    except KeyboardInterrupt:
        print("\n[run.py] Stopped by user.", flush=True)
    finally:
        stop_event.set()


if __name__ == "__main__":
    main()
