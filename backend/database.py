from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config import DATABASE_PATH, HOLD_MINUTES
from auth import hash_password

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('customer', 'owner', 'admin')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pharmacies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    license_number TEXT NOT NULL,
    phone TEXT NOT NULL,
    hours TEXT NOT NULL,
    address TEXT NOT NULL,
    pincode TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'rejected')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    strength TEXT NOT NULL,
    form TEXT,
    salt_group TEXT NOT NULL,
    cold_chain INTEGER NOT NULL DEFAULT 0,
    prescription_required INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id),
    packs INTEGER NOT NULL DEFAULT 0,
    price_rupees INTEGER,
    last_verified_at TEXT,
    UNIQUE(pharmacy_id, medicine_id)
);

CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_id INTEGER NOT NULL REFERENCES inventory(id),
    user_id INTEGER REFERENCES users(id),
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'confirmed', 'expired', 'cancelled')),
    created_at TEXT NOT NULL,
    hold_until TEXT
);

CREATE TABLE IF NOT EXISTS urgent_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    medicine TEXT NOT NULL,
    location TEXT NOT NULL,
    radius_km INTEGER NOT NULL,
    pharmacies_notified INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'broadcast',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id),
    actor_name TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, inventory_id)
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    email TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).replace(microsecond=0).isoformat()


