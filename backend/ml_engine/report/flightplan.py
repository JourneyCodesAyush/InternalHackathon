"""Pre-inspection drone flight plans for places that need inspection (report anomalies / high-risk hotspots).

A plan flies from the ground station (the Pi drone portal's launch base) to the site, surveys it with an
orbit at low altitude (NO2 sensor + camera for the haze model) and returns, so officials know what they
will find before they go. Everything is computed from the report's own data: route geometry, the day's
wind (headwind/crosswind, crab angle), terrain from the model's elevation layer, and an energy model of
the airframe for battery use.
"""

from __future__ import annotations

import io
import math

import numpy as np

from ..env import setting

EARTH_R = 6_371_000.0

# Ground station: the launch base of the Pi drone portal (SimulationMap MUMBAI_COORD); override per site
HOME = (float(setting("DRONE_HOME_LAT", "19.0760")), float(setting("DRONE_HOME_LON", "72.8777")))
HOME_NAME = setting("DRONE_HOME_NAME", "Drone ground station (Pi portal base)")

# Airframe (a typical 5-inch-class survey quad on a 4S Li-ion/LiPo pack); override with env if different
DRONE = {
    "mass_kg": float(setting("DRONE_MASS_KG", "1.6")),
    "battery_mah": float(setting("DRONE_BATTERY_MAH", "5000")),
    "voltage_v": float(setting("DRONE_BATTERY_V", "14.8")),
    "hover_power_w": float(setting("DRONE_HOVER_W", "190")),
    "cruise_ms": 10.0,  # airspeed
    "climb_ms": 3.0,
    "descent_ms": 2.0,
    "max_wind_ms": 10.0,
    "reserve": 0.20,  # land with at least 20% left
}
CRUISE_AGL_M = 80.0  # below the 120 m (400 ft) DGCA green-zone ceiling
SURVEY_AGL_M = 50.0
ORBIT_RADIUS_M = 150.0
ORBIT_LAPS = 2
MAX_PLANS = 3

