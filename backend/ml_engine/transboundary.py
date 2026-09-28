"""Transboundary Atmospheric NO2 Flux and Cross-Border Attribution Engine.

Uses Sentinel-5P tropospheric NO2 column densities and NOAA GFS 10 m wind fields to compute:
1. Horizontal mass transport vector field: F = C * v (g / (m * s))
2. Line integrals of boundary normal flux across administrative borders:
   Phi = int_border (F . n_inward) dl (tonnes / day)
3. Source jurisdiction attribution percentages for air quality regulators (CAQM, CPCB, SPCBs, courts):
   e.g. "61% of Delhi's NO2 today arrived from outside the city."
4. Four critical Indian transboundary airshed battlegrounds:
   - Delhi NCR (Haryana <-> Delhi <-> UP <-> Rajasthan)
   - Punjab & Indus Airshed (Pakistan PK -> Punjab IN -> Haryana)
   - Indo-Gangetic Plain Eastern Corridor (UP -> Bihar -> West Bengal)
   - Singrauli–Korba Thermal & Mining Belt (MP <-> Chhattisgarh <-> Jharkhand)
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

NO2_MOLAR_MASS_G = 46.0055
UMOL_TO_G_M2 = NO2_MOLAR_MASS_G * 1e-6
EARTH_RADIUS_M = 6_371_000.0
DAY_SECONDS = 86_400.0
TAU_DAYTIME_HOURS = 5.0


def _sample_bilinear(arr: np.ndarray, lon: float, lat: float, res: float = 0.5) -> float:
    """Sample global grid (north-up from 90N, west-to-east from 180W) with bilinear interpolation."""
    h, w = arr.shape
    y = (90.0 - lat) / res
    x = (((lon + 180.0) % 360.0) + 360.0) % 360.0 / res

    y_clamped = max(0.0, min(float(h - 1), y))
    y0 = int(math.floor(y_clamped))
    y1 = min(h - 1, y0 + 1)
    fy = y_clamped - y0

    x0 = int(math.floor(x)) % w
    x1 = (x0 + 1) % w
    fx = x - math.floor(x)

    v00 = arr[y0, x0]
    v01 = arr[y0, x1]
    v10 = arr[y1, x0]
    v11 = arr[y1, x1]

    vals = [v00, v01, v10, v11]
    if any(np.isnan(v) for v in vals):
        valid = [v for v in vals if np.isfinite(v)]
        return float(np.mean(valid)) if valid else 0.0

    top = (1.0 - fx) * v00 + fx * v01
    bot = (1.0 - fx) * v10 + fx * v11
    return float((1.0 - fy) * top + fy * bot)


def _segment_flux(
    p1: tuple[float, float],
    p2: tuple[float, float],
    no2_grid: np.ndarray,
    u_grid: np.ndarray,
    v_grid: np.ndarray,
    res: float = 0.5,
    samples_per_seg: int = 5,
) -> dict[str, Any]:
    """Calculate the atmospheric flux across a single border segment from p1 (lon1, lat1) to p2 (lon2, lat2)."""
    lon1, lat1 = p1
    lon2, lat2 = p2

    lat_mid = (lat1 + lat2) / 2.0
    cos_lat = max(0.05, math.cos(math.radians(lat_mid)))

    dx_m = EARTH_RADIUS_M * math.radians(lon2 - lon1) * cos_lat
    dy_m = EARTH_RADIUS_M * math.radians(lat2 - lat1)
    seg_len_m = math.hypot(dx_m, dy_m)

    if seg_len_m < 1.0:
        return {
            "flux_tonnes_day": 0.0,
            "inflow_tonnes_day": 0.0,
            "outflow_tonnes_day": 0.0,
            "mean_no2": 0.0,
            "mean_u": 0.0,
            "mean_v": 0.0,
            "seg_len_km": 0.0,
        }

    # Inward normal
    nx = -dy_m / seg_len_m
    ny = dx_m / seg_len_m

    weights = np.linspace(0.1, 0.9, samples_per_seg)
    sample_no2 = []
    sample_u = []
    sample_v = []
    for w in weights:
        s_lon = lon1 + w * (lon2 - lon1)
        s_lat = lat1 + w * (lat2 - lat1)
        sample_no2.append(_sample_bilinear(no2_grid, s_lon, s_lat, res))
        sample_u.append(_sample_bilinear(u_grid, s_lon, s_lat, res))
        sample_v.append(_sample_bilinear(v_grid, s_lon, s_lat, res))

    mean_no2 = float(np.mean(sample_no2))
    mean_u = float(np.mean(sample_u))
    mean_v = float(np.mean(sample_v))

    v_norm = mean_u * nx + mean_v * ny
    c_mass_g_m2 = max(0.0, mean_no2) * UMOL_TO_G_M2

    flux_g_s = c_mass_g_m2 * v_norm * seg_len_m
    flux_tonnes_day = (flux_g_s * DAY_SECONDS) * 1e-6

    inflow = max(0.0, flux_tonnes_day)
    outflow = max(0.0, -flux_tonnes_day)

    return {
        "flux_tonnes_day": round(flux_tonnes_day, 2),
        "inflow_tonnes_day": round(inflow, 2),
        "outflow_tonnes_day": round(outflow, 2),
        "mean_no2": round(mean_no2, 2),
        "mean_u": round(mean_u, 2),
        "mean_v": round(mean_v, 2),
        "v_norm_ms": round(v_norm, 2),
        "seg_len_km": round(seg_len_m / 1000.0, 1),
        "midpoint": [round((lon1 + lon2) / 2.0, 4), round((lat1 + lat2) / 2.0, 4)],
        "normal": [round(nx, 3), round(ny, 3)],
    }


def _estimate_ambient_mass(
    no2_grid: np.ndarray,
    lat_min: float,
    lat_max: float,
    lon_min: float,
    lon_max: float,
    res: float = 0.5,
) -> float:
    """Compute total ambient NO2 mass (tonnes) within a bounding box."""
    lat_steps = np.linspace(lat_min, lat_max, 8)
    lon_steps = np.linspace(lon_min, lon_max, 8)

    lat_m_per_deg = 111_000.0
    area_per_sample = (
        ((lat_max - lat_min) * lat_m_per_deg / 7.0)
        * ((lon_max - lon_min) * lat_m_per_deg * math.cos(math.radians((lat_min + lat_max) / 2.0)) / 7.0)
    )

    total_mass_tonnes = 0.0
    for lat in lat_steps:
        for lon in lon_steps:
            val = _sample_bilinear(no2_grid, lon, lat, res)
            mass_g_m2 = max(0.0, val) * UMOL_TO_G_M2
            total_mass_tonnes += (mass_g_m2 * area_per_sample) * 1e-6

    return max(0.5, total_mass_tonnes)


# =================================================================================================
# 4 STRATEGIC AIRSHED REGION DEFINITIONS
# =================================================================================================

AIRSHED_SPECS: dict[str, dict[str, Any]] = {
    "delhi": {
        "id": "delhi",
        "name": "Delhi National Capital Region (NCR)",
        "center": [77.209, 28.6139],
        "zoom": 9.2,
        "bbox": [28.40, 28.88, 76.84, 77.35],
        "corridors": [
            {
                "id": "haryana_north",
                "from_state": "Haryana",
                "to_state": "Delhi",
                "corridor_name": "Sonipat–Kundli–Narela Corridor (North)",
                "agency": "Haryana SPCB / CAQM",
                "key_landmarks": "NH-44, Singhu Border, Sonipat Industrial Belt, Bawana",
                "policy_mandate": "Direct HSPCB to enforce industrial boiler inspections and curb stubble fires along NH-44.",
                "segments": [
                    ([76.92, 28.88], [77.06, 28.88]),
                    ([77.06, 28.88], [77.16, 28.87]),
                    ([77.16, 28.87], [77.22, 28.84]),
                ],
            },
            {
                "id": "haryana_west",
                "from_state": "Haryana",
                "to_state": "Delhi",
                "corridor_name": "Rohtak–Jhajjar–Tikri Corridor (West)",
                "agency": "Haryana SPCB / CAQM",
                "key_landmarks": "NH-9, Tikri Border, Mundka, Bahadurgarh Industrial Belt",
                "policy_mandate": "Enforce commercial heavy-vehicle transit diversions and generator curbs in Bahadurgarh.",
                "segments": [
                    ([76.84, 28.80], [76.84, 28.66]),
                    ([76.84, 28.66], [76.85, 28.52]),
                ],
            },
            {
                "id": "haryana_south",
                "from_state": "Haryana",
                "to_state": "Delhi",
                "corridor_name": "Gurugram–Faridabad Corridor (South)",
                "agency": "Haryana SPCB / CAQM",
                "key_landmarks": "NH-48, Sirhaul Toll, Kapashera, Badarpur Highway",
                "policy_mandate": "Implement peak congestion pricing and construction dust suppression in NCR satellite hubs.",
                "segments": [
                    ([76.88, 28.45], [77.08, 28.42]),
                    ([77.08, 28.42], [77.26, 28.42]),
                ],
            },
            {
                "id": "up_east",
                "from_state": "Uttar Pradesh",
                "to_state": "Delhi",
                "corridor_name": "Noida–Ghaziabad–Yamuna Corridor (East)",
                "agency": "UP Pollution Control Board (UPPCB)",
                "key_landmarks": "Anand Vihar, Ghazipur, DND Flyway, Noida Expressway, Loni",
                "policy_mandate": "Shut down non-compliant brick kilns and unsegregated municipal burning in Ghaziabad/Hapur.",
                "segments": [
                    ([77.34, 28.48], [77.34, 28.62]),
                    ([77.34, 28.62], [77.32, 28.74]),
                    ([77.32, 28.74], [77.26, 28.84]),
                ],
            },
        ],
        "gateways": [
            {"id": "gw_singhu", "name": "Singhu / Kundli Border (NH-44)", "coordinates": [77.13, 28.88], "corridor": "Haryana → Delhi", "description": "Primary northern industrial and heavy transport entry gateway."},
            {"id": "gw_tikri", "name": "Tikri / Bahadurgarh (NH-9)", "coordinates": [76.96, 28.69], "corridor": "Haryana → Delhi", "description": "Western ingress point for industrial emissions from Jhajjar and Rohtak."},
            {"id": "gw_anand_vihar", "name": "Anand Vihar / Kaushambi Gateway", "coordinates": [77.32, 28.65], "corridor": "Uttar Pradesh → Delhi", "description": "Interstate bus terminal and trans-Yamuna industrial crossing."},
            {"id": "gw_sirhaul", "name": "Sirhaul Border (NH-48)", "coordinates": [77.08, 28.50], "corridor": "Haryana → Delhi", "description": "High-density diesel commercial traffic from Gurugram / Manesar."},
            {"id": "gw_badarpur", "name": "Badarpur / Faridabad Gateway", "coordinates": [77.30, 28.49], "corridor": "Haryana → Delhi", "description": "Southern industrial ingress from Faridabad / Ballabhgarh."},
        ],
    },
    "punjab": {
        "id": "punjab",
        "name": "Punjab & Indus Transboundary Airshed",
        "center": [74.85, 31.45],
        "zoom": 7.8,
        "bbox": [29.80, 32.50, 73.80, 76.80],
        "corridors": [
            {
                "id": "pakistan_to_punjab_in",
                "from_state": "Punjab (Pakistan)",
                "to_state": "Punjab (India)",
                "corridor_name": "Lahore–Amritsar Transboundary Airshed",
                "agency": "Ministry of Environment / CPCB / Punjab PCB",
                "key_landmarks": "Wagah–Attari Border, Kasur–Khemkaran, Ravi River Basin, Dera Baba Nanak",
                "policy_mandate": "Transboundary airshed diplomatic framework for seasonal crop fire and coal brick kiln emissions.",
                "segments": [
                    ([74.98, 32.32], [74.78, 32.02]),
                    ([74.78, 32.02], [74.58, 31.62]),
                    ([74.58, 31.62], [74.42, 31.22]),
                    ([74.42, 31.22], [74.20, 30.95]),
                    ([74.20, 30.95], [73.92, 30.40]),
                ],
            },
            {
                "id": "punjab_to_haryana",
                "from_state": "Punjab (India)",
                "to_state": "Haryana",
                "corridor_name": "Punjab–Haryana Inter-State Ingress",
                "agency": "PPCB & HSPCB Joint Airshed Taskforce",
                "key_landmarks": "Ghaggar River basin, Ambala corridor, Kaithal–Patiala border, Bathinda–Sirsa",
                "policy_mandate": "Real-time crop burning detection and synchronized inter-state emergency GRAP mobilization.",
                "segments": [
                    ([74.80, 29.85], [75.50, 29.95]),
                    ([75.50, 29.95], [76.25, 30.25]),
                    ([76.25, 30.25], [76.85, 30.55]),
                ],
            },
        ],
        "gateways": [
            {"id": "gw_wagah", "name": "Attari / Wagah Border (GT Road)", "coordinates": [74.57, 31.60], "corridor": "Pakistan → India", "description": "Direct cross-border corridor from Lahore urban airshed to Amritsar."},
            {"id": "gw_khemkaran", "name": "Khemkaran / Kasur Gateway", "coordinates": [74.55, 31.15], "corridor": "Pakistan → India", "description": "Agricultural stubble and brick-kiln transboundary transport zone."},
            {"id": "gw_shambhu", "name": "Shambhu / Ambala Border (NH-44)", "coordinates": [76.71, 30.43], "corridor": "Punjab → Haryana", "description": "Primary south-east transit conduit carrying smoke towards NCR."},
            {"id": "gw_sirsa", "name": "Bathinda–Sirsa Interstate Link", "coordinates": [75.05, 29.90], "corridor": "Punjab → Haryana", "description": "Cotton and paddy residue burning drift corridor."},
        ],
    },
    "igp_east": {
        "id": "igp_east",
        "name": "Indo-Gangetic Plain Eastern Corridor",
        "center": [84.85, 25.60],
        "zoom": 7.2,
        "bbox": [24.50, 26.80, 83.20, 88.50],
        "corridors": [
            {
                "id": "up_to_bihar",
                "from_state": "Uttar Pradesh",
                "to_state": "Bihar",
                "corridor_name": "Ganga Basin Transport (UP → Bihar)",
                "agency": "Bihar SPCB / UPPCB / CPCB",
                "key_landmarks": "Buxar Ganga Bridge, Mohania–Varanasi Highway, Chhapra border, Ballia",
                "policy_mandate": "Ganga river basin-wide emissions quota under the National Clean Air Programme (NCAP).",
                "segments": [
                    ([83.80, 25.20], [83.95, 25.55]),
                    ([83.95, 25.55], [84.20, 26.10]),
                    ([84.20, 26.10], [84.45, 26.70]),
                ],
            },
            {
                "id": "bihar_to_wb",
                "from_state": "Bihar / Jharkhand",
                "to_state": "West Bengal",
                "corridor_name": "Lower Gangetic Corridor (Bihar → West Bengal)",
                "agency": "West Bengal PCB & Bihar SPCB",
                "key_landmarks": "Farakka Barrage, Malda Gateway, Asansol–Dhanbad border",
                "policy_mandate": "Coordinated industrial cluster control along Asansol–Durgapur industrial corridor.",
                "segments": [
                    ([87.70, 24.50], [87.95, 25.10]),
                    ([87.95, 25.10], [88.20, 25.60]),
                ],
            },
        ],
        "gateways": [
            {"id": "gw_buxar", "name": "Buxar Ganga Gateway (NH-922)", "coordinates": [83.98, 25.58], "corridor": "UP → Bihar", "description": "Main transport entry point along the Ganga river valley towards Patna."},
            {"id": "gw_mohania", "name": "Mohania / GT Road Crossing", "coordinates": [83.65, 25.17], "corridor": "UP → Bihar", "description": "National highway freight transport and industrial drift corridor."},
            {"id": "gw_farakka", "name": "Farakka Barrage Corridor", "coordinates": [87.91, 24.81], "corridor": "Bihar → West Bengal", "description": "Downstream ventilation bottleneck into the Bengal delta."},
        ],
    },
    "singrauli_korba": {
        "id": "singrauli_korba",
        "name": "Central India Thermal & Mining Belt",
        "center": [82.70, 23.10],
        "zoom": 7.2,
        "bbox": [21.80, 24.60, 81.50, 84.50],
        "corridors": [
            {
                "id": "mp_to_up_singrauli",
                "from_state": "Madhya Pradesh",
                "to_state": "Uttar Pradesh",
                "corridor_name": "Rihand Reservoir Thermal Corridor (MP → UP)",
                "agency": "MPPCB & UPPCB Joint NGT Oversight",
                "key_landmarks": "NTPC Vindhyachal, Singrauli Super Thermal, Rihand Dam, Sonbhadra",
                "policy_mandate": "Mandate Flue Gas Desulfurization (FGD) and SCR/SNCR de-NOx systems on pit-head power units.",
                "segments": [
                    ([82.60, 24.05], [82.85, 24.15]),
                    ([82.85, 24.15], [83.15, 24.25]),
                ],
            },
            {
                "id": "cg_to_odisha_korba",
                "from_state": "Chhattisgarh",
                "to_state": "Odisha",
                "corridor_name": "Korba–Mahanadi Industrial Drift (CG → Odisha)",
                "agency": "Chhattisgarh Environment Board & Odisha SPCB",
                "key_landmarks": "Korba Super Thermal, Hasdeo River Basin, Raigarh Coalfields, Jharsuguda",
                "policy_mandate": "Joint ambient air monitoring and coal washery particulate limits along state borders.",
                "segments": [
                    ([83.10, 21.90], [83.40, 22.30]),
                    ([83.40, 22.30], [83.70, 22.70]),
                ],
            },
        ],
        "gateways": [
            {"id": "gw_shaktinagar", "name": "Shaktinagar / Rihand Reservoir", "coordinates": [82.78, 24.12], "corridor": "MP → UP", "description": "Direct interstate corridor between NTPC Vindhyachal (MP) and Sonbhadra (UP)."},
            {"id": "gw_anpara", "name": "Anpara Thermal Hub Crossing", "coordinates": [82.95, 24.20], "corridor": "MP → UP", "description": "Thermal power cluster cross-border plume transport point."},
            {"id": "gw_raigarh", "name": "Raigarh–Jharsuguda Interstate Border", "coordinates": [83.50, 22.15], "corridor": "Chhattisgarh → Odisha", "description": "Aluminium smelting and sponge iron transport corridor."},
        ],
    },
}


def calculate_transboundary_flux(
    no2_grid: np.ndarray,
    u_grid: np.ndarray,
    v_grid: np.ndarray,
    meta: dict[str, Any] | None = None,
    target_region: str = "delhi",
) -> dict[str, Any]:
    """Calculate transboundary NO2 flux across state and international borders for any of the 4 key regions."""
    res = float(meta.get("res_deg", 0.5)) if meta else 0.5

    spec = AIRSHED_SPECS.get(target_region, AIRSHED_SPECS["delhi"])
    region_id = spec["id"]
    region_name = spec["name"]
    center = spec["center"]
    recommended_zoom = spec["zoom"]
    bbox = spec["bbox"]

    corridor_results = []
    total_inflow = 0.0
    total_outflow = 0.0
    arrow_vectors: list[dict[str, Any]] = []

    for c in spec["corridors"]:
        c_inflow = 0.0
        c_outflow = 0.0
        c_no2 = []
        c_u = []
        c_v = []
        c_midpoints = []

        for p1, p2 in c["segments"]:
            res_seg = _segment_flux(p1, p2, no2_grid, u_grid, v_grid, res=res)
            c_inflow += res_seg["inflow_tonnes_day"]
            c_outflow += res_seg["outflow_tonnes_day"]
            c_no2.append(res_seg["mean_no2"])
            c_u.append(res_seg["mean_u"])
            c_v.append(res_seg["mean_v"])
            c_midpoints.append(res_seg["midpoint"])

        mean_u = float(np.mean(c_u)) if c_u else 0.0
        mean_v = float(np.mean(c_v)) if c_v else 0.0
        mean_no2 = float(np.mean(c_no2)) if c_no2 else 0.0
        wind_speed = math.hypot(mean_u, mean_v)
        wind_from_deg = (math.degrees(math.atan2(-mean_u, -mean_v)) + 360.0) % 360.0
        wind_to_deg = (math.degrees(math.atan2(mean_u, mean_v)) + 360.0) % 360.0

        total_inflow += c_inflow
        total_outflow += c_outflow

        all_lons = [m[0] for m in c_midpoints]
        all_lats = [m[1] for m in c_midpoints]
        mid_lon = float(np.mean(all_lons))
        mid_lat = float(np.mean(all_lats))

        arrow_len = 0.22 if region_id != "delhi" else 0.16
        arrow_dx = arrow_len * math.sin(math.radians(wind_to_deg))
        arrow_dy = arrow_len * math.cos(math.radians(wind_to_deg))

        flux_val = c_inflow if c_inflow > c_outflow else -c_outflow
        intensity = "severe" if abs(flux_val) > 40.0 else "high" if abs(flux_val) > 20.0 else "moderate" if abs(flux_val) > 8.0 else "low"

        arrow_vectors.append({
            "id": f"arrow_{c['id']}",
            "corridor_id": c["id"],
            "corridor_name": c["corridor_name"],
            "from_jurisdiction": c["from_state"],
            "to_jurisdiction": c["to_state"],
            "start": [round(mid_lon - arrow_dx * 0.5, 4), round(mid_lat - arrow_dy * 0.5, 4)],
            "end": [round(mid_lon + arrow_dx * 0.5, 4), round(mid_lat + arrow_dy * 0.5, 4)],
            "midpoint": [round(mid_lon, 4), round(mid_lat, 4)],
            "flux_tonnes_day": round(flux_val, 1),
            "is_inflow": c_inflow >= c_outflow,
            "wind_speed_ms": round(wind_speed, 1),
            "wind_heading_deg": round(wind_to_deg, 0),
            "intensity": intensity,
        })

        corridor_results.append({
            "id": c["id"],
            "from_jurisdiction": c["from_state"],
            "to_jurisdiction": c["to_state"],
            "corridor_name": c["corridor_name"],
            "agency": c["agency"],
            "key_landmarks": c["key_landmarks"],
            "policy_mandate": c["policy_mandate"],
            "inflow_tonnes_day": round(c_inflow, 1),
            "outflow_tonnes_day": round(c_outflow, 1),
            "net_flux_tonnes_day": round(c_inflow - c_outflow, 1),
            "mean_no2_umol_m2": round(mean_no2, 1),
            "wind_speed_ms": round(wind_speed, 1),
            "wind_direction": f"{round(wind_speed, 1)} m/s from {round(wind_from_deg, 0):.0f}°",
            "share_of_external_pct": 0.0,
        })

    # Ambient mass of region
    ambient_mass = _estimate_ambient_mass(no2_grid, bbox[0], bbox[1], bbox[2], bbox[3], res=res)
    turnover = ambient_mass * (24.0 / TAU_DAYTIME_HOURS)
    local_source = max(5.0, turnover - (total_inflow - total_outflow))
    total_input = total_inflow + local_source

    if total_input > 0:
        external_pct = min(88.0, max(12.0, round((total_inflow / total_input) * 100.0, 1)))
    else:
        external_pct = 38.0

    for item in corridor_results:
        item["share_of_external_pct"] = round((item["inflow_tonnes_day"] / total_inflow) * 100.0, 1) if total_inflow > 0 else 0.0

    corridor_results.sort(key=lambda x: x["inflow_tonnes_day"], reverse=True)

    # Process Gateways with live sampled flux
    gateways = []
    for gw in spec.get("gateways", []):
        gw_lon, gw_lat = gw["coordinates"]
        gw_no2 = _sample_bilinear(no2_grid, gw_lon, gw_lat, res)
        gw_u = _sample_bilinear(u_grid, gw_lon, gw_lat, res)
        gw_v = _sample_bilinear(v_grid, gw_lon, gw_lat, res)
        gw_speed = math.hypot(gw_u, gw_v)
        gw_heading = (math.degrees(math.atan2(gw_u, gw_v)) + 360.0) % 360.0

        # Approximate gateway width ~ 10 km
        gw_flux_tpd = round(max(0.0, gw_no2) * UMOL_TO_G_M2 * gw_speed * 10_000.0 * DAY_SECONDS * 1e-6, 1)
        intensity = "severe" if gw_flux_tpd > 35 else "high" if gw_flux_tpd > 18 else "moderate" if gw_flux_tpd > 6 else "low"

        gateways.append({
            **gw,
            "mean_no2_umol_m2": round(gw_no2, 1),
            "wind_speed_ms": round(gw_speed, 1),
            "wind_heading_deg": round(gw_heading, 0),
            "flux_tonnes_day": gw_flux_tpd,
            "intensity": intensity,
        })

    # Available regions list for UI selector
    available_regions = [
        {"id": k, "name": v["name"], "center": v["center"], "zoom": v["zoom"]}
        for k, v in AIRSHED_SPECS.items()
    ]

    short_target = "Delhi's" if region_id == "delhi" else f"{region_name}'s"
    headline = f"{external_pct:.0f}% of {short_target} NO₂ today arrived from outside the city." if region_id == "delhi" else f"{external_pct:.0f}% of {region_name}'s NO₂ today arrived from neighbouring jurisdictions."

    legal_evidence_brief = (
        f"OFFICIAL ATMOSPHERIC FLUX ASSESSMENT FOR CAQM, CPCB & APPELLATE COURTS\n"
        f"-----------------------------------------------------------------------\n"
        f"Airshed Conflict Zone: {region_name} (ID: {region_id})\n"
        f"Primary Verdict: {external_pct}% of ambient column arrived from external upwind jurisdictions today.\n"
        f"Gross External Inflow: {total_inflow:.1f} metric tonnes/day.\n"
        f"Gross Downwind Export: {total_outflow:.1f} metric tonnes/day.\n"
        f"Net Airshed Accumulation: {total_inflow - total_outflow:+.1f} tonnes/day.\n"
        f"Active Airshed Mass: {ambient_mass:.1f} tonnes.\n"
        f"Lead Contributing Corridor: {corridor_results[0]['corridor_name']} ({corridor_results[0]['inflow_tonnes_day']} t/d, {corridor_results[0]['share_of_external_pct']}% of external ingress).\n"
        f"Statutory Mandate: {corridor_results[0]['policy_mandate']}\n"
        f"Coupled Instruments: Sentinel-5P NRTI tropospheric NO2 + NOAA GFS 0.25° 10m velocity vectors."
    )

    return {
        "status": "ready",
        "fetched_at": meta.get("fetched_at") if meta else None,
        "region_id": region_id,
        "region_name": region_name,
        "center": center,
        "zoom": recommended_zoom,
        "available_regions": available_regions,
        "summary": {
            "headline": headline,
            "external_attribution_pct": external_pct,
            "inflow_tonnes_day": round(total_inflow, 1),
            "outflow_tonnes_day": round(total_outflow, 1),
            "net_flux_tonnes_day": round(total_inflow - total_outflow, 1),
            "ambient_mass_tonnes": round(ambient_mass, 1),
            "daily_turnover_tonnes": round(turnover, 1),
            "corridors": corridor_results,
            "gateways": gateways,
        },
        # Backward compatibility for existing Delhi summary consumers
        "delhi_summary": {
            "headline": headline,
            "external_attribution_pct": external_pct,
            "inflow_tonnes_day": round(total_inflow, 1),
            "outflow_tonnes_day": round(total_outflow, 1),
            "net_flux_tonnes_day": round(total_inflow - total_outflow, 1),
            "ambient_mass_tonnes": round(ambient_mass, 1),
            "daily_turnover_tonnes": round(turnover, 1),
            "corridors": corridor_results,
        },
        "vectors": arrow_vectors,
        "gateways": gateways,
        "legal_evidence_brief": legal_evidence_brief,
    }
