import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
_db_env = os.environ.get("NIVRA_DATABASE")
DATABASE_PATH = Path(_db_env) if _db_env else BACKEND_DIR / "nivra.db"
SECRET_KEY = os.environ.get("NIVRA_SECRET_KEY", "nivra-classroom-secret-change-me")
TOKEN_HOURS = 72
HOLD_MINUTES = 45
HOST = os.environ.get("NIVRA_HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT") or os.environ.get("NIVRA_PORT", "5000"))
DEBUG = os.environ.get("NIVRA_DEBUG", "0") == "1"
