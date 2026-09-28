"""Area-level NO2 analysis behind the reports.

Every number that appears in a report is computed here, from the ML engine's outputs for one run:
comparison with air-quality standards, hotspots and their likely contributors, population exposure,
forecast alerts (dispersion solver) and the weather-adjusted trend. The language model only phrases
these facts; it never produces numbers.
"""

from __future__ import annotations

import json
import logging
import math
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
from scipy import ndimage

from ..cities import STATIONS_CSV
from ..config import PRETRAINED_SURFACE_MODEL, DispersionConfig
from ..dispersion import AdvectionDiffusionSolver
from ..export import HAZARD_BANDS
from ..grid import GridSpec, upsample_bilinear

log = logging.getLogger(__name__)

NAAQS_24H = 80.0  # CPCB National Ambient Air Quality Standard, NO2 24-hour mean (ug/m3)
NAAQS_ANNUAL = 40.0  # CPCB NAAQS, NO2 annual mean (ug/m3)
WHO_24H = 25.0  # WHO 2021 air quality guideline, NO2 24-hour mean (ug/m3)
HAZARDOUS = 180.0  # SRS hazard scale: above this is "Hazardous"
BAND_KEYS = {1: "normal", 2: "moderate", 3: "unhealthy", 4: "hazardous"}
FORECAST_HOURS = (3, 6, 12, 24)
GHSL_CELL_M2 = 100.0 * 100.0  # GHSL population counts are per 100 m cell
HOTSPOT_SMOOTH_PX = 2.0
HOTSPOT_SEPARATION_PX = 10  # ~2.6 km between reported hotspots
NEAR_STATION_KM = 6.0
MIN_TREND_DAYS = 10
FACTS_VERSION = 6  # bump when the facts change, to recompute cached analyses (2: satellite column, 3-4: anomalies)


def classify_status(area_mean: float, share_above_standard: float) -> str:
    """Area status from the SRS scale and the national 24 h standard.

    critical_spike: area average in the Hazardous band (> 180); critical: area average above the
    80 ug/m3 standard; elevated: above the Normal band (> 40) or >= 5% of the area above the standard;
    normal otherwise.
    """
    if area_mean > HAZARDOUS:
        return "critical_spike"
    if area_mean > NAAQS_24H:
        return "critical"
    if area_mean > 40.0 or share_above_standard >= 0.05:
        return "elevated"
    return "normal"


def band_key(value: float) -> str:
    for band in HAZARD_BANDS:
        if band["min"] <= value < band["max"]:
            return BAND_KEYS[band["code"]]
    return "normal"


def _band_codes(values: np.ndarray) -> np.ndarray:
    codes = np.zeros(values.shape, dtype=np.int8)
    for band in HAZARD_BANDS:
        codes[(values >= band["min"]) & (values < band["max"])] = band["code"]
    return codes


def _column(run_dir: Path, raw: np.ndarray | None, t: int) -> dict | None:
    """The Sentinel-5P tropospheric NO2 column on the report day, in µmol/m² (the run's unit; ×1e-6 = mol/m²):
    mean and highest of the clear (observed) pixels, and the area mean after cloud gap-filling."""
    if raw is None:
        return None
    raw = raw.astype(np.float64)
    observed = np.isfinite(raw)
    out = {"observed_mean": round(float(np.nanmean(raw)), 2) if observed.any() else None,
           "observed_max": round(float(np.nanmax(raw)), 2) if observed.any() else None,
           "cloud_share": float(1 - observed.mean()), "filled_mean": None, "units": "umol m-2"}
    path = run_dir / "coarse_gapfilled.nc"
    if path.exists():
        filled = xr.load_dataset(path, engine="h5netcdf")["no2"].isel(time=t).values.astype(np.float64)
        out["filled_mean"] = round(float(np.nanmean(filled)), 2)
    return out


def _load_run(run_dir: Path):
    report = json.loads((run_dir / "report.json").read_text())
    surface = xr.load_dataset(run_dir / "no2_surface_fine.nc", engine="h5netcdf")["no2_surface"]
    coarse = xr.load_dataset(run_dir / "coarse_raw.nc", engine="h5netcdf")
    static_path = run_dir / "static_fine.nc"
    static = xr.load_dataset(static_path, engine="h5netcdf") if static_path.exists() else None
    return report, surface, coarse, static


