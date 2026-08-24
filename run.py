from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parent / "backend"
sys.path.insert(0, str(BACKEND))

from app import app  # noqa: E402
from config import DEBUG, HOST, PORT  # noqa: E402


if __name__ == "__main__":
    print(f"Nivra backend running at http://127.0.0.1:{PORT}")
    # Debug reloader causes double processes and flaky restarts on Windows.
    app.run(host=HOST, port=PORT, debug=DEBUG, use_reloader=False)
