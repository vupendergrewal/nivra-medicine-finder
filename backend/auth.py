from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from functools import wraps

from flask import g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from config import SECRET_KEY, TOKEN_HOURS


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    return check_password_hash(password_hash, password)


def make_token(user: dict) -> str:
    payload = json.dumps(
        {
            "id": user["id"],
            "role": user["role"],
            "email": user["email"],
            "exp": int(time.time() + TOKEN_HOURS * 3600),
        },
        separators=(",", ":"),
    )
    signature = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    encoded = base64.urlsafe_b64encode(payload.encode()).decode()
    return f"{encoded}.{signature}"


def decode_token(token: str) -> dict | None:
    try:
        encoded, signature = token.split(".", 1)
        payload = base64.urlsafe_b64decode(encoded.encode()).decode()
        expected = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        data = json.loads(payload)
        if data.get("exp", 0) < time.time():
            return None
        return data
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def current_user_from_request(db_get_user) -> dict | None:
    header = request.headers.get("Authorization", "")
    token = header.replace("Bearer ", "").strip() if header.startswith("Bearer ") else ""
    if not token:
        token = request.cookies.get("nivra_token", "")
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    return db_get_user(payload["id"])


def login_required(roles: tuple[str, ...] | None = None):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = getattr(g, "user", None)
            if not user:
                return jsonify({"error": "Sign in required."}), 401
            if roles and user["role"] not in roles:
                return jsonify({"error": "You do not have permission for this action."}), 403
            return view(*args, **kwargs)

        return wrapped

    return decorator