def _stations() -> pd.DataFrame | None:
    try:
        return pd.read_csv(STATIONS_CSV)
    except OSError:
        return None


def _place_name(lat: float, lon: float, stations: pd.DataFrame | None) -> str:
    """Name a location after the nearest CPCB monitoring station (offline), else its coordinates."""
    if stations is not None and len(stations):
        km = np.hypot((stations["lat"] - lat) * 110.57, (stations["lon"] - lon) * 111.32 * math.cos(math.radians(lat)))
        i = int(np.argmin(km.to_numpy()))
        if km.iloc[i] <= NEAR_STATION_KM:
            name = str(stations["station_name"].iloc[i])
            return name.split(",")[0].strip() if "," in name else name.split(" - ")[0].strip()
    return f"{lat:.3f}°N, {lon:.3f}°E"


def _share(mask: np.ndarray, valid: np.ndarray) -> float:
    return float(mask[valid].mean()) if valid.any() else 0.0


def _hotspots(surface: np.ndarray, grid: GridSpec, static: xr.Dataset | None, stations, n: int = 3) -> list[dict]:
    filled = np.where(np.isfinite(surface), surface, np.nanmean(surface))
    smooth = ndimage.gaussian_filter(filled, HOTSPOT_SMOOTH_PX)
    layers, pct = {}, {}
    if static is not None:
        for name in ("road_density", "night_lights", "ghsl_built", "power_plants"):
            if name in static:
                arr = np.nan_to_num(static[name].values.astype(np.float64), nan=0.0)
                layers[name] = ndimage.gaussian_filter(arr, HOTSPOT_SMOOTH_PX)
                pct[name] = (np.percentile(layers[name], 80), np.percentile(layers[name], 90))
    out, work = [], smooth.copy()
    rows, cols = np.mgrid[0:grid.height, 0:grid.width]
    for rank in range(1, n + 1):
        r, c = np.unravel_index(int(np.argmax(work)), work.shape)
        if not np.isfinite(work[r, c]) or work[r, c] == -np.inf:
            break
        window = filled[max(r - 2, 0):r + 3, max(c - 2, 0):c + 3]
        lat, lon = float(grid.y[r]), float(grid.x[c])
        sources = []
        if "road_density" in layers and layers["road_density"][r, c] >= pct["road_density"][0]:
            sources.append("traffic")
        if "power_plants" in layers and layers["power_plants"][r, c] >= max(pct["power_plants"][1], math.log1p(50.0)):
            sources.append("power_plant")
        if ("night_lights" in layers and "ghsl_built" in layers
                and layers["night_lights"][r, c] >= pct["night_lights"][0]
                and layers["ghsl_built"][r, c] >= pct["ghsl_built"][0]):
            sources.append("dense_urban")
        out.append({"rank": rank, "lat": round(lat, 4), "lon": round(lon, 4),
                    "value": round(float(np.max(window)), 1), "band": band_key(float(np.max(window))),
                    "near": _place_name(lat, lon, stations), "sources": sources or ["background"]})
        work[(rows - r) ** 2 + (cols - c) ** 2 <= HOTSPOT_SEPARATION_PX ** 2] = -np.inf
    return out


def _population(surface: np.ndarray, grid: GridSpec, static: xr.Dataset | None) -> dict | None:
    if static is None or "population" not in static:
        return None
    dx, dy = grid.pixel_size_m()
    # GHSL marks no-data (open sea) as -200: count no one there.
    people = np.clip(np.nan_to_num(static["population"].values.astype(np.float64), nan=0.0), 0, None) * dx * dy / GHSL_CELL_M2
    valid = np.isfinite(surface)
    total = float(people[valid].sum())
    if total <= 0:
        return None
    codes = _band_codes(np.where(valid, surface, -1.0))
    by_band = {BAND_KEYS[k]: float(people[codes == k].sum()) for k in BAND_KEYS}
    above_naaqs = float(people[valid & (surface > NAAQS_24H)].sum())
    above_who = float(people[valid & (surface > WHO_24H)].sum())
    return {
        "total": round(total), "by_band": {k: round(v) for k, v in by_band.items()},
        "above_naaqs": round(above_naaqs), "above_who": round(above_who),
        "share_above_naaqs": above_naaqs / total, "share_above_who": above_who / total,
        "weighted_mean": round(float((people[valid] * surface[valid]).sum() / total), 1),
    }