# major airports (DGCA Digital Sky: <8 km of the perimeter is yellow zone -> ATC permission needed;
# 8-12 km allows up to 200 ft / 60 m; beyond is green up to 400 ft / 120 m). Verify on the Digital Sky map.
AIRPORTS = {
    "Chhatrapati Shivaji Maharaj Intl (BOM)": (19.0896, 72.8656),
    "Juhu Aerodrome": (19.0981, 72.8342),
    "Navi Mumbai Intl (NMI)": (18.9950, 73.0650),
    "Indira Gandhi Intl, Delhi (DEL)": (28.5562, 77.1000),
    "Kempegowda Intl, Bengaluru (BLR)": (13.1986, 77.7066),
    "HAL Airport, Bengaluru": (12.9500, 77.6682),
    "Pune (PNQ)": (18.5822, 73.9197),
    "Chennai (MAA)": (12.9941, 80.1709),
    "Kolkata (CCU)": (22.6547, 88.4467),
    "Hyderabad (HYD)": (17.2403, 78.4294),
}


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(h))


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _compass(deg: float) -> str:
    names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return names[int(((deg % 360) + 11.25) // 22.5) % 16]


def _elevation(static, grid, lat: float, lon: float) -> float | None:
    if static is None or "elevation" not in static:
        return None
    j, i = int((grid.north - lat) / grid.res), int((lon - grid.west) / grid.res)
    if 0 <= j < grid.height and 0 <= i < grid.width:
        v = float(static["elevation"].values[j, i])
        return v if np.isfinite(v) else None
    return None


def _leg(distance_m: float, track_deg: float, wind_ms: float, wind_from_deg: float) -> dict:
    """Ground speed, headwind and crab angle for a straight leg flown at the cruise airspeed."""
    air = DRONE["cruise_ms"]
    rel = math.radians(wind_from_deg - track_deg)
    headwind = wind_ms * math.cos(rel)  # +: wind on the nose
    crosswind = wind_ms * math.sin(rel)
    crab = math.degrees(math.asin(max(-1.0, min(1.0, crosswind / air))))
    ground = max(2.0, math.sqrt(max(air ** 2 - crosswind ** 2, 0.0)) - headwind)
    return {"distance_m": distance_m, "track_deg": track_deg, "headwind_ms": headwind, "crosswind_ms": crosswind,
            "crab_deg": crab, "ground_speed_ms": ground, "time_s": distance_m / ground}


def _energy_mah(power_w: float, seconds: float) -> float:
    return power_w * seconds / 3600.0 / DRONE["voltage_v"] * 1000.0


FORWARD_LAUNCH_KM = 3.0  # forward launch point for sites beyond the battery range of the ground station


def plan(target: dict, wind_ms: float, wind_from_deg: float, static=None, grid=None, haze: dict | None = None,
         home: tuple[float, float] | None = None, home_name: str | None = None, relocate: bool = True) -> dict:
    """Flight plan from the ground station (or ``home``) to ``target`` ({'lat','lon','near', ...}). When the
    battery cannot cover the round trip, ``relocation`` holds a full plan from a forward launch point on the
    same line, ``FORWARD_LAUNCH_KM`` from the site (reached by road)."""
    home = home or HOME
    dest = (target["lat"], target["lon"])
    distance = _haversine(home, dest)
    out_track = _bearing(home, dest)
    back_track = (out_track + 180) % 360
    out_leg = _leg(distance, out_track, wind_ms, wind_from_deg)
    back_leg = _leg(distance, back_track, wind_ms, wind_from_deg)

    # airspace
    route = [(home[0] + (dest[0] - home[0]) * k / 20, home[1] + (dest[1] - home[1]) * k / 20) for k in range(21)]
    nearest_name, nearest_km = None, float("inf")
    for name, pos in AIRPORTS.items():
        d = min(_haversine(p, pos) for p in route) / 1000
        if d < nearest_km:
            nearest_name, nearest_km = name, d
    if nearest_km < 8:
        zone, max_agl = "yellow", 0
    elif nearest_km < 12:
        zone, max_agl = "yellow_8_12", 60
    else:
        zone, max_agl = "green", 120

    # cruise below the airspace ceiling (8-12 km from an airport: 60 m without permission)
    cruise_agl = min(CRUISE_AGL_M, max_agl) if max_agl else CRUISE_AGL_M
    survey_agl = min(SURVEY_AGL_M, cruise_agl)

    # terrain along the route (model elevation layer, 40 samples) and cruise altitude above the highest point
    home_elev = _elevation(static, grid, *home)
    dest_elev = _elevation(static, grid, *dest)
    samples = [_elevation(static, grid, home[0] + (dest[0] - home[0]) * k / 40, home[1] + (dest[1] - home[1]) * k / 40)
               for k in range(41)]
    samples = [s for s in samples if s is not None]
    max_terrain = max(samples) if samples else None
    base = home_elev if home_elev is not None else 0.0
    cruise_amsl = (max(max_terrain, base) if max_terrain is not None else base) + cruise_agl
    climb_m = cruise_amsl - base
    elevation_gain = (dest_elev - home_elev) if home_elev is not None and dest_elev is not None else None

    # phases: climb, outbound, descend to survey height, orbit, climb, return, descend and land
    survey_drop = max(0.0, cruise_amsl - ((dest_elev or base) + survey_agl))
    orbit_m = 2 * math.pi * ORBIT_RADIUS_M * ORBIT_LAPS
    orbit_s = orbit_m / DRONE["cruise_ms"] * 1.15  # slower, turning flight
    hover = DRONE["hover_power_w"]
    climb_power = hover * 1.1 + DRONE["mass_kg"] * 9.81 * DRONE["climb_ms"] / 0.6  # potential energy at 60% eff.
    phases = [
        ("Take-off and climb", climb_m / DRONE["climb_ms"], climb_power),
        ("Outbound cruise", out_leg["time_s"], hover * 0.85 * (1 + 0.02 * max(out_leg["headwind_ms"], 0))),
        ("Descend to survey height", survey_drop / DRONE["descent_ms"], hover * 0.8),
        (f"Survey orbit ({ORBIT_LAPS} laps, r={ORBIT_RADIUS_M:.0f} m)", orbit_s, hover * 0.95),
        ("Climb back to cruise", survey_drop / DRONE["climb_ms"], climb_power),
        ("Return cruise", back_leg["time_s"], hover * 0.85 * (1 + 0.02 * max(back_leg["headwind_ms"], 0))),
        ("Descent and landing", climb_m / DRONE["descent_ms"] + 20, hover * 0.8),
    ]
    phase_rows = [{"phase": name, "time_s": round(t), "mah": round(_energy_mah(p, t))} for name, t, p in phases]
    total_s = sum(r["time_s"] for r in phase_rows)
    total_mah = sum(r["mah"] for r in phase_rows)
    usable = DRONE["battery_mah"] * (1 - DRONE["reserve"])
    remaining_pct = 100 * (1 - total_mah / DRONE["battery_mah"])

    # the farthest round trip this battery allows with this wind (for relocation advice)
    per_m = (_energy_mah(hover * 0.85, 1 / out_leg["ground_speed_ms"]) + _energy_mah(hover * 0.85, 1 / back_leg["ground_speed_ms"]))
    fixed = sum(r["mah"] for r in phase_rows if "cruise" not in r["phase"].lower())
    max_radius_km = max(0.0, (usable - fixed) / per_m / 1000) if per_m > 0 else None

    issues = []
    if wind_ms > DRONE["max_wind_ms"]:
        issues.append("wind")
    if total_mah > usable:
        issues.append("battery")
    if zone == "yellow":
        issues.append("airspace")
    if haze and haze.get("class") in ("moderate", "dense"):
        issues.append("visibility")
    go = "go" if not issues else ("conditional" if set(issues) <= {"airspace", "visibility"} else "no_go")

    relocation = None
    if relocate and "battery" in issues and distance > FORWARD_LAUNCH_KM * 1000:
        f = FORWARD_LAUNCH_KM * 1000 / distance  # point on the home->site line, FORWARD_LAUNCH_KM from the site
        forward = (dest[0] + (home[0] - dest[0]) * f, dest[1] + (home[1] - dest[1]) * f)
        relocation = plan(target, wind_ms, wind_from_deg, static, grid, haze, home=forward,
                          home_name="Forward launch point (by road)", relocate=False)

    # waypoints (lat, lon, altitude AGL at that point, action)
    orbit = [(dest[0] + ORBIT_RADIUS_M / EARTH_R * math.degrees(1) * math.cos(math.radians(a)),
              dest[1] + ORBIT_RADIUS_M / (EARTH_R * math.cos(math.radians(dest[0]))) * math.degrees(1) * math.sin(math.radians(a)))
             for a in (0, 90, 180, 270)]
    waypoints = [
        {"name": "HOME", "lat": home[0], "lon": home[1], "alt_agl": 0, "action": "take_off"},
        {"name": "WP1", "lat": home[0], "lon": home[1], "alt_agl": round(climb_m), "action": "climb"},
        {"name": "WP2", "lat": dest[0], "lon": dest[1], "alt_agl": round(cruise_amsl - (dest_elev or base)), "action": "arrive"},
        *[{"name": f"S{k + 1}", "lat": la, "lon": lo, "alt_agl": survey_agl, "action": "survey"} for k, (la, lo) in enumerate(orbit)],
        {"name": "WP3", "lat": dest[0], "lon": dest[1], "alt_agl": round(cruise_amsl - (dest_elev or base)), "action": "depart"},
        {"name": "HOME", "lat": home[0], "lon": home[1], "alt_agl": 0, "action": "land"},
    ]
    return {
        "target": {k: target.get(k) for k in ("near", "lat", "lon", "value", "kinds", "reasons", "severity")},
        "home": {"name": home_name or HOME_NAME, "lat": home[0], "lon": home[1], "elevation_m": home_elev},
        "distance_km": round(distance / 1000, 2),
        "round_trip_km": round(2 * distance / 1000 + orbit_m / 1000, 2),
        "bearing_deg": round(out_track), "bearing_compass": _compass(out_track),
        "return_bearing_deg": round(back_track),
        "wind": {"speed_ms": round(wind_ms, 1), "from_deg": round(wind_from_deg), "from_compass": _compass(wind_from_deg),
                 "outbound_headwind_ms": round(out_leg["headwind_ms"], 1), "return_headwind_ms": round(back_leg["headwind_ms"], 1),
                 "crosswind_ms": round(abs(out_leg["crosswind_ms"]), 1), "crab_deg": round(abs(out_leg["crab_deg"]), 1)},
        "ground_speed_out_ms": round(out_leg["ground_speed_ms"], 1), "ground_speed_back_ms": round(back_leg["ground_speed_ms"], 1),
        "elevation": {"home_m": None if home_elev is None else round(home_elev), "target_m": None if dest_elev is None else round(dest_elev),
                      "gain_m": None if elevation_gain is None else round(elevation_gain),
                      "max_terrain_m": None if max_terrain is None else round(max_terrain),
                      "cruise_amsl_m": round(cruise_amsl), "cruise_agl_m": cruise_agl, "survey_agl_m": survey_agl},
        "phases": phase_rows, "total_time_min": round(total_s / 60, 1), "total_mah": round(total_mah),
        "battery": {"capacity_mah": DRONE["battery_mah"], "usable_mah": round(usable), "remaining_pct": round(remaining_pct),
                    "max_radius_km": None if max_radius_km is None else round(max_radius_km, 1)},
        "airspace": {"nearest_airport": nearest_name, "distance_km": round(nearest_km, 1), "zone": zone, "max_agl_m": max_agl},
        "issues": issues, "decision": go, "relocation": relocation,
        "survey": {"orbit_radius_m": ORBIT_RADIUS_M, "laps": ORBIT_LAPS, "altitude_agl_m": survey_agl,
                   "sampling": "NO2 sensor 1 Hz, camera frame every 5 s for DCP haze, geo-tagged"},
        "waypoints": waypoints,
        "drone": DRONE,
    }


def plans_for(facts: dict, static=None, grid=None, haze: dict | None = None) -> list[dict]:
    """Flight plans for the report's places that need inspection (anomalies first, then hotspots above the
    CPCB limit), up to ``MAX_PLANS``."""
    targets = [a for a in facts.get("anomalies") or []]
    if not targets:
        targets = [h for h in facts.get("hotspots") or [] if h.get("value", 0) > 80]
    fc = facts.get("forecast") or {}
    wind_ms = fc.get("wind_speed") or 0.0
    wind_from = fc.get("wind_from_deg") or 0.0
    return [plan(t, wind_ms, wind_from, static, grid, haze) for t in targets[:MAX_PLANS]]


def route_map(fp: dict, surface: np.ndarray | None, grid, colourise, scale: int = 4,
              water: np.ndarray | None = None) -> io.BytesIO:
    """PNG map: high-contrast tactical flight route diagram showing ground station (Pi portal base),
    target inspection site, outbound/return flight paths, 150m survey orbit with waypoints, wind vector,
    elevation profile, battery energy estimate, and DGCA airspace classification."""
    import base64
    from PIL import Image, ImageDraw, ImageFont

    home, dest = (fp["home"]["lat"], fp["home"]["lon"]), (fp["target"]["lat"], fp["target"]["lon"])
    pad = max(0.015, 0.45 * max(abs(home[0] - dest[0]), abs(home[1] - dest[1])))
    south, north = min(home[0], dest[0]) - pad, max(home[0], dest[0]) + pad
    west, east = min(home[1], dest[1]) - pad, max(home[1], dest[1]) + pad
    width_px = 800
    height_px = int(width_px * (north - south) / ((east - west) * math.cos(math.radians((north + south) / 2))))
    height_px = max(480, min(800, height_px))

    def px(lat, lon):
        return ((lon - west) / (east - west) * width_px, (north - lat) / (north - south) * height_px)

    # Base canvas
    if surface is not None and grid is not None:
        img = Image.new("RGB", (width_px, height_px), (225, 232, 240))
        rgb = colourise(surface).astype(np.float64)
        if water is not None:  # mute open water so coastlines and land read at a glance
            rgb[water] = 0.3 * rgb[water] + 0.7 * np.array([214, 224, 234])
        big = Image.fromarray(rgb.astype(np.uint8))
        x0, y0 = px(grid.north, grid.west)
        x1, y1 = px(grid.north - grid.height * grid.res, grid.west + grid.width * grid.res)
        big = big.resize((max(1, int(x1 - x0)), max(1, int(y1 - y0))), Image.NEAREST)
        img.paste(big, (int(x0), int(y0)))
    else:
        # Tactical mission planner slate background with coordinate grid lines
        img = Image.new("RGB", (width_px, height_px), (15, 23, 42))
        grid_draw = ImageDraw.Draw(img)
        for gx in range(0, width_px, 60):
            grid_draw.line((gx, 0, gx, height_px), fill=(30, 41, 59), width=1)
        for gy in range(0, height_px, 60):
            grid_draw.line((0, gy, width_px, gy), fill=(30, 41, 59), width=1)

    draw = ImageDraw.Draw(img, "RGBA")
    try:
        title_font = ImageFont.load_default(size=16)
        font = ImageFont.load_default(size=14)
        small = ImageFont.load_default(size=11)
        hud_font = ImageFont.load_default(size=12)
    except TypeError:
        title_font = font = small = hud_font = ImageFont.load_default()

    hx, hy = px(*home)
    tx, ty = px(*dest)

    # 1. Flight Corridor (Return Path - subtle dashed line)
    draw.line((tx, ty, hx, hy), fill=(56, 189, 248, 120), width=2)

    # 2. Outbound Route (Bold tactical cyan with arrow)
    draw.line((hx, hy, tx, ty), fill=(2, 132, 199, 240), width=4)
    mx, my = (hx + tx) / 2, (hy + ty) / 2
    ang = math.atan2(ty - hy, tx - hx)
    # Mid-flight heading arrows
    for f in (0.35, 0.65):
        ax, ay = hx + (tx - hx) * f, hy + (ty - hy) * f
        draw.polygon([(ax + 14 * math.cos(ang), ay + 14 * math.sin(ang)),
                      (ax + 14 * math.cos(ang + 2.4), ay + 14 * math.sin(ang + 2.4)),
                      (ax + 14 * math.cos(ang - 2.4), ay + 14 * math.sin(ang - 2.4))],
                     fill=(2, 132, 199, 255))

    # 3. Target Survey Orbit Pattern (150m radius)
    r_px = max(18.0, ORBIT_RADIUS_M / 111_320 / (north - south) * height_px)
    draw.ellipse((tx - r_px, ty - r_px, tx + r_px, ty + r_px),
                 outline=(245, 158, 11, 255), width=3)
    # Orbit waypoints (S1..S4)
    orbit_angles = [0, math.pi / 2, math.pi, 3 * math.pi / 2]
    wp_labels = ["S1", "S2", "S3", "S4"]
    for theta, lbl in zip(orbit_angles, wp_labels):
        ox = tx + r_px * math.cos(theta)
        oy = ty + r_px * math.sin(theta)
        draw.ellipse((ox - 4, oy - 4, ox + 4, oy + 4), fill=(245, 158, 11, 255), outline=(15, 23, 42, 255), width=1)
        draw.text((ox + 6, oy - 6), lbl, fill=(245, 158, 11, 255), font=small, stroke_width=2, stroke_fill=(15, 23, 42, 255))

    # 4. Ground Station Launch Base Marker (Hexagon / Concentric rings)
    draw.ellipse((hx - 14, hy - 14, hx + 14, hy + 14), fill=(16, 185, 129, 240), outline=(255, 255, 255, 255), width=3)
    draw.ellipse((hx - 6, hy - 6, hx + 6, hy + 6), fill=(255, 255, 255, 255))
    launch_label = "GROUND STATION (Pi Portal)" if fp["home"]["name"] == HOME_NAME else "FORWARD LAUNCH POINT"
    home_elev_txt = f"{fp['elevation']['home_m']}m AMSL" if fp["elevation"].get("home_m") is not None else "Sea Level"
    draw.text((hx + 18, hy - 16), launch_label, fill=(15, 23, 42, 255), font=title_font, stroke_width=3, stroke_fill=(255, 255, 255, 255))
    draw.text((hx + 18, hy + 2), f"{home[0]:.4f}°N, {home[1]:.4f}°E · Elev: {home_elev_txt}",
              fill=(51, 65, 85, 255), font=small, stroke_width=2, stroke_fill=(255, 255, 255, 255))

    # 5. Inspection Destination Marker (Target Bullseye)
    draw.ellipse((tx - 15, ty - 15, tx + 15, ty + 15), fill=(225, 29, 72, 240), outline=(255, 255, 255, 255), width=3)
    draw.ellipse((tx - 7, ty - 7, tx + 7, ty + 7), fill=(255, 255, 255, 255))
    draw.ellipse((tx - 2, ty - 2, tx + 2, ty + 2), fill=(225, 29, 72, 255))
    target_name = fp["target"].get("near") or f"{dest[0]:.3f}°N, {dest[1]:.3f}°E"
    val = fp["target"].get("value")
    val_txt = f"NO₂: {val:.0f} µg/m³" if val is not None else "HIGH RISK"
    target_elev_txt = f"Elev: {fp['elevation']['target_m']}m" if fp["elevation"].get("target_m") is not None else ""
    draw.text((tx + 18, ty - 16), f"INSPECTION SITE: {target_name}", fill=(159, 18, 57, 255), font=title_font, stroke_width=3, stroke_fill=(255, 255, 255, 255))
    draw.text((tx + 18, ty + 2), f"{val_txt} · {dest[0]:.4f}°N, {dest[1]:.4f}°E · {target_elev_txt}",
              fill=(190, 18, 60, 255), font=small, stroke_width=2, stroke_fill=(255, 255, 255, 255))

    # 6. Tactical Telemetry HUD Card (Top-Left)
    hud_x, hud_y, hud_w, hud_h = 16, 16, 310, 156
    draw.rectangle((hud_x, hud_y, hud_x + hud_w, hud_y + hud_h), fill=(15, 23, 42, 230), outline=(56, 189, 248, 180), width=1)
    draw.text((hud_x + 10, hud_y + 8), "FLIGHT TELEMETRY & ENERGY", fill=(56, 189, 248, 255), font=title_font)
    gain_txt = f"{fp['elevation']['gain_m']:+d} m" if fp['elevation'].get('gain_m') is not None else "N/A"
    lines = [
        f"• One-Way Distance: {fp['distance_km']:.2f} km  (Round Trip: {fp['round_trip_km']:.2f} km)",
        f"• Outbound Bearing: {fp['bearing_deg']}° ({fp['bearing_compass']})  |  Return: {fp['return_bearing_deg']}°",
        f"• Ground Speed: {fp['ground_speed_out_ms']:.1f} m/s out  |  {fp['ground_speed_back_ms']:.1f} m/s back",
        f"• Elevation Gain: {gain_txt}  (Cruise: {fp['elevation']['cruise_amsl_m']}m AMSL)",
        f"• Est. Battery Usage: {fp['total_mah']} mAh  ({fp['total_time_min']} min flight)",
        f"• Reserve on Landing: {max(0, fp['battery']['remaining_pct'])}%  (Usable: {fp['battery']['usable_mah']} mAh)",
        f"• Decision: {fp['decision'].upper()}  ({len(fp['issues'])} issues detected)",
    ]
    dec_color = (74, 222, 128, 255) if fp['decision'] == "go" else ((251, 146, 60, 255) if fp['decision'] == "conditional" else (248, 113, 113, 255))
    for i, line in enumerate(lines):
        c = dec_color if i == 6 else (226, 232, 240, 255)
        draw.text((hud_x + 10, hud_y + 30 + i * 17), line, fill=c, font=hud_font)

    # 7. Wind & Aerodynamics Vector HUD (Bottom-Left)
    w_hud_x, w_hud_y, w_hud_w, w_hud_h = 16, height_px - 95, 260, 80
    draw.rectangle((w_hud_x, w_hud_y, w_hud_x + w_hud_w, w_hud_y + w_hud_h), fill=(15, 23, 42, 230), outline=(148, 163, 184, 180), width=1)
    wind_to = math.radians(fp["wind"]["from_deg"] + 180)
    wx, wy = w_hud_x + 28, w_hud_y + 40
    draw.line((wx - 20 * math.sin(wind_to), wy + 20 * math.cos(wind_to),
               wx + 20 * math.sin(wind_to), wy - 20 * math.cos(wind_to)), fill=(56, 189, 248, 255), width=3)
    draw.ellipse((wx + 20 * math.sin(wind_to) - 4, wy - 20 * math.cos(wind_to) - 4,
                  wx + 20 * math.sin(wind_to) + 4, wy - 20 * math.cos(wind_to) + 4), fill=(56, 189, 248, 255))
    draw.text((w_hud_x + 58, w_hud_y + 8), f"WIND: {fp['wind']['speed_ms']} m/s from {fp['wind']['from_compass']} ({fp['wind']['from_deg']}°)",
              fill=(241, 245, 249, 255), font=font)
    draw.text((w_hud_x + 58, w_hud_y + 28), f"Headwind: {fp['wind']['outbound_headwind_ms']:+.1f} m/s out | {fp['wind']['return_headwind_ms']:+.1f} back",
              fill=(203, 213, 225, 255), font=hud_font)
    draw.text((w_hud_x + 58, w_hud_y + 46), f"Crosswind: {fp['wind']['crosswind_ms']:.1f} m/s | Crab: {fp['wind']['crab_deg']:.1f}°",
              fill=(203, 213, 225, 255), font=hud_font)

    # 8. Airspace DGCA Zone Banner (Top-Right)
    air_x, air_y, air_w, air_h = width_px - 280, 16, 264, 48
    draw.rectangle((air_x, air_y, air_x + air_w, air_y + air_h), fill=(15, 23, 42, 230), outline=(245, 158, 11, 180), width=1)
    zone_label = f"AIRSPACE: DGCA {fp['airspace']['zone'].upper()}"
    draw.text((air_x + 10, air_y + 6), zone_label, fill=(245, 158, 11, 255), font=font)
    near_air = fp['airspace'].get('nearest_airport') or "Regional Airspace"
    draw.text((air_x + 10, air_y + 26), f"{near_air} ({fp['airspace']['distance_km']} km) · Max {fp['airspace']['max_agl_m']}m",
              fill=(203, 213, 225, 255), font=hud_font)

    # 9. North arrow & Scale bar (Bottom-Right)
    draw.polygon([(width_px - 40, height_px - 75), (width_px - 48, height_px - 50), (width_px - 32, height_px - 50)], fill=(255, 255, 255, 255))
    draw.text((width_px - 44, height_px - 48), "N", fill=(255, 255, 255, 255), font=font, stroke_width=2, stroke_fill=(15, 23, 42, 255))
    km_px = 1000 / 111_320 / (east - west) * width_px * math.cos(math.radians((north + south) / 2))
    bar_km = 1 if km_px * 1 > 40 else 5
    bar_len = bar_km * km_px
    draw.rectangle((width_px - 30 - bar_len, height_px - 25, width_px - 30, height_px - 20), fill=(255, 255, 255, 255))
    draw.text((width_px - 30 - bar_len, height_px - 42), f"{bar_km} km", fill=(255, 255, 255, 255), font=small,
              stroke_width=2, stroke_fill=(15, 23, 42, 255))

    # Outer border
    draw.rectangle((0, 0, width_px - 1, height_px - 1), outline=(71, 85, 105, 255), width=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def route_map_data_uri(fp: dict, surface: np.ndarray | None, grid, colourise, scale: int = 4,
                       water: np.ndarray | None = None) -> str:
    """Base64 Data URI of the tactical flight route map PNG (for direct embedding in web JSON and UI)."""
    import base64
    buf = route_map(fp, surface, grid, colourise, scale=scale, water=water)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"

