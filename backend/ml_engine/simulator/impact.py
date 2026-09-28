"""Impact analysis comparing baseline and simulated what-if forecasts.

Calculates:
- Peak NO₂ change (absolute and percentage)
- Exposed population change (people breathing > 80 µg/m³ CPCB limit)
- Plume displacement (spatial center-of-mass shift in km)
- Compliance difference (status changes e.g. CRITICAL -> COMPLIANT)
- Actionable policy recommendation
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

NAAQS_24H = 80.0
WHO_24H = 25.0


@dataclass
class ImpactComparison:
    """Quantitative comparison between baseline and simulated scenario."""
    # Peak NO2 metrics
    baseline_peak_no2: float
    simulated_peak_no2: float
    peak_no2_change_ugm3: float
    peak_no2_change_pct: float

    # Mean NO2 metrics
    baseline_mean_no2: float
    simulated_mean_no2: float
    mean_no2_change_ugm3: float
    mean_no2_change_pct: float

    # Population exposure (CPCB 80 µg/m³)
    baseline_exposed_pop: int
    simulated_exposed_pop: int
    exposed_pop_change: int
    exposed_pop_change_pct: float

    # Population exposure (WHO 25 µg/m³)
    baseline_who_exposed_pop: int = 0
    simulated_who_exposed_pop: int = 0
    who_exposed_pop_change: int = 0

    # Plume spatial displacement
    plume_displacement_km: float = 0.0
    plume_heading_deg: float = 0.0

    # Regulatory compliance difference
    baseline_compliance: str = "COMPLIANT"   # "COMPLIANT" | "EXCEEDANCE" | "CRITICAL"
    simulated_compliance: str = "COMPLIANT"
    compliance_improved: bool = False

    # Natural-language policy briefing
    executive_summary: str = ""
    policy_recommendation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "baseline_peak_no2": round(self.baseline_peak_no2, 1),
            "simulated_peak_no2": round(self.simulated_peak_no2, 1),
            "peak_no2_change_ugm3": round(self.peak_no2_change_ugm3, 1),
            "peak_no2_change_pct": round(self.peak_no2_change_pct, 1),
            "baseline_mean_no2": round(self.baseline_mean_no2, 1),
            "simulated_mean_no2": round(self.simulated_mean_no2, 1),
            "mean_no2_change_ugm3": round(self.mean_no2_change_ugm3, 1),
            "mean_no2_change_pct": round(self.mean_no2_change_pct, 1),
            "baseline_exposed_pop": self.baseline_exposed_pop,
            "simulated_exposed_pop": self.simulated_exposed_pop,
            "exposed_pop_change": self.exposed_pop_change,
            "exposed_pop_change_pct": round(self.exposed_pop_change_pct, 1),
            "baseline_who_exposed_pop": self.baseline_who_exposed_pop,
            "simulated_who_exposed_pop": self.simulated_who_exposed_pop,
            "who_exposed_pop_change": self.who_exposed_pop_change,
            "plume_displacement_km": round(self.plume_displacement_km, 2),
            "plume_heading_deg": round(self.plume_heading_deg, 1),
            "baseline_compliance": self.baseline_compliance,
            "simulated_compliance": self.simulated_compliance,
            "compliance_improved": self.compliance_improved,
            "executive_summary": self.executive_summary,
            "policy_recommendation": self.policy_recommendation,
        }


def _compliance_status(val: float) -> str:
    if val > 180:
        return "CRITICAL"
    if val > NAAQS_24H:
        return "EXCEEDANCE"
    return "COMPLIANT"


def compute_impact(
    baseline_field: np.ndarray,
    simulated_field: np.ndarray,
    population_grid: np.ndarray | None = None,
    pixel_size_km: float = 0.25,
) -> ImpactComparison:
    """Compute comprehensive impact delta between baseline and what-if simulation."""
    b_valid = baseline_field[np.isfinite(baseline_field)]
    s_valid = simulated_field[np.isfinite(simulated_field)]

    b_peak = float(np.max(b_valid)) if len(b_valid) else 0.0
    s_peak = float(np.max(s_valid)) if len(s_valid) else 0.0
    b_mean = float(np.mean(b_valid)) if len(b_valid) else 0.0
    s_mean = float(np.mean(s_valid)) if len(s_valid) else 0.0

    peak_change = s_peak - b_peak
    peak_pct = (peak_change / b_peak * 100.0) if b_peak > 0 else 0.0
    mean_change = s_mean - b_mean
    mean_pct = (mean_change / b_mean * 100.0) if b_mean > 0 else 0.0

    # Population impact
    if population_grid is not None and population_grid.shape == baseline_field.shape:
        b_exposed = int(np.sum(population_grid[baseline_field > NAAQS_24H]))
        s_exposed = int(np.sum(population_grid[simulated_field > NAAQS_24H]))
        b_who_exposed = int(np.sum(population_grid[baseline_field > WHO_24H]))
        s_who_exposed = int(np.sum(population_grid[simulated_field > WHO_24H]))
    else:
        # Heuristic: 10,000 people per km² in urban cells exceeding limit
        b_cells = int(np.sum(baseline_field > NAAQS_24H))
        s_cells = int(np.sum(simulated_field > NAAQS_24H))
        b_who_cells = int(np.sum(baseline_field > WHO_24H))
        s_who_cells = int(np.sum(simulated_field > WHO_24H))
        pop_per_cell = int(10000 * (pixel_size_km ** 2))
        b_exposed = b_cells * pop_per_cell
        s_exposed = s_cells * pop_per_cell
        b_who_exposed = b_who_cells * pop_per_cell
        s_who_exposed = s_who_cells * pop_per_cell

    pop_change = s_exposed - b_exposed
    pop_pct = (pop_change / b_exposed * 100.0) if b_exposed > 0 else 0.0
    who_pop_change = s_who_exposed - b_who_exposed

    # Plume displacement (center of mass shift)
    def center_of_mass(arr: np.ndarray) -> tuple[float, float]:
        safe = np.nan_to_num(arr, nan=0.0)
        total = np.sum(safe)
        if total <= 0:
            return 0.0, 0.0
        r_indices, c_indices = np.indices(arr.shape)
        r_center = float(np.sum(r_indices * safe) / total)
        c_center = float(np.sum(c_indices * safe) / total)
        return r_center, c_center

    r_b, c_b = center_of_mass(baseline_field)
    r_s, c_s = center_of_mass(simulated_field)

    dr_km = (r_s - r_b) * pixel_size_km
    dc_km = (c_s - c_b) * pixel_size_km
    displacement_km = math.hypot(dr_km, dc_km)
    heading_deg = (math.degrees(math.atan2(dc_km, -dr_km))) % 360.0

    # Compliance status
    b_comp = _compliance_status(b_peak)
    s_comp = _compliance_status(s_peak)
    improved = (s_peak < b_peak) or (s_comp != b_comp and b_comp in ("CRITICAL", "EXCEEDANCE") and s_comp != "CRITICAL")

    # Executive narrative
    sign = "+" if peak_change > 0 else ""
    direction_word = "reduction" if peak_change < 0 else "increase"
    pop_word = "protected" if pop_change < 0 else "additional people exposed"

    summary = (
        f"Simulated policy intervention results in a {sign}{peak_pct:.1f}% {direction_word} in peak NO₂ "
        f"({b_peak:.1f} → {s_peak:.1f} µg/m³). "
        f"Exposed population changes by {abs(pop_change):,d} ({sign}{pop_pct:.1f}%). "
        f"Plume center of mass shifts by {displacement_km:.2f} km toward heading {heading_deg:.0f}°."
    )

    if improved:
        recommendation = (
            f"**Action Recommended:** Enact scenario measures. Peak concentration drops by {abs(peak_change):.1f} µg/m³, "
            f"averting CPCB non-compliance for {abs(pop_change):,d} residents in downwind receptor corridors."
        )
    else:
        recommendation = (
            f"**Advisory:** Current conditions or increased emissions exacerbate localized stagnation. "
            f"Reinforce emergency traffic and industrial cutbacks immediately."
        )

    return ImpactComparison(
        baseline_peak_no2=b_peak,
        simulated_peak_no2=s_peak,
        peak_no2_change_ugm3=peak_change,
        peak_no2_change_pct=peak_pct,
        baseline_mean_no2=b_mean,
        simulated_mean_no2=s_mean,
        mean_no2_change_ugm3=mean_change,
        mean_no2_change_pct=mean_pct,
        baseline_exposed_pop=b_exposed,
        simulated_exposed_pop=s_exposed,
        exposed_pop_change=pop_change,
        exposed_pop_change_pct=pop_pct,
        baseline_who_exposed_pop=b_who_exposed,
        simulated_who_exposed_pop=s_who_exposed,
        who_exposed_pop_change=who_pop_change,
        plume_displacement_km=displacement_km,
        plume_heading_deg=heading_deg,
        baseline_compliance=b_comp,
        simulated_compliance=s_comp,
        compliance_improved=improved,
        executive_summary=summary,
        policy_recommendation=recommendation,
    )
