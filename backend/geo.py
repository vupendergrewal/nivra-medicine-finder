from __future__ import annotations

import math
import re

CHANDIGARH_CENTER = (30.7333, 76.7794)
ROHTAK_CENTER = (28.8955, 76.6066)

PINCODE_COORDS = {
    "160001": (30.7415, 76.7681),
    "160002": (30.7488, 76.7804),
    "160003": (30.7592, 76.7755),
    "160009": (30.7400, 76.8010),
    "160011": (30.7560, 76.7865),
    "160012": (30.7480, 76.7690),
    "160014": (30.7320, 76.7920),
    "160015": (30.7510, 76.8020),
    "160016": (30.7275, 76.8055),
    "160017": (30.7416, 76.7850),
    "160018": (30.7260, 76.7905),
    "160019": (30.7370, 76.8120),
    "160020": (30.7288, 76.7750),
    "160022": (30.7354, 76.7694),
    "160023": (30.7188, 76.8012),
    "160025": (30.7145, 76.7855),
    "160030": (30.7105, 76.7688),
    "160035": (30.7240, 76.7580),
    "160036": (30.7055, 76.7905),
    "160047": (30.6988, 76.7382),
    "160055": (30.6890, 76.7520),
    "160062": (30.7070, 76.7180),
    "160071": (30.6945, 76.8450),
    "160101": (30.7190, 76.8350),
    "140301": (30.7046, 76.7179),
    "140308": (30.6780, 76.7220),
    # Rohtak / nearby
    "124001": (28.8955, 76.6066),
    "124021": (28.8805, 76.5980),
    "124112": (28.9630, 76.2955),
    "124113": (28.8305, 76.4905),
}

SECTOR_COORDS = {
    "sector 1": (30.7590, 76.7850),
    "sector 8": (30.7400, 76.8010),
    "sector 9": (30.7465, 76.7950),
    "sector 10": (30.7510, 76.7880),
    "sector 11": (30.7560, 76.7865),
    "sector 14": (30.7320, 76.7920),
    "sector 15": (30.7510, 76.8020),
    "sector 16": (30.7275, 76.8055),
    "sector 17": (30.7416, 76.7850),
    "sector 18": (30.7260, 76.7905),
    "sector 19": (30.7370, 76.8120),
    "sector 20": (30.7288, 76.7750),
    "sector 21": (30.7325, 76.7620),
    "sector 22": (30.7354, 76.7694),
    "sector 23": (30.7188, 76.8012),
    "sector 26": (30.7405, 76.8205),
    "sector 27": (30.7215, 76.8250),
    "sector 32": (30.7120, 76.8450),
    "sector 34": (30.7180, 76.7650),
    "sector 35": (30.7240, 76.7580),
    "sector 36": (30.7055, 76.7905),
    "sector 43": (30.7080, 76.7500),
    "sector 44": (30.7140, 76.7420),
    "sector 45": (30.7020, 76.7550),
    "manimajra": (30.7190, 76.8350),
    "mohali": (30.7046, 76.7179),
    "panchkula": (30.6942, 76.8606),
    "chandigarh": CHANDIGARH_CENTER,
    "rohtak": ROHTAK_CENTER,
    "model town rohtak": (28.8958, 76.6066),
    "pgims": (28.8920, 76.6195),
    "huda rohtak": (28.8805, 76.5980),
    "kalanaur": (28.8305, 76.4905),
    "meham": (28.9630, 76.2955),
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return round(2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 1)


def extract_pincode(location: str) -> str | None:
    digits = "".join(ch for ch in location if ch.isdigit())
    if len(digits) >= 6:
        return digits[:6]
    return None


def coords_from_location(location: str, fallback: tuple[float, float] = CHANDIGARH_CENTER) -> tuple[float, float]:
    if not location:
        return fallback

    parts = [part.strip() for part in location.split(",")]
    if len(parts) == 2:
        try:
            lat, lng = float(parts[0]), float(parts[1])
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return (lat, lng)
        except ValueError:
            pass

    pin = extract_pincode(location)
    if pin and pin in PINCODE_COORDS:
        return PINCODE_COORDS[pin]

    lowered = location.lower()
    for key, coords in SECTOR_COORDS.items():
        if key in lowered:
            return coords

    sector_match = re.search(r"sector\s*(\d+)", lowered)
    if sector_match:
        key = f"sector {sector_match.group(1)}"
        if key in SECTOR_COORDS:
            return SECTOR_COORDS[key]

    return fallback


def geocode(location: str) -> dict:
    lat, lng = coords_from_location(location)
    pin = extract_pincode(location)
    label = location.strip() or "Chandigarh"
    return {
        "query": location,
        "label": label,
        "pincode": pin,
        "latitude": lat,
        "longitude": lng,
        "resolved": bool(pin or any(key in location.lower() for key in SECTOR_COORDS)),
    }


def parse_radius_km(value) -> int:
    if value is None:
        return 10
    if isinstance(value, (int, float)):
        return max(1, int(value))
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return int(digits) if digits else 10


def bounding_box(lat: float, lng: float, radius_km: float) -> dict:
    # Rough degree deltas for map viewport fitting.
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / max(111.0 * math.cos(math.radians(lat)), 0.01)
    return {
        "south": lat - lat_delta,
        "north": lat + lat_delta,
        "west": lng - lng_delta,
        "east": lng + lng_delta,
    }
