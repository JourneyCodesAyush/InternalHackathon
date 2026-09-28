"""Natural-language explainability summaries from SHAP values.

Converts mathematical SHAP values into clean, government-grade English sentences:
e.g.: "Road density contributed 41%, low wind speed contributed 28%, built-up area contributed 17%."
"""

from __future__ import annotations

from typing import Any, Sequence

FEATURE_PRETTY_NAMES: dict[str, str] = {
    "road_density": "Road density",
    "built_up": "Built-up area fraction",
    "ghsl_built": "Urban settlement density",
    "wind_speed": "Wind speed",
    "blh": "Boundary layer height",
    "t2m": "Surface temperature",
    "sp": "Surface pressure",
    "u10": "Eastward wind component",
    "v10": "Northward wind component",
    "elevation": "Topographic elevation",
    "slope": "Terrain slope",
    "ndvi": "Vegetation index (NDVI)",
    "night_lights": "Nighttime luminosity",
    "population": "Population density",
    "power_plants": "Power plant proximity",
    "no2_ring": "Regional background plume",
    "no2_day_mean": "Daily baseline NO₂",
    "doy_sin": "Seasonal cycle (sin)",
    "doy_cos": "Seasonal cycle (cos)",
}


def pretty_name(feat: str) -> str:
    return FEATURE_PRETTY_NAMES.get(feat, feat.replace("_", " ").title())


def compute_relative_contributions(
    shap_values: Sequence[float],
    feature_names: Sequence[str],
    feature_values: Sequence[float] | None = None,
) -> list[dict[str, Any]]:
    """Compute relative percentage contributions from raw SHAP values."""
    abs_shaps = [abs(float(v)) for v in shap_values]
    total_abs = sum(abs_shaps)
    if total_abs <= 1e-6:
        total_abs = 1.0

    contributions = []
    for i, name in enumerate(feature_names):
        val = float(shap_values[i])
        pct = (abs_shaps[i] / total_abs) * 100.0
        actual_val = float(feature_values[i]) if feature_values is not None else None

        direction = "increases_no2" if val > 0 else "reduces_no2"
        qualifier = ""
        if name in ("wind_speed", "blh") and actual_val is not None:
            qualifier = "low " if actual_val < 3.0 or actual_val < 300 else "high "
        elif name in ("road_density", "built_up", "population") and actual_val is not None:
            qualifier = "dense " if actual_val > 0.5 else ""

        label = f"{qualifier}{pretty_name(name).lower()}".strip().capitalize()

        contributions.append({
            "feature": name,
            "feature_label": label,
            "shap_value": round(val, 3),
            "percentage": round(pct, 1),
            "direction": direction,
            "actual_value": round(actual_val, 2) if actual_val is not None else None,
        })

    # Sort descending by contribution percentage
    contributions.sort(key=lambda x: x["percentage"], reverse=True)
    return contributions


def generate_executive_explanation(
    contributions: list[dict[str, Any]],
    top_n: int = 3,
) -> str:
    """Generate the executive summary sentence requested:

    Example:
    "Road density contributed 41%, low wind speed contributed 28%, built-up area contributed 17%."
    """
    top = contributions[:top_n]
    if not top:
        return "Feature contribution analysis indicates balanced environmental dispersion."

    parts = [f"{item['feature_label']} contributed {item['percentage']:.0f}%" for item in top]
    return f"{', '.join(parts)}."


def generate_detailed_narrative(
    contributions: list[dict[str, Any]],
    predicted_val: float,
    base_val: float,
) -> str:
    """Produce a multi-sentence diagnostic report for regulators."""
    exec_summary = generate_executive_explanation(contributions, top_n=3)
    diff = predicted_val - base_val
    trend_desc = (
        f"rises {abs(diff):.1f} µg/m³ above the regional baseline"
        if diff > 0
        else f"is {abs(diff):.1f} µg/m³ below the regional baseline"
    )

    drivers = [c for c in contributions if c["direction"] == "increases_no2"]
    mitigators = [c for c in contributions if c["direction"] == "reduces_no2"]

    lines = [
        f"**Attribution Summary:** Local NO₂ concentration {trend_desc}. {exec_summary}",
    ]

    if drivers:
        primary_driver = drivers[0]
        lines.append(
            f"• **Primary Aggravating Factor:** {primary_driver['feature_label']} (+{primary_driver['shap_value']:.1f} µg/m³), "
            f"accounting for {primary_driver['percentage']:.0f}% of localized divergence."
        )

    if mitigators:
        primary_mitigator = mitigators[0]
        lines.append(
            f"• **Natural Dispersion Factor:** {primary_mitigator['feature_label']} (-{abs(primary_mitigator['shap_value']):.1f} µg/m³), "
            f"providing active dilution."
        )

    return "\n".join(lines)