def _compass_index(deg: float) -> int:
    return int(((deg % 360) + 22.5) // 45) % 8


def _forecast(surface: np.ndarray, grid: GridSpec, coarse_day: xr.Dataset, factor: int,
              current_share: float, current_max: float, hotspot_name: str | None) -> dict:
    u = upsample_bilinear(coarse_day["u10"].values.astype(np.float64), factor)
    v = upsample_bilinear(coarse_day["v10"].values.astype(np.float64), factor)
    solver = AdvectionDiffusionSolver(grid, DispersionConfig(horizons_h=tuple(float(h) for h in FORECAST_HOURS)))
    fc = solver.forecast(surface, u, v)
    valid = np.isfinite(surface)
    horizons = []
    for h in FORECAST_HOURS:
        f = fc.sel(horizon_h=float(h)).values
        horizons.append({"hours": h, "mean": round(float(np.nanmean(f[valid])), 1), "max": round(float(np.nanmax(f[valid])), 1),
                         "share_above_naaqs": _share(f > NAAQS_24H, valid)})
    um, vm = float(np.mean(u)), float(np.mean(v))
    wind_from = (math.degrees(math.atan2(-um, -vm)) + 360) % 360
    alerts = []
    exceed = [hz for hz in horizons if hz["share_above_naaqs"] >= 0.05]
    if current_share >= 0.05 and len(exceed) == len(horizons):
        alerts.append({"code": "persisting", "level": "critical", "hours": 24, "share": horizons[-1]["share_above_naaqs"]})
    elif current_share < 0.05 and exceed:
        first = exceed[0]
        alerts.append({"code": "exceedance_expected", "level": "warning", "hours": first["hours"], "share": first["share_above_naaqs"]})
    elif current_share >= 0.05 and horizons[-1]["share_above_naaqs"] < current_share - 0.05:
        alerts.append({"code": "improving", "level": "info", "hours": 24, "share": horizons[-1]["share_above_naaqs"]})
    if not alerts:
        peaks = [hz for hz in horizons if hz["max"] > NAAQS_24H]
        if peaks:
            alerts.append({"code": "localized_peak", "level": "warning", "hours": peaks[0]["hours"],
                           "share": peaks[0]["share_above_naaqs"], "place": hotspot_name})
        else:
            alerts.append({"code": "no_exceedance", "level": "info", "hours": 24, "share": 0.0})
    return {"wind_speed": round(math.hypot(um, vm), 1), "wind_from_deg": round(wind_from),
            "wind_compass": _compass_index(wind_from), "horizons": horizons, "alerts": alerts}


def weather_adjusted_trend(dates: pd.DatetimeIndex, observed: np.ndarray, weather: dict[str, np.ndarray],
                           report_index: int, alpha: float = 1.0) -> dict | None:
    """Separate weather-driven from emission-driven change in the daily area-average NO2.

    A ridge regression of the daily area mean on standardised weather (boundary-layer height, wind speed,
    temperature, rain) estimates how much each day's weather pushed NO2 up or down; subtracting that gives
    the weather-adjusted series, whose slope is the emission-related trend.
    """
    y = np.asarray(observed, dtype=np.float64)
    names = [k for k, v in weather.items() if v is not None and np.isfinite(v).all() and np.std(v) > 0]
    ok = np.isfinite(y)
    if ok.sum() < MIN_TREND_DAYS or not names:
        return None
    X = np.column_stack([(weather[k] - weather[k].mean()) / weather[k].std() for k in names])
    Xo, yo = X[ok], y[ok]

    def fit(Xf, yf):
        beta = np.linalg.solve(Xf.T @ Xf + alpha * np.eye(Xf.shape[1]), Xf.T @ (yf - yf.mean()))
        return beta, yf.mean()

    beta, mean = fit(Xo, yo)
    effect = X @ beta
    adjusted = y - effect
    # Leave-one-out skill of the weather model (in-sample R2 flatters a 30-point fit).
    loo = np.empty(len(yo))
    for i in range(len(yo)):
        keep = np.arange(len(yo)) != i
        b, m = fit(Xo[keep], yo[keep])
        loo[i] = m + Xo[i] @ b
    sst = float(((yo - yo.mean()) ** 2).sum())
    r2 = max(0.0, 1.0 - float(((yo - loo) ** 2).sum()) / sst) if sst > 0 else 0.0

    t = np.arange(len(y), dtype=np.float64)[ok]

    def slope_stats(series):
        s, c = np.polyfit(t, series, 1)
        resid = series - (s * t + c)
        se = math.sqrt(float((resid ** 2).sum()) / max(len(t) - 2, 1) / float(((t - t.mean()) ** 2).sum()))
        return s, (s / se if se > 0 else 0.0)

    s_obs, _ = slope_stats(yo)
    s_adj, t_adj = slope_stats(adjusted[ok])
    direction = "stable"
    if abs(t_adj) > 2.0:
        direction = "rising" if s_adj > 0 else "falling"
    effect_today = float(effect[report_index]) if 0 <= report_index < len(effect) else 0.0
    role = "neutral" if abs(effect_today) < 2.0 else ("raised" if effect_today > 0 else "lowered")
    return {
        "dates": [str(d.date()) for d in dates],
        "observed": [round(float(v), 1) for v in y],
        "adjusted": [round(float(v), 1) for v in adjusted],
        "days": int(ok.sum()),
        "weather_vars": names,
        "weather_r2": round(r2, 2),
        "slope_observed_per_week": round(float(s_obs * 7), 1),
        "slope_adjusted_per_week": round(float(s_adj * 7), 1),
        "direction": direction,
        "weather_effect_today": round(effect_today, 1),
        "weather_role": role,
    }


UPWIND_KM = 5.0  # compare each place with the air arriving from this far upwind
BASELINE_DAYS = 7  # a place's own recent history for spike detection
MAX_ANOMALIES = 5


def _anomalies(surface_all: xr.DataArray, t: int, grid: GridSpec, static: xr.Dataset | None, coarse: xr.Dataset,
               stations) -> list[dict]:
    """Places that break the guidelines or behave unusually on the report day, with likely reasons.

    * ``exceedance``: above the CPCB 24-h limit (80 µg/m³).
    * ``spike``: far above the place's own median of the previous ``BASELINE_DAYS`` days.
    * ``local_source`` (qualifier of the two above): also far above the air arriving from ``UPWIND_KM`` upwind -
      against the flow, so the extra NO2 is produced here rather than transported.
    Reasons come from the model's inputs at the place (roads, power plants, dense activity) and the day's
    weather (stagnant wind, shallow mixing layer); none nearby -> possible unlisted source.
    """
    surface = surface_all.isel(time=t).values.astype(np.float64)
    valid = np.isfinite(surface)
    if not valid.any():
        return []
    filled = np.where(valid, surface, np.nanmean(surface))
    smooth = ndimage.gaussian_filter(filled, 1.0)
    p75, p90 = np.nanpercentile(surface, 75), np.nanpercentile(surface, 90)
    # open water (negative NDVI): not a place of activity, and clean sea air is no fair upwind comparison
    water = (np.nan_to_num(static["ndvi"].values, nan=1.0) < 0.0) if static is not None and "ndvi" in static         else np.zeros(surface.shape, bool)
    valid = valid & ~water

    # 1. guideline exceedance
    exceed = valid & (smooth > NAAQS_24H)

    # 2. spike against the place's own recent days
    spike = np.zeros_like(valid)
    baseline = None
    if t >= 3:
        past = surface_all.isel(time=slice(max(0, t - BASELINE_DAYS), t)).values.astype(np.float64)
        baseline = ndimage.gaussian_filter(np.nan_to_num(np.nanmedian(past, axis=0), nan=float(np.nanmean(past))), 1.0)
        spike = valid & (smooth - baseline > np.maximum(15.0, 0.5 * baseline)) & (smooth > p75)

    # 3. against the flow: much higher than the upwind air
    day = coarse.isel(time=t)
    u = float(np.nanmean(day["u10"].values)) if "u10" in day else 0.0
    v = float(np.nanmean(day["v10"].values)) if "v10" in day else 0.0
    speed = math.hypot(u, v)
    local = np.zeros_like(valid)
    upwind = None
    if speed > 1.0:
        dx_m, dy_m = grid.pixel_size_m()
        cells_x = UPWIND_KM * 1000 / dx_m * (u / speed)
        cells_y = UPWIND_KM * 1000 / dy_m * (v / speed)
        # value that arrives here = the field shifted downwind by the upwind distance (rows run southwards)
        upwind = ndimage.shift(smooth, (-cells_y, cells_x), order=1, mode="nearest")
        upwind_water = ndimage.shift(water.astype(float), (-cells_y, cells_x), order=1, mode="nearest") > 0.3
        local = valid & ~upwind_water & (smooth - upwind > np.maximum(15.0, 0.5 * upwind)) & (smooth > p90)

    # a built-up place is always above the greener land upwind of it (that is how the map is shaped), so
    # "against the flow" only qualifies places that also break the limit or are unusual for themselves
    flagged = exceed | spike
    if not flagged.any():
        return []

    # weather context of the day vs the period
    blh_low = False
    if "blh" in coarse:
        blh_series = coarse["blh"].mean(dim=("y", "x")).values.astype(np.float64)
        blh_low = bool(np.isfinite(blh_series[t]) and blh_series[t] < 0.8 * np.nanmedian(blh_series))
    stagnant = speed < 1.5

    layers, pct = {}, {}
    if static is not None:
        for name in ("road_density", "night_lights", "ghsl_built", "power_plants"):
            if name in static:
                arr = ndimage.gaussian_filter(np.nan_to_num(static[name].values.astype(np.float64), nan=0.0), 2.0)
                layers[name], pct[name] = arr, (np.percentile(arr, 80), np.percentile(arr, 90))

    labels, n = ndimage.label(flagged)
    found = []
    for k in range(1, n + 1):
        blob = labels == k
        cells = int(blob.sum())
        if cells < 2:
            continue
        r, c = np.unravel_index(int(np.argmax(np.where(blob, smooth, -np.inf))), smooth.shape)
        # flags describe the cluster's peak (the numbers shown for it)
        kinds = [name for name, mask in (("exceedance", exceed), ("spike", spike), ("local_source", local)) if mask[r, c]]
        if not any(k in kinds for k in ("exceedance", "spike")):
            kinds = [name for name, mask in (("exceedance", exceed), ("spike", spike)) if (mask & blob).any()] +                     (["local_source"] if local[r, c] else [])
        reasons = []
        if "road_density" in layers and layers["road_density"][r, c] >= pct["road_density"][0]:
            reasons.append("traffic")
        if "power_plants" in layers and layers["power_plants"][r, c] >= max(pct["power_plants"][1], math.log1p(50.0)):
            reasons.append("power_plant")
        if ("night_lights" in layers and "ghsl_built" in layers and layers["night_lights"][r, c] >= pct["night_lights"][0]
                and layers["ghsl_built"][r, c] >= pct["ghsl_built"][0]):
            reasons.append("dense_urban")
        if not reasons:
            reasons.append("unlisted")
        if stagnant:
            reasons.append("stagnant")
        if blh_low:
            reasons.append("low_mixing")
        lat, lon = float(grid.y[r]), float(grid.x[c])
        dx_m, dy_m = grid.pixel_size_m()
        found.append({
            "kinds": kinds, "reasons": reasons, "lat": round(lat, 4), "lon": round(lon, 4),
            "near": _place_name(lat, lon, stations), "value": round(float(smooth[r, c]), 1),
            "baseline": round(float(baseline[r, c]), 1) if baseline is not None else None,
            "upwind": round(float(upwind[r, c]), 1) if upwind is not None else None,
            "area_km2": round(cells * dx_m * dy_m / 1e6, 1),
            "severity": "high" if "exceedance" in kinds or len(kinds) > 1 else "medium",
            "score": float(smooth[r, c] - min(filter(None, [baseline[r, c] if baseline is not None else None,
                                                             upwind[r, c] if upwind is not None else None,
                                                             NAAQS_24H]))),
        })
    found.sort(key=lambda a: (a["severity"] != "high", -a["score"]))
    for a in found:
        a.pop("score")
    return found[:MAX_ANOMALIES]


def _pretrained_accuracy() -> dict:
    path = PRETRAINED_SURFACE_MODEL.with_name(PRETRAINED_SURFACE_MODEL.stem + "_report.json")
    try:
        r = json.loads(path.read_text())
        best = r["evaluations"]["unseen_cities"]["candidates"][r["selected"]]["overall"]
        return {"unseen_city_r2": round(float(best["r2"]), 2), "rmse": round(float(best["rmse"]))}
    except (OSError, KeyError, ValueError):
        return {"unseen_city_r2": None, "rmse": None}


NO_FORECAST = {"wind_speed": None, "wind_from_deg": None, "wind_compass": None, "horizons": [], "alerts": []}


def _section(name: str, fn, default):
    """One optional report section; a failure leaves it out instead of failing the whole report."""
    try:
        return fn()
    except Exception:  # noqa: BLE001 - any failure in an optional section
        log.exception("Report section %r failed; leaving it out", name)
        return default


def analyse_run(run_dir: str | Path, date: str, area_name: str) -> dict:
    """All report facts for ``date`` from one pipeline run directory, cached in the run directory (the
    24-hour dispersion forecast takes a few seconds; reports must come back within ~15 s)."""
    run_dir = Path(run_dir)
    cache = run_dir / f"report_facts_v{FACTS_VERSION}_{pd.Timestamp(date).date()}.pkl"
    facts = None
    if cache.exists():
        try:
            facts = pickle.loads(cache.read_bytes())
        except Exception:  # noqa: BLE001 - unreadable cache: recompute
            log.warning("Ignoring unreadable facts cache %s", cache)
    if facts is None:
        facts = _compute_facts(run_dir, date)
        try:
            cache.write_bytes(pickle.dumps(facts))
        except OSError:
            log.warning("Could not write facts cache %s", cache)
    facts["area"]["name"] = area_name
    # live parts (not cached): the drone's DCP haze readings and the pre-inspection flight plans built on them
    facts["haze"] = _section("haze", lambda: _haze_summary(), None)
    facts["flight_plans"] = _section("flight_plans", lambda: _flight_plans(run_dir, facts), [])
    return facts


def _haze_summary() -> dict | None:
    from .haze import summary

    return summary(max_age_h=72)


def _flight_plans(run_dir: Path, facts: dict) -> list[dict]:
    from .flightplan import plans_for, route_map_data_uri
    from .pdf import _colourise

    static_path = run_dir / "static_fine.nc"
    static = xr.load_dataset(static_path, engine="h5netcdf") if static_path.exists() else None
    latest = (facts.get("haze") or {}).get("latest")
    plans = plans_for(facts, static, facts.get("grid"), latest)
    surface_map = facts.get("surface_map")
    grid = facts.get("grid")
    water_mask = facts.get("water_mask")
    for p in plans:
        try:
            p["map_data_uri"] = route_map_data_uri(p, surface_map, grid, _colourise, water=water_mask)
        except Exception:
            p["map_data_uri"] = None
        if p.get("relocation"):
            try:
                p["relocation"]["map_data_uri"] = route_map_data_uri(p["relocation"], surface_map, grid, _colourise, water=water_mask)
            except Exception:
                p["relocation"]["map_data_uri"] = None
    return plans


def _compute_facts(run_dir: Path, date: str, area_name: str = "") -> dict:
    report, surface_all, coarse, static = _load_run(run_dir)
    grid = GridSpec(**report["grids"]["fine"])
    factor = int(report["config"]["refine_factor"])
    dates = pd.DatetimeIndex(surface_all["time"].values).normalize()
    day = pd.Timestamp(date).normalize()
    if day not in dates:
        raise ValueError(f"{day.date()} is not in this run ({dates[0].date()}..{dates[-1].date()})")
    t = int(dates.get_loc(day))
    surface = surface_all.isel(time=t).values.astype(np.float64)
    valid = np.isfinite(surface)
    stations = _stations()

    area_mean = float(np.nanmean(surface))
    share_naaqs = _share(surface > NAAQS_24H, valid)
    share_who = _share(surface > WHO_24H, valid)
    codes = _band_codes(np.where(valid, surface, -1.0))
    r, c = np.unravel_index(int(np.nanargmax(surface)), surface.shape)
    window_mean = float(np.nanmean(surface_all.values))
    status = classify_status(area_mean, share_naaqs)
    hotspots = _section("hotspots", lambda: _hotspots(surface, grid, static, stations), [])

    coarse_day = coarse.isel(time=t)
    forecast = _section("forecast", lambda: _forecast(surface, grid, coarse_day, factor, share_naaqs,
                                                      float(np.nanmax(surface)), hotspots[0]["near"] if hotspots else None),
                        dict(NO_FORECAST))

    daily_mean = np.array([float(np.nanmean(surface_all.isel(time=i).values)) for i in range(len(dates))])
    weather = {}
    if "blh" in coarse:
        weather["blh"] = coarse["blh"].mean(dim=("y", "x")).values.astype(np.float64)
    if "u10" in coarse and "v10" in coarse:
        weather["wind_speed"] = np.hypot(coarse["u10"], coarse["v10"]).mean(dim=("y", "x")).values.astype(np.float64)
    for name in ("t2m", "tp"):
        if name in coarse:
            weather[name] = coarse[name].mean(dim=("y", "x")).values.astype(np.float64)
    trend = _section("trend", lambda: weather_adjusted_trend(dates, daily_mean, weather, t), None)

    raw_no2 = coarse["no2"].isel(time=t).values if "no2" in coarse else None
    column = _section("column", lambda: _column(run_dir, raw_no2, t), None)
    anomalies = _section("anomalies", lambda: _anomalies(surface_all, t, grid, static, coarse, stations), [])
    return {
        "area": {"name": area_name, "bbox": [round(v, 3) for v in grid.bbox],
                 "centre": [round((grid.south + grid.north) / 2, 3), round((grid.west + grid.east) / 2, 3)]},
        "date": str(day.date()),
        "window": {"start": str(dates[0].date()), "end": str(dates[-1].date()), "days": len(dates)},
        "standards": {"naaqs_24h": NAAQS_24H, "naaqs_annual": NAAQS_ANNUAL, "who_24h": WHO_24H, "hazardous": HAZARDOUS},
        "current": {
            "mean": round(area_mean, 1),
            "median": round(float(np.nanmedian(surface)), 1),
            "p95": round(float(np.nanpercentile(surface, 95)), 1),
            "max": round(float(np.nanmax(surface)), 1),
            "max_location": [round(float(grid.y[r]), 4), round(float(grid.x[c]), 4)],
            "max_near": _place_name(float(grid.y[r]), float(grid.x[c]), stations),
            "share_above_naaqs": share_naaqs,
            "share_above_who": share_who,
            "band_shares": {BAND_KEYS[k]: _share(codes == k, valid) for k in BAND_KEYS},
            "pct_vs_naaqs": round((area_mean - NAAQS_24H) / NAAQS_24H * 100, 1),
            "band": band_key(area_mean),
            "status": status,
        },
        "window_stats": {"mean": round(window_mean, 1),
                         "pct_vs_annual": round((window_mean - NAAQS_ANNUAL) / NAAQS_ANNUAL * 100, 1)},
        "hotspots": hotspots,
        "population": _section("population", lambda: _population(surface, grid, static), None),
        "forecast": forecast,
        "trend": trend,
        "model": {
            "gapfill_r2": round(float(report["gapfill_holdout"]["all"]["r2"]), 2),
            "downscale_r2": round(float(report["downscaler"]["temporal_holdout_coarse"]["r2"]), 2),
            **_pretrained_accuracy(),
        },
        "column": column,
        "anomalies": anomalies,
        "data": {
            "s5p_product": report["config"].get("s5p_product", "OFFL"),
            "cloudy_share_day": float(np.isnan(raw_no2).mean()) if raw_no2 is not None else None,
            "resolution_m": round(grid.res * 111_320 * math.cos(math.radians((grid.south + grid.north) / 2))),
        },
        "surface_map": surface,  # for the PDF figure; removed before JSON / LLM use
        # open water (negative NDVI) is shown muted on the map
        "water_mask": (np.nan_to_num(static["ndvi"].values, nan=1.0) < 0.0) if static is not None and "ndvi" in static else None,
        "grid": grid,
    }
