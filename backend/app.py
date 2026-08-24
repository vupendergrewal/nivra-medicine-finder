from __future__ import annotations

import re
import sqlite3

from flask import Flask, g, jsonify, request, send_from_directory

import auth as auth_lib
import database as dbmod
from config import DEBUG, HOLD_MINUTES, HOST, PORT, ROOT, SECRET_KEY
from geo import coords_from_location, geocode, haversine_km, parse_radius_km

PHONE_RE = re.compile(r"^\d{10}$")
PIN_RE = re.compile(r"^\d{6}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def json_error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def body() -> dict:
    data = request.get_json(silent=True)
    if isinstance(data, dict):
        return data
    return request.form.to_dict()


def clean_phone(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
    app.config["SECRET_KEY"] = SECRET_KEY
    app.json.sort_keys = False
    dbmod.init_db()

    @app.before_request
    def load_user():
        g.db = dbmod.connect()
        g.user = auth_lib.current_user_from_request(lambda user_id: dbmod.get_user_by_id(g.db, user_id))
        if request.path.startswith("/api/") and request.method in {"GET", "POST", "PATCH"}:
            dbmod.expire_stale_reservations(g.db)

    @app.teardown_request
    def close_db(_exc):
        connection = getattr(g, "db", None)
        if connection is not None:
            connection.close()

    @app.get("/")
    def home():
        return send_from_directory(ROOT, "index.html")

    @app.get("/admin")
    def admin_page():
        return send_from_directory(ROOT, "admin.html")

    @app.get("/owner")
    def owner_page():
        return send_from_directory(ROOT, "owner.html")

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "service": "nivra-backend"})

    @app.get("/api/stats")
    def stats():
        return jsonify(dbmod.network_stats(g.db))

    @app.post("/api/auth/register")
    def register():
        data = body()
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        phone = clean_phone(data.get("phone") or "")
        password = data.get("password") or ""
        role = (data.get("role") or "customer").strip().lower()
        if role not in {"customer", "owner"}:
            return json_error("Role must be customer or owner.")
        if not name or not EMAIL_RE.match(email) or len(password) < 6:
            return json_error("Enter a name, valid email, and a password of at least 6 characters.")
        if phone and not PHONE_RE.match(phone):
            return json_error("Enter a valid 10-digit phone number.")
        if dbmod.get_user_by_email(g.db, email):
            return json_error("An account with this email already exists.", 409)
        user = dbmod.create_user(g.db, name, email, phone, password, role)
        dbmod.log_activity(
            g.db,
            user["id"],
            user["name"],
            "auth.register",
            "user",
            user["id"],
            f"{user['name']} registered as {role}.",
        )
        g.db.commit()
        token = auth_lib.make_token(user)
        return jsonify({"token": token, "user": dbmod.public_user(user)}), 201

    @app.post("/api/auth/login")
    def login():
        data = body()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        user = dbmod.get_user_by_email(g.db, email)
        if not user or not auth_lib.verify_password(user["password_hash"], password):
            return json_error("Invalid email or password.", 401)
        token = auth_lib.make_token(user)
        return jsonify({"token": token, "user": dbmod.public_user(user)})

    @app.get("/api/auth/me")
    @auth_lib.login_required()
    def me():
        return jsonify({"user": dbmod.public_user(g.user)})

    @app.get("/api/search")
    def search():
        query = request.args.get("q") or request.args.get("medicine") or ""
        location = request.args.get("location") or ""
        stock_filter = request.args.get("filter") or "all"
        include_pending = request.args.get("pending", "1") != "0"
        radius = request.args.get("radius")
        max_distance = float(parse_radius_km(radius)) if radius else None
        origin = geocode(location or "Chandigarh 160017")
        results = dbmod.search_listings(
            g.db,
            query,
            location,
            stock_filter,
            include_pending,
            max_distance_km=max_distance,
        )
        salt_guide = dbmod.alternatives_for_query(g.db, query) if query else []
        return jsonify(
            {
                "query": query,
                "location": location or "Chandigarh",
                "origin": origin,
                "count": len(results),
                "results": results,
                "saltGuide": salt_guide[0] if salt_guide else None,
            }
        )

    @app.get("/api/activity")
    def public_activity():
        return jsonify({"activity": dbmod.recent_activity(g.db, 12)})

    @app.get("/api/geocode")
    def geocode_lookup():
        location = request.args.get("location") or request.args.get("q") or ""
        return jsonify(geocode(location or "Chandigarh 160017"))

    @app.get("/api/map")
    def map_data():
        query = request.args.get("q") or request.args.get("medicine") or ""
        location = request.args.get("location") or "Chandigarh 160017"
        stock_filter = request.args.get("filter") or "all"
        radius_km = parse_radius_km(request.args.get("radius") or 25)
        payload = dbmod.map_markers(g.db, query, location, stock_filter, radius_km)
        return jsonify(payload)

    @app.get("/api/medicines")
    def medicines():
        rows = g.db.execute("SELECT * FROM medicines ORDER BY name, brand").fetchall()
        return jsonify(
            [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "brand": row["brand"],
                    "strength": row["strength"],
                    "saltGroup": row["salt_group"],
                    "coldChain": bool(row["cold_chain"]),
                    "prescription": bool(row["prescription_required"]),
                }
                for row in rows
            ]
        )

    @app.get("/api/medicines/<int:medicine_id>/alternatives")
    def medicine_alternatives(medicine_id: int):
        medicine = g.db.execute("SELECT * FROM medicines WHERE id = ?", (medicine_id,)).fetchone()
        if not medicine:
            return json_error("Medicine not found.", 404)
        options = dbmod.alternatives(g.db, medicine["salt_group"], medicine_id)
        return jsonify(
            {
                "prescribed": {
                    "id": medicine["id"],
                    "name": medicine["name"],
                    "brand": medicine["brand"],
                    "strength": medicine["strength"],
                },
                "alternatives": options,
            }
        )

    @app.post("/api/reservations")
    def create_reservation():
        data = body()
        inventory_id = data.get("inventoryId") or data.get("id")
        name = (data.get("name") or "").strip()
        phone = clean_phone(data.get("phone") or "")
        consent = data.get("consent") in {True, "true", "1", "on"}
        if not inventory_id:
            return json_error("Choose a medicine listing to reserve.")
        if not name or not PHONE_RE.match(phone) or not consent:
            return json_error("Enter your name, a 10-digit number, and confirm the safety note.")

        listing = g.db.execute(
            dbmod.LISTING_SELECT + " WHERE inventory.id = ?",
            (inventory_id,),
        ).fetchone()
        if not listing:
            return json_error("That listing is no longer available.", 404)
        if listing["packs"] <= 0:
            return json_error("This pack is out of stock.", 409)
        if listing["pharmacy_status"] != "verified":
            return json_error("This pharmacy is still pending verification. Reservation is not open yet.", 409)

        hold_until = dbmod.hold_until_iso()
        cursor = g.db.execute(
            """
            INSERT INTO reservations (inventory_id, user_id, customer_name, phone, status, created_at, hold_until)
            VALUES (?, ?, ?, ?, 'requested', ?, ?)
            """,
            (inventory_id, g.user["id"] if g.user else None, name, phone, dbmod.iso(), hold_until),
        )
        g.db.execute(
            "UPDATE inventory SET packs = packs - 1, last_verified_at = ? WHERE id = ?",
            (dbmod.iso(), inventory_id),
        )
        dbmod.log_activity(
            g.db,
            g.user["id"] if g.user else None,
            name,
            "reservation.requested",
            "reservation",
            cursor.lastrowid,
            f"{name} requested {listing['brand']} at {listing['pharmacy_name']}.",
        )
        g.db.commit()
        item = dbmod.get_listing(g.db, int(inventory_id), data.get("location") or "")
        return (
            jsonify(
                {
                    "id": cursor.lastrowid,
                    "status": "requested",
                    "holdMinutes": HOLD_MINUTES,
                    "holdUntil": hold_until,
                    "message": f"{listing['pharmacy_name']} will confirm {listing['brand']} before the {HOLD_MINUTES}-minute hold begins.",
                    "listing": item,
                }
            ),
            201,
        )

    @app.get("/api/reservations")
    @auth_lib.login_required()
    def list_reservations():
        if g.user["role"] == "admin":
            rows = g.db.execute(
                """
                SELECT reservations.*, pharmacies.name AS pharmacy_name, medicines.brand, medicines.name AS medicine_name
                FROM reservations
                JOIN inventory ON inventory.id = reservations.inventory_id
                JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
                JOIN medicines ON medicines.id = inventory.medicine_id
                ORDER BY reservations.id DESC
                """
            ).fetchall()
        elif g.user["role"] == "owner":
            rows = g.db.execute(
                """
                SELECT reservations.*, pharmacies.name AS pharmacy_name, medicines.brand, medicines.name AS medicine_name
                FROM reservations
                JOIN inventory ON inventory.id = reservations.inventory_id
                JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
                JOIN medicines ON medicines.id = inventory.medicine_id
                WHERE pharmacies.owner_id = ?
                ORDER BY reservations.id DESC
                """,
                (g.user["id"],),
            ).fetchall()
        else:
            rows = g.db.execute(
                """
                SELECT reservations.*, pharmacies.name AS pharmacy_name, medicines.brand, medicines.name AS medicine_name
                FROM reservations
                JOIN inventory ON inventory.id = reservations.inventory_id
                JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
                JOIN medicines ON medicines.id = inventory.medicine_id
                WHERE reservations.user_id = ? OR reservations.phone = ?
                ORDER BY reservations.id DESC
                """,
                (g.user["id"], g.user.get("phone") or ""),
            ).fetchall()
        return jsonify([dict(row) for row in rows])

    @app.post("/api/reservations/<int:reservation_id>/confirm")
    @auth_lib.login_required(("owner", "admin"))
    def confirm_reservation(reservation_id: int):
        reservation = g.db.execute("SELECT * FROM reservations WHERE id = ?", (reservation_id,)).fetchone()
        if not reservation:
            return json_error("Reservation not found.", 404)
        if g.user["role"] == "owner":
            owned = g.db.execute(
                """
                SELECT pharmacies.id FROM reservations
                JOIN inventory ON inventory.id = reservations.inventory_id
                JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
                WHERE reservations.id = ? AND pharmacies.owner_id = ?
                """,
                (reservation_id, g.user["id"]),
            ).fetchone()
            if not owned:
                return json_error("This reservation belongs to another pharmacy.", 403)
        g.db.execute(
            "UPDATE reservations SET status = 'confirmed' WHERE id = ?",
            (reservation_id,),
        )
        dbmod.log_activity(
            g.db,
            g.user["id"],
            g.user["name"],
            "reservation.confirmed",
            "reservation",
            reservation_id,
            f"{g.user['name']} confirmed reservation #{reservation_id}.",
        )
        g.db.commit()
        return jsonify({"id": reservation_id, "status": "confirmed"})

    @app.post("/api/reservations/<int:reservation_id>/cancel")
    def cancel_reservation(reservation_id: int):
        reservation = g.db.execute("SELECT * FROM reservations WHERE id = ?", (reservation_id,)).fetchone()
        if not reservation:
            return json_error("Reservation not found.", 404)
        if reservation["status"] in {"cancelled", "expired"}:
            return json_error("This reservation is already closed.", 409)

        if g.user:
            if g.user["role"] == "customer":
                if reservation["user_id"] not in {None, g.user["id"]} and reservation["phone"] != (g.user.get("phone") or ""):
                    return json_error("You can only cancel your own reservation.", 403)
            elif g.user["role"] == "owner":
                owned = g.db.execute(
                    """
                    SELECT pharmacies.id FROM reservations
                    JOIN inventory ON inventory.id = reservations.inventory_id
                    JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
                    WHERE reservations.id = ? AND pharmacies.owner_id = ?
                    """,
                    (reservation_id, g.user["id"]),
                ).fetchone()
                if not owned:
                    return json_error("This reservation belongs to another pharmacy.", 403)
            elif g.user["role"] != "admin":
                return json_error("You do not have permission for this action.", 403)
        else:
            return json_error("Sign in required to cancel a reservation.", 401)

        g.db.execute(
            "UPDATE reservations SET status = 'cancelled' WHERE id = ?",
            (reservation_id,),
        )
        g.db.execute(
            "UPDATE inventory SET packs = packs + 1 WHERE id = ?",
            (reservation["inventory_id"],),
        )
        dbmod.log_activity(
            g.db,
            g.user["id"] if g.user else None,
            g.user["name"] if g.user else "guest",
            "reservation.cancelled",
            "reservation",
            reservation_id,
            f"Reservation #{reservation_id} was cancelled and stock restored.",
        )
        g.db.commit()
        return jsonify({"id": reservation_id, "status": "cancelled"})

    @app.patch("/api/owner/inventory/<int:inventory_id>")
    @auth_lib.login_required(("owner", "admin"))
    def update_inventory(inventory_id: int):
        data = body()
        row = g.db.execute(
            """
            SELECT inventory.*, pharmacies.owner_id
            FROM inventory
            JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
            WHERE inventory.id = ?
            """,
            (inventory_id,),
        ).fetchone()
        if not row:
            return json_error("Inventory item not found.", 404)
        if g.user["role"] == "owner" and row["owner_id"] != g.user["id"]:
            return json_error("You can only update your own pharmacy stock.", 403)

        packs = data.get("packs")
        price = data.get("price")
        if packs is not None:
            packs = int(packs)
            if packs < 0:
                return json_error("Packs cannot be negative.")
            g.db.execute("UPDATE inventory SET packs = ? WHERE id = ?", (packs, inventory_id))
        if price is not None and str(price).strip() != "":
            price_rupees = int(price)
            g.db.execute("UPDATE inventory SET price_rupees = ? WHERE id = ?", (price_rupees, inventory_id))
        if data.get("verify"):
            g.db.execute(
                "UPDATE inventory SET last_verified_at = ? WHERE id = ?",
                (dbmod.iso(), inventory_id),
            )
        g.db.commit()
        item = dbmod.get_listing(g.db, inventory_id)
        return jsonify({"ok": True, "listing": item})

    @app.get("/api/pharmacies")
    def list_pharmacies():
        location = request.args.get("location") or "Chandigarh 160017"
        origin = geocode(location)
        rows = g.db.execute(
            "SELECT * FROM pharmacies WHERE status != 'rejected' ORDER BY name"
        ).fetchall()
        pharmacies = []
        for row in rows:
            distance = None
            if row["latitude"] is not None and row["longitude"] is not None:
                distance = haversine_km(
                    origin["latitude"],
                    origin["longitude"],
                    row["latitude"],
                    row["longitude"],
                )
            pharmacies.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "address": row["address"],
                    "pincode": row["pincode"],
                    "phone": row["phone"],
                    "hours": row["hours"],
                    "status": row["status"],
                    "distance": distance,
                    "coordinates": {
                        "latitude": row["latitude"],
                        "longitude": row["longitude"],
                    },
                }
            )
        pharmacies.sort(key=lambda item: item["distance"] if item["distance"] is not None else 999)
        return jsonify({"origin": origin, "count": len(pharmacies), "pharmacies": pharmacies})

    @app.post("/api/urgent")
    def create_urgent():
        data = body()
        medicine = (data.get("medicine") or "").strip()
        location = (data.get("location") or "").strip()
        radius_km = parse_radius_km(data.get("radius"))
        if not medicine or not location:
            return json_error("Add both medicine details and your search area.")
        origin = coords_from_location(location)
        pharmacies = g.db.execute(
            "SELECT * FROM pharmacies WHERE status = 'verified' AND latitude IS NOT NULL"
        ).fetchall()
        notified = []
        for pharmacy in pharmacies:
            distance = haversine_km(origin[0], origin[1], pharmacy["latitude"], pharmacy["longitude"])
            if distance <= radius_km:
                notified.append(
                    {
                        "id": pharmacy["id"],
                        "name": pharmacy["name"],
                        "distance": distance,
                        "area": f"{pharmacy['address']}, {pharmacy['pincode']}",
                    }
                )
        notified.sort(key=lambda item: item["distance"])
        cursor = g.db.execute(
            """
            INSERT INTO urgent_requests
            (user_id, medicine, location, radius_km, pharmacies_notified, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'broadcast', ?)
            """,
            (
                g.user["id"] if g.user else None,
                medicine,
                location,
                radius_km,
                len(notified),
                dbmod.iso(),
            ),
        )
        dbmod.log_activity(
            g.db,
            g.user["id"] if g.user else None,
            g.user["name"] if g.user else "guest",
            "urgent.broadcast",
            "urgent",
            cursor.lastrowid,
            f"Urgent request for {medicine} reached {len(notified)} pharmacies near {location}.",
        )
        g.db.commit()
        return (
            jsonify(
                {
                    "id": cursor.lastrowid,
                    "status": "broadcast",
                    "medicine": medicine,
                    "location": location,
                    "radiusKm": radius_km,
                    "pharmaciesNotified": len(notified),
                    "pharmacies": notified[:8],
                    "message": f"Request prepared for {len(notified)} verified pharmacies within {radius_km} km of {location}.",
                }
            ),
            201,
        )

    @app.post("/api/urgent/<int:request_id>/resolve")
    @auth_lib.login_required(("owner", "admin"))
    def resolve_urgent(request_id: int):
        row = g.db.execute("SELECT * FROM urgent_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            return json_error("Urgent request not found.", 404)
        data = body()
        note = (data.get("note") or "Marked as resolved.").strip()
        g.db.execute("UPDATE urgent_requests SET status = 'resolved' WHERE id = ?", (request_id,))
        dbmod.log_activity(
            g.db,
            g.user["id"],
            g.user["name"],
            "urgent.resolved",
            "urgent",
            request_id,
            f"{g.user['name']} resolved urgent request for {row['medicine']}: {note}",
        )
        g.db.commit()
        return jsonify({"id": request_id, "status": "resolved", "note": note})

    @app.get("/api/urgent")
    @auth_lib.login_required(("owner", "admin"))
    def list_urgent():
        rows = g.db.execute("SELECT * FROM urgent_requests ORDER BY id DESC").fetchall()
        return jsonify([dict(row) for row in rows])

    @app.post("/api/pharmacies/listings")
    def publish_listing():
        data = body()
        name = (data.get("pharmacy") or data.get("name") or "").strip()
        license_number = (data.get("license") or "").strip()
        phone = clean_phone(data.get("phone") or "")
        hours = (data.get("hours") or "9:00 AM – 9:00 PM").strip()
        address = (data.get("address") or "").strip()
        pincode = re.sub(r"\D", "", data.get("pincode") or "")
        products = data.get("products") or []
        latitude = data.get("latitude")
        longitude = data.get("longitude")

        if not name or not license_number or not address:
            return json_error("Pharmacy name, licence number, and address are required.")
        if not PHONE_RE.match(phone) or not PIN_RE.match(pincode):
            return json_error("Enter a valid 10-digit contact number and 6-digit PIN code.")
        if not isinstance(products, list) or not products:
            return json_error("Add at least one medicine before publishing.")

        owner_id = g.user["id"] if g.user and g.user["role"] in {"owner", "admin"} else None
        if owner_id is None and g.user and g.user["role"] == "customer":
            return json_error("Customer accounts cannot publish pharmacy listings. Register as an owner.", 403)

        if latitude is None or longitude is None:
            latitude, longitude = coords_from_location(pincode)

        cursor = g.db.execute(
            """
            INSERT INTO pharmacies
            (owner_id, name, license_number, phone, hours, address, pincode, latitude, longitude, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (owner_id, name, license_number, phone, hours, address, pincode, latitude, longitude, dbmod.iso()),
        )
        pharmacy_id = cursor.lastrowid
        created = []
        for product in products:
            medicine_name = (product.get("medicine") or "").strip()
            brand = (product.get("brand") or "").strip()
            strength = (product.get("strength") or "").strip()
            packs = int(product.get("packs") or 0)
            price = product.get("price")
            price_rupees = int(price) if str(price).isdigit() else None
            if not medicine_name or not brand or not strength or packs < 0:
                continue
            medicine_id = dbmod.find_or_create_medicine(
                g.db,
                medicine_name,
                brand,
                strength,
                bool(product.get("coldChain")),
                bool(product.get("prescription", True)),
            )
            g.db.execute(
                """
                INSERT INTO inventory (pharmacy_id, medicine_id, packs, price_rupees, last_verified_at)
                VALUES (?, ?, ?, ?, NULL)
                """,
                (pharmacy_id, medicine_id, packs, price_rupees),
            )
            created.append(medicine_name)
        if not created:
            g.db.rollback()
            return json_error("Add at least one complete medicine before publishing.")
        dbmod.log_activity(
            g.db,
            owner_id,
            name,
            "pharmacy.listed",
            "pharmacy",
            pharmacy_id,
            f"{name} published {len(created)} products and awaits verification.",
        )
        g.db.commit()
        listings = dbmod.search_listings(g.db, created[0], pincode, "all", True)
        own_listings = [item for item in listings if item["pharmacyId"] == pharmacy_id]
        return (
            jsonify(
                {
                    "pharmacyId": pharmacy_id,
                    "status": "pending",
                    "productsPublished": len(created),
                    "message": f"{len(created)} product{'s' if len(created) != 1 else ''} published as pending verification.",
                    "listings": own_listings,
                }
            ),
            201,
        )

    @app.get("/api/owner/pharmacy")
    @auth_lib.login_required(("owner", "admin"))
    def owner_pharmacy():
        if g.user["role"] == "admin":
            pharmacy_id = request.args.get("id")
            if pharmacy_id:
                detail = dbmod.pharmacy_detail(g.db, int(pharmacy_id))
                return jsonify(detail or {"pharmacy": None, "inventory": []})
        row = g.db.execute(
            "SELECT * FROM pharmacies WHERE owner_id = ? ORDER BY id DESC LIMIT 1",
            (g.user["id"],),
        ).fetchone()
        if not row:
            return jsonify({"pharmacy": None, "inventory": [], "reservations": [], "urgent": []})
        inventory = g.db.execute(
            dbmod.LISTING_SELECT + " WHERE pharmacies.id = ?",
            (row["id"],),
        ).fetchall()
        origin = (row["latitude"] or 30.7333, row["longitude"] or 76.7794)
        reservations = g.db.execute(
            """
            SELECT reservations.*, medicines.brand, medicines.name AS medicine_name
            FROM reservations
            JOIN inventory ON inventory.id = reservations.inventory_id
            JOIN medicines ON medicines.id = inventory.medicine_id
            WHERE inventory.pharmacy_id = ?
            ORDER BY reservations.id DESC LIMIT 20
            """,
            (row["id"],),
        ).fetchall()
        urgent = g.db.execute(
            "SELECT * FROM urgent_requests WHERE status = 'broadcast' ORDER BY id DESC LIMIT 10"
        ).fetchall()
        return jsonify(
            {
                "pharmacy": dict(row),
                "inventory": [dbmod.serialize_listing(item, origin) for item in inventory],
                "reservations": [dict(item) for item in reservations],
                "urgent": [dict(item) for item in urgent],
            }
        )

    @app.get("/api/admin/overview")
    @auth_lib.login_required(("admin",))
    def admin_overview():
        pharmacies = g.db.execute("SELECT * FROM pharmacies ORDER BY id DESC").fetchall()
        reservations = g.db.execute(
            """
            SELECT reservations.*, pharmacies.name AS pharmacy_name, medicines.brand,
                   medicines.name AS medicine_name, medicines.strength
            FROM reservations
            JOIN inventory ON inventory.id = reservations.inventory_id
            JOIN pharmacies ON pharmacies.id = inventory.pharmacy_id
            JOIN medicines ON medicines.id = inventory.medicine_id
            ORDER BY reservations.id DESC LIMIT 50
            """
        ).fetchall()
        urgent = g.db.execute("SELECT * FROM urgent_requests ORDER BY id DESC LIMIT 50").fetchall()
        users = g.db.execute(
            "SELECT id, name, email, phone, role, created_at FROM users ORDER BY id"
        ).fetchall()
        feedback = g.db.execute("SELECT * FROM feedback ORDER BY id DESC LIMIT 30").fetchall()
        low_stock = g.db.execute(
            dbmod.LISTING_SELECT
            + " WHERE inventory.packs > 0 AND inventory.packs <= 2 AND pharmacies.status = 'verified' ORDER BY inventory.packs ASC LIMIT 12"
        ).fetchall()
        return jsonify(
            {
                "stats": dbmod.network_stats(g.db),
                "pharmacies": [dict(row) for row in pharmacies],
                "reservations": [dict(row) for row in reservations],
                "urgent": [dict(row) for row in urgent],
                "users": [dict(row) for row in users],
                "feedback": [dict(row) for row in feedback],
                "activity": dbmod.recent_activity(g.db, 40),
                "lowStock": [
                    dbmod.serialize_listing(row, (30.7333, 76.7794)) for row in low_stock
                ],
                "loginHelp": {
                    "email": "admin@nivra.local",
                    "password": "admin123",
                    "url": "/admin",
                },
            }
        )

    @app.get("/api/admin/pharmacies/<int:pharmacy_id>")
    @auth_lib.login_required(("admin",))
    def admin_pharmacy_detail(pharmacy_id: int):
        detail = dbmod.pharmacy_detail(g.db, pharmacy_id)
        if not detail:
            return json_error("Pharmacy not found.", 404)
        return jsonify(detail)

    @app.post("/api/admin/pharmacies/<int:pharmacy_id>/verify")
    @auth_lib.login_required(("admin",))
    def verify_pharmacy(pharmacy_id: int):
        pharmacy = g.db.execute("SELECT * FROM pharmacies WHERE id = ?", (pharmacy_id,)).fetchone()
        if not pharmacy:
            return json_error("Pharmacy not found.", 404)
        data = body()
        notes = (data.get("notes") or "").strip()
        existing_notes = pharmacy["notes"] if "notes" in pharmacy.keys() else None
        g.db.execute(
            "UPDATE pharmacies SET status = 'verified', notes = ? WHERE id = ?",
            (notes or existing_notes, pharmacy_id),
        )
        g.db.execute(
            "UPDATE inventory SET last_verified_at = ? WHERE pharmacy_id = ?",
            (dbmod.iso(), pharmacy_id),
        )
        dbmod.log_activity(
            g.db,
            g.user["id"],
            g.user["name"],
            "pharmacy.verified",
            "pharmacy",
            pharmacy_id,
            f"{pharmacy['name']} was verified for the live network.",
        )
        g.db.commit()
        return jsonify({"id": pharmacy_id, "status": "verified"})

    @app.post("/api/admin/pharmacies/<int:pharmacy_id>/reject")
    @auth_lib.login_required(("admin",))
    def reject_pharmacy(pharmacy_id: int):
        pharmacy = g.db.execute("SELECT * FROM pharmacies WHERE id = ?", (pharmacy_id,)).fetchone()
        if not pharmacy:
            return json_error("Pharmacy not found.", 404)
        data = body()
        notes = (data.get("notes") or "Rejected during licence or stock review.").strip()
        g.db.execute(
            "UPDATE pharmacies SET status = 'rejected', notes = ? WHERE id = ?",
            (notes, pharmacy_id),
        )
        dbmod.log_activity(
            g.db,
            g.user["id"],
            g.user["name"],
            "pharmacy.rejected",
            "pharmacy",
            pharmacy_id,
            f"{pharmacy['name']} was rejected. {notes}",
        )
        g.db.commit()
        return jsonify({"id": pharmacy_id, "status": "rejected", "notes": notes})

    @app.post("/api/admin/pharmacies/<int:pharmacy_id>/reverify")
    @auth_lib.login_required(("admin",))
    def reverify_pharmacy(pharmacy_id: int):
        pharmacy = g.db.execute("SELECT * FROM pharmacies WHERE id = ?", (pharmacy_id,)).fetchone()
        if not pharmacy:
            return json_error("Pharmacy not found.", 404)
        g.db.execute(
            "UPDATE inventory SET last_verified_at = ? WHERE pharmacy_id = ?",
            (dbmod.iso(), pharmacy_id),
        )
        if pharmacy["status"] != "verified":
            g.db.execute("UPDATE pharmacies SET status = 'verified' WHERE id = ?", (pharmacy_id,))
        dbmod.log_activity(
            g.db,
            g.user["id"],
            g.user["name"],
            "pharmacy.reverified",
            "pharmacy",
            pharmacy_id,
            f"Stock timestamps refreshed for {pharmacy['name']}.",
        )
        g.db.commit()
        return jsonify({"id": pharmacy_id, "status": "verified", "message": "Stock verification refreshed."})

    @app.post("/api/admin/expire-holds")
    @auth_lib.login_required(("admin",))
    def expire_holds():
        count = dbmod.expire_stale_reservations(g.db)
        return jsonify({"expired": count, "message": f"Expired {count} stale reservation hold{'s' if count != 1 else ''}."})

    @app.get("/api/pharmacies/<int:pharmacy_id>")
    def public_pharmacy(pharmacy_id: int):
        detail = dbmod.pharmacy_detail(g.db, pharmacy_id)
        if not detail or not detail.get("pharmacy"):
            return json_error("Pharmacy not found.", 404)
        pharmacy = detail["pharmacy"]
        if pharmacy["status"] == "rejected":
            return json_error("Pharmacy not found.", 404)
        return jsonify(
            {
                "pharmacy": {
                    "id": pharmacy["id"],
                    "name": pharmacy["name"],
                    "address": pharmacy["address"],
                    "pincode": pharmacy["pincode"],
                    "phone": pharmacy["phone"],
                    "hours": pharmacy["hours"],
                    "status": pharmacy["status"],
                    "coordinates": {
                        "latitude": pharmacy["latitude"],
                        "longitude": pharmacy["longitude"],
                    },
                },
                "inventory": detail["inventory"],
            }
        )

    @app.get("/api/favorites")
    @auth_lib.login_required()
    def list_favorites():
        location = request.args.get("location") or "Chandigarh 160017"
        rows = g.db.execute(
            """
            SELECT inventory.id AS inventory_id
            FROM favorites
            JOIN inventory ON inventory.id = favorites.inventory_id
            WHERE favorites.user_id = ?
            ORDER BY favorites.id DESC
            """,
            (g.user["id"],),
        ).fetchall()
        listings = []
        for row in rows:
            item = dbmod.get_listing(g.db, row["inventory_id"], location)
            if item:
                listings.append(item)
        return jsonify({"count": len(listings), "results": listings})

    @app.post("/api/favorites/<int:inventory_id>")
    @auth_lib.login_required()
    def add_favorite(inventory_id: int):
        listing = g.db.execute("SELECT id FROM inventory WHERE id = ?", (inventory_id,)).fetchone()
        if not listing:
            return json_error("Listing not found.", 404)
        try:
            g.db.execute(
                "INSERT INTO favorites (user_id, inventory_id, created_at) VALUES (?, ?, ?)",
                (g.user["id"], inventory_id, dbmod.iso()),
            )
            dbmod.log_activity(
                g.db,
                g.user["id"],
                g.user["name"],
                "favorite.added",
                "inventory",
                inventory_id,
                f"{g.user['name']} saved a medicine listing.",
            )
            g.db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"ok": True, "saved": True, "message": "Already saved."})
        return jsonify({"ok": True, "saved": True, "message": "Saved to your favorites."}), 201

    @app.delete("/api/favorites/<int:inventory_id>")
    @auth_lib.login_required()
    def remove_favorite(inventory_id: int):
        g.db.execute(
            "DELETE FROM favorites WHERE user_id = ? AND inventory_id = ?",
            (g.user["id"], inventory_id),
        )
        g.db.commit()
        return jsonify({"ok": True, "saved": False})

    @app.post("/api/feedback")
    def create_feedback():
        data = body()
        name = (data.get("name") or "").strip() or "Anonymous"
        email = (data.get("email") or "").strip()
        message = (data.get("message") or "").strip()
        if len(message) < 5:
            return json_error("Please write a short message (at least 5 characters).")
        cursor = g.db.execute(
            "INSERT INTO feedback (user_id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)",
            (g.user["id"] if g.user else None, name, email, message, dbmod.iso()),
        )
        dbmod.log_activity(
            g.db,
            g.user["id"] if g.user else None,
            name,
            "feedback.sent",
            "feedback",
            cursor.lastrowid,
            f"Feedback received from {name}.",
        )
        g.db.commit()
        return jsonify({"ok": True, "message": "Thanks — your note was sent to the Nivra team."}), 201

    @app.get("/api/admin/feedback")
    @auth_lib.login_required(("admin",))
    def admin_feedback():
        rows = g.db.execute("SELECT * FROM feedback ORDER BY id DESC LIMIT 50").fetchall()
        return jsonify([dict(row) for row in rows])

    @app.errorhandler(404)
    def not_found(_error):
        if request.path.startswith("/api/"):
            return json_error("Not found.", 404)
        return send_from_directory(ROOT, "index.html")

    @app.errorhandler(sqlite3.IntegrityError)
    def integrity(_error):
        return json_error("That record already exists or violates a unique constraint.", 409)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=DEBUG)