def connect(path: Path | None = None) -> sqlite3.Connection:
    connection = sqlite3.connect(path or DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db(connection: sqlite3.Connection | None = None) -> None:
    own = connection is None
    db = connection or connect()
    try:
        db.executescript(SCHEMA)
        columns = {row["name"] for row in db.execute("PRAGMA table_info(pharmacies)").fetchall()}
        if "notes" not in columns:
            db.execute("ALTER TABLE pharmacies ADD COLUMN notes TEXT")
        db.commit()
        if not db.execute("SELECT id FROM users LIMIT 1").fetchone():
            seed(db)
            db.commit()
        else:
            expand_rohtak_catalog(db)
            db.commit()

        # Keep hosted DBs (Render) in sync with the rich Rohtak catalog after code updates.
        medicine_count = db.execute("SELECT COUNT(*) AS c FROM medicines").fetchone()["c"]
        rohtak_count = db.execute(
            "SELECT COUNT(*) AS c FROM pharmacies WHERE pincode LIKE '124%'"
        ).fetchone()["c"]
        if medicine_count < 80 or rohtak_count < 8:
            expand_rohtak_catalog(db)
            db.commit()

        if not db.execute("SELECT id FROM activity_log LIMIT 1").fetchone():
            log_activity(db, None, "system", "network.ready", "system", None, "Nivra network database is ready.")
            db.commit()
    finally:
        if own:
            db.close()


def log_activity(
    db: sqlite3.Connection,
    actor_id: int | None,
    actor_name: str | None,
    action: str,
    entity_type: str | None,
    entity_id: int | None,
    detail: str,
) -> None:
    db.execute(
        """
        INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_id, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (actor_id, actor_name, action, entity_type, entity_id, detail, iso()),
    )


def expire_stale_reservations(db: sqlite3.Connection) -> int:
    rows = db.execute(
        """
        SELECT id, inventory_id FROM reservations
        WHERE status IN ('requested', 'confirmed')
          AND hold_until IS NOT NULL
          AND hold_until < ?
        """,
        (iso(),),
    ).fetchall()
    for row in rows:
        db.execute("UPDATE reservations SET status = 'expired' WHERE id = ?", (row["id"],))
        db.execute("UPDATE inventory SET packs = packs + 1 WHERE id = ?", (row["inventory_id"],))
        log_activity(db, None, "system", "reservation.expired", "reservation", row["id"], f"Hold window ended for reservation #{row['id']}.")
    if rows:
        db.commit()
    return len(rows)


def recent_activity(db: sqlite3.Connection, limit: int = 30) -> list[dict]:
    rows = db.execute(
        "SELECT * FROM activity_log ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(row) for row in rows]


def expand_rohtak_catalog(db: sqlite3.Connection) -> None:
    """Idempotent upgrade for older DBs missing Rohtak shops / rich salt catalog."""
    from seed_catalog import MEDICINES, PHARMACIES, ROHTAK_OWNER_USERS

    now = utcnow()
    for name, email, phone in ROHTAK_OWNER_USERS:
        if get_user_by_email(db, email):
            continue
        db.execute(
            "INSERT INTO users (name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (name, email, phone, hash_password("owner123"), "owner", iso(now)),
        )

    for row in MEDICINES:
        exists = db.execute(
            "SELECT id FROM medicines WHERE lower(name) = ? AND lower(brand) = ? AND lower(strength) = ?",
            (row[0].lower(), row[1].lower(), row[2].lower()),
        ).fetchone()
        if exists:
            continue
        db.execute(
            """
            INSERT INTO medicines
            (name, brand, strength, form, salt_group, cold_chain, prescription_required)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )

    email_to_id = {
        row["email"]: row["id"]
        for row in db.execute("SELECT id, email FROM users").fetchall()
    }
    for owner_email, name, license_number, phone, hours, address, pincode, lat, lng, status in PHARMACIES:
        if not str(pincode).startswith("124"):
            continue
        existing = db.execute(
            "SELECT id FROM pharmacies WHERE lower(name) = ? AND pincode = ?",
            (name.lower(), pincode),
        ).fetchone()
        if existing:
            pharmacy_id = existing["id"]
        else:
            cursor = db.execute(
                """
                INSERT INTO pharmacies
                (owner_id, name, license_number, phone, hours, address, pincode, latitude, longitude, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    email_to_id.get(owner_email),
                    name,
                    license_number,
                    phone,
                    hours,
                    address,
                    pincode,
                    lat,
                    lng,
                    status,
                    iso(now),
                ),
            )
            pharmacy_id = cursor.lastrowid

        meds = db.execute("SELECT id, salt_group, cold_chain FROM medicines").fetchall()
        for index, med in enumerate(meds):
            if index % 3 != (pharmacy_id % 3):
                continue
            has = db.execute(
                "SELECT id FROM inventory WHERE pharmacy_id = ? AND medicine_id = ?",
                (pharmacy_id, med["id"]),
            ).fetchone()
            if has:
                continue
            packs = 3 + ((pharmacy_id + med["id"]) % 20)
            price = 40 + ((med["id"] * 13 + pharmacy_id * 9) % 380)
            if med["salt_group"] == "human_albumin":
                price = 3900 + pharmacy_id * 40
            elif med["cold_chain"]:
                price = 680 + med["id"] * 10
            db.execute(
                """
                INSERT INTO inventory (pharmacy_id, medicine_id, packs, price_rupees, last_verified_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (pharmacy_id, med["id"], packs, price, iso(now - timedelta(minutes=(index % 20) + 1))),
            )


def seed(db: sqlite3.Connection) -> None:
    from seed_catalog import (
        MEDICINES,
        PHARMACIES,
        ROHTAK_OWNER_USERS,
        inventory_rows,
    )

    now = utcnow()
    users = [
        ("Nivra Admin", "admin@nivra.local", "9990000001", hash_password("admin123"), "admin"),
        ("Asha Sharma", "customer@nivra.local", "9990000002", hash_password("customer123"), "customer"),
        ("Rahul Khanna", "owner@nivra.local", "9990000003", hash_password("owner123"), "owner"),
        ("Meera Joshi", "citymed@nivra.local", "9990000004", hash_password("owner123"), "owner"),
        ("Karan Singh", "healthbridge@nivra.local", "9990000005", hash_password("owner123"), "owner"),
        ("Fortis Desk", "fortis@nivra.local", "9990000006", hash_password("owner123"), "owner"),
        ("Priya Nair", "guardian@nivra.local", "9990000007", hash_password("owner123"), "owner"),
        ("Apollo Desk", "apollo@nivra.local", "9990000008", hash_password("owner123"), "owner"),
    ]
    for name, email, phone in ROHTAK_OWNER_USERS:
        users.append((name, email, phone, hash_password("owner123"), "owner"))

    for name, email, phone, password_hash, role in users:
        db.execute(
            "INSERT INTO users (name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (name, email, phone, password_hash, role, iso(now)),
        )

    email_to_id = {
        row["email"]: row["id"]
        for row in db.execute("SELECT id, email FROM users").fetchall()
    }

    for owner_email, name, license_number, phone, hours, address, pincode, lat, lng, status in PHARMACIES:
        db.execute(
            """
            INSERT INTO pharmacies
            (owner_id, name, license_number, phone, hours, address, pincode, latitude, longitude, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                email_to_id[owner_email],
                name,
                license_number,
                phone,
                hours,
                address,
                pincode,
                lat,
                lng,
                status,
                iso(now),
            ),
        )

    for row in MEDICINES:
        db.execute(
            """
            INSERT INTO medicines
            (name, brand, strength, form, salt_group, cold_chain, prescription_required)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )

    pharmacy_count = db.execute("SELECT COUNT(*) AS c FROM pharmacies").fetchone()["c"]
    medicine_count = db.execute("SELECT COUNT(*) AS c FROM medicines").fetchone()["c"]
    for pharmacy_id, medicine_id, packs, price, verified_at in inventory_rows(
        now, pharmacy_count, medicine_count
    ):
        # Prefer catalog cold-chain / albumin pricing
        med = db.execute(
            "SELECT salt_group, cold_chain FROM medicines WHERE id = ?", (medicine_id,)
        ).fetchone()
        if med and med["salt_group"] == "human_albumin":
            price = 3800 + pharmacy_id * 45
        elif med and med["cold_chain"]:
            price = max(price, 600 + medicine_id * 12)
        db.execute(
            """
            INSERT INTO inventory (pharmacy_id, medicine_id, packs, price_rupees, last_verified_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (pharmacy_id, medicine_id, packs, price, iso(verified_at)),
        )

    log_activity(
        db,
        None,
        "system",
        "catalog.seeded",
        "system",
        None,
        f"Seeded {pharmacy_count} pharmacies and {medicine_count} medicine brands with salt alternatives.",
    )


def get_user_by_id(db: sqlite3.Connection, user_id: int) -> dict | None:
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def get_user_by_email(db: sqlite3.Connection, email: str) -> dict | None:
    row = db.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    return dict(row) if row else None


def create_user(db: sqlite3.Connection, name: str, email: str, phone: str, password: str, role: str) -> dict:
    cursor = db.execute(
        "INSERT INTO users (name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (name.strip(), email.lower().strip(), phone, hash_password(password), role, iso()),
    )
    db.commit()
    return get_user_by_id(db, cursor.lastrowid)


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "phone": user["phone"],
        "role": user["role"],
    }


def minutes_ago(value: str | None) -> str:
    if not value:
        return "Pending"
    try:
        verified = datetime.fromisoformat(value)
        if verified.tzinfo is None:
            verified = verified.replace(tzinfo=timezone.utc)
        delta = utcnow() - verified
        minutes = max(0, int(delta.total_seconds() // 60))
        if minutes < 1:
            return "just now"
        if minutes == 1:
            return "1 min ago"
        if minutes < 60:
            return f"{minutes} min ago"
        hours = minutes // 60
        return f"{hours} hr ago" if hours == 1 else f"{hours} hrs ago"
    except ValueError:
        return "Pending"


def stock_label(packs: int) -> str:
    if packs <= 0:
        return "out-of-stock"
    if packs <= 2:
        return "low-stock"
    return "in-stock"


def format_price(price_rupees: int | None) -> str:
    if price_rupees is None:
        return "On request"
    return f"₹{price_rupees:,}".replace(",", ",")


def smart_match(distance: float, packs: int, stock: str, verified: str, pending: bool) -> int:
    verified_minutes = 15
    digits = "".join(ch for ch in verified if ch.isdigit())
    if digits:
        verified_minutes = int(digits)
        if "hr" in verified:
            verified_minutes *= 60
    availability_bonus = 9 if stock == "in-stock" else 2
    score = (
        100
        - distance * 3.2
        - verified_minutes * 0.55
        + min(packs, 10) * 0.55
        + availability_bonus
        - (12 if pending else 0)
    )
    return max(72, min(99, round(score)))


def serialize_listing(row: sqlite3.Row | dict, origin: tuple[float, float]) -> dict:
    item = dict(row)
    lat = item.get("latitude")
    lng = item.get("longitude")
    if lat is None or lng is None:
        distance = 2.5
    else:
        from geo import haversine_km

        distance = haversine_km(origin[0], origin[1], lat, lng)
    packs = item["packs"]
    stock = stock_label(packs)
    pending = item["pharmacy_status"] != "verified"
    verified = "Pending" if pending else minutes_ago(item.get("last_verified_at"))
    price = format_price(item.get("price_rupees"))
    return {
        "id": item["inventory_id"],
        "pharmacyId": item["pharmacy_id"],
        "pharmacy": item["pharmacy_name"],
        "area": f"{item['address']}, {item['pincode']}",
        "distance": distance,
        "medicine": item["medicine_name"],
        "brand": item["brand"],
        "strength": item["strength"],
        "stock": stock,
        "packs": packs,
        "verified": verified,
        "coldChain": bool(item["cold_chain"]),
        "prescription": bool(item["prescription_required"]),
        "price": price,
        "ownerListed": pending,
        "hours": item["hours"],
        "phone": item.get("pharmacy_phone"),
        "match": smart_match(distance, packs, stock, verified, pending),
        "coordinates": {
            "latitude": lat,
            "longitude": lng,
        },
    }


LISTING_SELECT = """
SELECT
    inventory.id AS inventory_id,
    inventory.pharmacy_id,
    inventory.packs,
    inventory.price_rupees,
    inventory.last_verified_at,
    pharmacies.name AS pharmacy_name,
    pharmacies.address,
    pharmacies.pincode,
    pharmacies.latitude,
    pharmacies.longitude,
    pharmacies.status AS pharmacy_status,
    pharmacies.hours,
    pharmacies.phone AS pharmacy_phone,
    medicines.id AS medicine_id,
    medicines.name AS medicine_name,
    medicines.brand,
    medicines.strength,
    medicines.salt_group,
    medicines.cold_chain,
    medicines.prescription_required
FROM inventory
JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
JOIN medicines ON medicines.id = inventory.medicine_id
"""


def search_listings(
    db: sqlite3.Connection,
    query: str = "",
    location: str = "",
    stock_filter: str = "all",
    include_pending: bool = True,
    max_distance_km: float | None = None,
) -> list[dict]:
    from geo import coords_from_location

    origin = coords_from_location(location)
    sql = LISTING_SELECT + " WHERE inventory.packs > 0"
    params: list = []
    if not include_pending:
        sql += " AND pharmacies.status = 'verified'"
    else:
        sql += " AND pharmacies.status != 'rejected'"

    rows = [dict(row) for row in db.execute(sql, params).fetchall()]
    needle = query.strip().lower()
    results = []
    for row in rows:
        blob = " ".join(
            [
                row["medicine_name"],
                row["brand"],
                row["strength"],
                row["pharmacy_name"],
                row["salt_group"].replace("_", " "),
            ]
        ).lower()
        if needle and needle not in blob:
            continue
        item = serialize_listing(row, origin)
        if stock_filter == "cold-chain" and not item["coldChain"]:
            continue
        if stock_filter in {"in-stock", "low-stock"} and item["stock"] != stock_filter:
            continue
        if max_distance_km is not None and item["distance"] > max_distance_km:
            continue
        results.append(item)
    results.sort(key=lambda item: (-item["match"], item["distance"]))
    return results[:60]


def map_markers(
    db: sqlite3.Connection,
    query: str = "",
    location: str = "",
    stock_filter: str = "all",
    radius_km: float = 25,
) -> dict:
    from geo import bounding_box, geocode

    origin_info = geocode(location or "Chandigarh 160017")
    origin = (origin_info["latitude"], origin_info["longitude"])
    listings = search_listings(
        db,
        query=query,
        location=location,
        stock_filter=stock_filter,
        include_pending=True,
        max_distance_km=radius_km,
    )

    # One marker per pharmacy, keeping the best match medicine.
    by_pharmacy: dict[int, dict] = {}
    for item in listings:
        pharmacy_id = item["pharmacyId"]
        coords = item.get("coordinates") or {}
        if coords.get("latitude") is None or coords.get("longitude") is None:
            continue
        existing = by_pharmacy.get(pharmacy_id)
        if not existing or item["match"] > existing["match"]:
            by_pharmacy[pharmacy_id] = {
                "pharmacyId": pharmacy_id,
                "inventoryId": item["id"],
                "name": item["pharmacy"],
                "area": item["area"],
                "distance": item["distance"],
                "medicine": item["medicine"],
                "brand": item["brand"],
                "strength": item["strength"],
                "stock": item["stock"],
                "packs": item["packs"],
                "price": item["price"],
                "coldChain": item["coldChain"],
                "ownerListed": item["ownerListed"],
                "match": item["match"],
                "latitude": coords["latitude"],
                "longitude": coords["longitude"],
                "hours": item.get("hours"),
            }

    markers = sorted(by_pharmacy.values(), key=lambda item: item["distance"])
    return {
        "origin": origin_info,
        "radiusKm": radius_km,
        "bounds": bounding_box(origin[0], origin[1], radius_km),
        "count": len(markers),
        "markers": markers,
        "listings": listings,
    }


def get_listing(db: sqlite3.Connection, inventory_id: int, location: str = "") -> dict | None:
    from geo import coords_from_location

    row = db.execute(LISTING_SELECT + " WHERE inventory.id = ?", (inventory_id,)).fetchone()
    if not row:
        return None
    return serialize_listing(row, coords_from_location(location))


def network_stats(db: sqlite3.Connection) -> dict:
    expire_stale_reservations(db)
    pharmacies = db.execute(
        "SELECT COUNT(*) AS total FROM pharmacies WHERE status = 'verified'"
    ).fetchone()["total"]
    verified_today = db.execute(
        """
        SELECT COUNT(*) AS total FROM inventory
        JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
        WHERE pharmacies.status = 'verified'
          AND inventory.last_verified_at >= datetime('now', '-1 day')
        """
    ).fetchone()["total"]
    pending = db.execute(
        "SELECT COUNT(*) AS total FROM pharmacies WHERE status = 'pending'"
    ).fetchone()["total"]
    urgent_open = db.execute(
        "SELECT COUNT(*) AS total FROM urgent_requests WHERE status = 'broadcast'"
    ).fetchone()["total"]
    inventory_skus = db.execute(
        "SELECT COUNT(*) AS total FROM inventory WHERE packs > 0"
    ).fetchone()["total"]
    return {
        "pharmaciesOnline": pharmacies,
        "stockVerifiedToday": min(99, max(1, verified_today * 8 + 40)),
        "pendingListings": pending,
        "reservationsOpen": db.execute(
            "SELECT COUNT(*) AS total FROM reservations WHERE status IN ('requested', 'confirmed')"
        ).fetchone()["total"],
        "urgentOpen": urgent_open,
        "inventorySkus": inventory_skus,
        "usersTotal": db.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"],
    }


def pharmacy_detail(db: sqlite3.Connection, pharmacy_id: int) -> dict | None:
    row = db.execute("SELECT * FROM pharmacies WHERE id = ?", (pharmacy_id,)).fetchone()
    if not row:
        return None
    inventory = db.execute(
        LISTING_SELECT + " WHERE pharmacies.id = ?",
        (pharmacy_id,),
    ).fetchall()
    origin = (row["latitude"] or 30.7333, row["longitude"] or 76.7794)
    return {
        "pharmacy": dict(row),
        "inventory": [serialize_listing(item, origin) for item in inventory],
    }


def alternatives_for_query(db: sqlite3.Connection, query: str) -> list[dict]:
    needle = (query or "").strip().lower()
    if not needle:
        return []
    medicine = db.execute(
        """
        SELECT * FROM medicines
        WHERE lower(name) LIKE ? OR lower(brand) LIKE ? OR lower(salt_group) LIKE ?
           OR replace(lower(salt_group), '_', ' ') LIKE ?
        ORDER BY
            CASE
                WHEN lower(brand) = ? THEN 0
                WHEN lower(name) = ? THEN 1
                WHEN lower(brand) LIKE ? THEN 2
                ELSE 3
            END,
            name
        LIMIT 1
        """,
        (
            f"%{needle}%",
            f"%{needle}%",
            f"%{needle.replace(' ', '_')}%",
            f"%{needle}%",
            needle,
            needle,
            f"%{needle}%",
        ),
    ).fetchone()
    if not medicine:
        return []
    options = alternatives(db, medicine["salt_group"], medicine["id"])
    salt_label = medicine["salt_group"].replace("_", " ").title()
    enriched = []
    for option in options:
        stocked = db.execute(
            """
            SELECT COUNT(DISTINCT inventory.pharmacy_id) AS shops
            FROM inventory
            JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
            WHERE inventory.medicine_id = ?
              AND inventory.packs > 0
              AND pharmacies.status = 'verified'
            """,
            (option["id"],),
        ).fetchone()["shops"]
        enriched.append({**option, "shopsWithStock": stocked, "saltLabel": salt_label})
    return [
        {
            "prescribed": {
                "id": medicine["id"],
                "name": medicine["name"],
                "brand": medicine["brand"],
                "strength": medicine["strength"],
                "saltGroup": medicine["salt_group"],
                "saltLabel": salt_label,
            },
            "alternatives": enriched,
        }
    ]


def find_or_create_medicine(
    db: sqlite3.Connection,
    name: str,
    brand: str,
    strength: str,
    cold_chain: bool,
    prescription: bool,
) -> int:
    existing = db.execute(
        "SELECT id FROM medicines WHERE lower(name) = ? AND lower(brand) = ? AND lower(strength) = ?",
        (name.lower(), brand.lower(), strength.lower()),
    ).fetchone()
    if existing:
        return existing["id"]
    salt_group = name.lower().replace(" ", "_")
    cursor = db.execute(
        """
        INSERT INTO medicines (name, brand, strength, form, salt_group, cold_chain, prescription_required)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (name, brand, strength, "pack", salt_group, 1 if cold_chain else 0, 1 if prescription else 0),
    )
    return cursor.lastrowid


def alternatives(db: sqlite3.Connection, salt_group: str, exclude_id: int | None = None) -> list[dict]:
    sql = "SELECT * FROM medicines WHERE salt_group = ?"
    params: list = [salt_group]
    if exclude_id:
        sql += " AND id != ?"
        params.append(exclude_id)
    rows = db.execute(sql, params).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "brand": row["brand"],
            "strength": row["strength"],
            "coldChain": bool(row["cold_chain"]),
            "prescription": bool(row["prescription_required"]),
        }
        for row in rows
    ]


def hold_until_iso() -> str:
    return iso(utcnow() + timedelta(minutes=HOLD_MINUTES))
