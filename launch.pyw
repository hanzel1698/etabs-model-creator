# Windowless launcher: starts the ETABS bridge and the Vite app hidden, logging to logs\. Run with pythonw.
import subprocess
import sys
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:15173/"
NO_WINDOW = subprocess.CREATE_NO_WINDOW

try:  # already running: just open it, don't start a second Vite on another port
    urllib.request.urlopen(URL, timeout=1)
    webbrowser.open(URL)
    sys.exit()
except OSError:
    pass

logs = ROOT / "logs"
logs.mkdir(exist_ok=True)
python = Path(sys.executable).with_name("python.exe")  # bridge prints; give it a real interpreter, still windowless
subprocess.Popen([str(python), "-u", "bridge.py"], cwd=ROOT / "bridge", creationflags=NO_WINDOW,
                 stdout=open(logs / "bridge.log", "w"), stderr=subprocess.STDOUT)
subprocess.Popen("npm run dev -- --open", shell=True, cwd=ROOT / "web", creationflags=NO_WINDOW,
                 stdout=open(logs / "vite.log", "w"), stderr=subprocess.STDOUT)
