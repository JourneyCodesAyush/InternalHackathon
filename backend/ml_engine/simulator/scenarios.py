"""Scenario definition and perturbation models for what-if simulation.

Allows modifying:
- wind speed (multiplier or absolute m/s)
- wind direction (degrees rotation or absolute degree)
- temperature (delta degrees Celsius)
- rainfall (mm/h wet scavenging)
- traffic emissions (multiplier, e.g. 0.7 for 30% reduction)
- industrial emissions (multiplier)
- power plant emissions (multiplier)
- boundary layer height (BLH multiplier, e.g. 1.25 for thermal inversion break)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SimulationScenario:
    """Parameters for a what-if scenario run."""
    name: str = "Custom Policy Intervention"
    description: str = "User-modified environmental and emission parameters"

    # Meteorology perturbations
    wind_speed_factor: float = 1.0       # 1.0 = unchanged, 0.5 = calm, 1.5 = breezy
    wind_direction_delta_deg: float = 0.0 # offset angle (-180 to +180)
    temperature_delta_c: float = 0.0     # temperature shift (-5 to +5 deg C)
    humidity_pct: float = 65.0           # relative humidity (0-100%)
    rainfall_mm_h: float = 0.0           # 0 = dry, >0 adds wet deposition washout
    blh_factor: float = 1.0              # boundary layer height multiplier (0.5 to 2.0)

    # Source emission controls (0.0 = complete shutdown, 1.0 = baseline, 1.5 = surge)
    traffic_emission_factor: float = 1.0
    industrial_emission_factor: float = 1.0
    power_plant_emission_factor: float = 1.0
    construction_emission_factor: float = 1.0
    background_emission_factor: float = 1.0

    # Specific node overrides { "node_id": factor (0.0 to 2.0) }
    node_overrides: dict[str, float] = field(default_factory=dict)

    # Policy presets
    preset_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "wind_speed_factor": self.wind_speed_factor,
            "wind_direction_delta_deg": self.wind_direction_delta_deg,
            "temperature_delta_c": self.temperature_delta_c,
            "humidity_pct": self.humidity_pct,
            "rainfall_mm_h": self.rainfall_mm_h,
            "blh_factor": self.blh_factor,
            "traffic_emission_factor": self.traffic_emission_factor,
            "industrial_emission_factor": self.industrial_emission_factor,
            "power_plant_emission_factor": self.power_plant_emission_factor,
            "construction_emission_factor": self.construction_emission_factor,
            "background_emission_factor": self.background_emission_factor,
            "node_overrides": self.node_overrides,
            "preset_id": self.preset_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SimulationScenario:
        return cls(
            name=data.get("name", "Custom Scenario"),
            description=data.get("description", ""),
            wind_speed_factor=float(data.get("wind_speed_factor", 1.0)),
            wind_direction_delta_deg=float(data.get("wind_direction_delta_deg", 0.0)),
            temperature_delta_c=float(data.get("temperature_delta_c", 0.0)),
            humidity_pct=float(data.get("humidity_pct", 65.0)),
            rainfall_mm_h=float(data.get("rainfall_mm_h", 0.0)),
            blh_factor=float(data.get("blh_factor", 1.0)),
            traffic_emission_factor=float(data.get("traffic_emission_factor", 1.0)),
            industrial_emission_factor=float(data.get("industrial_emission_factor", 1.0)),
            power_plant_emission_factor=float(data.get("power_plant_emission_factor", 1.0)),
            construction_emission_factor=float(data.get("construction_emission_factor", 1.0)),
            background_emission_factor=float(data.get("background_emission_factor", 1.0)),
            node_overrides=dict(data.get("node_overrides", {})),
            preset_id=data.get("preset_id"),
        )


# Standard curated policy scenarios
PRESET_SCENARIOS = {
    "traffic_curfew": SimulationScenario(
        name="Odd-Even / Clean Air Zone (-40% Traffic)",
        description="Strict urban vehicular curbs and heavy commercial vehicle diversions.",
        traffic_emission_factor=0.6,
        preset_id="traffic_curfew",
    ),
    "odd_even": SimulationScenario(
        name="Odd-Even Traffic Policy (-50% Traffic)",
        description="Vehicular restriction based on odd-even license plates with strict EV exemptions.",
        traffic_emission_factor=0.5,
        construction_emission_factor=0.8,
        preset_id="odd_even",
    ),
    "industrial_shutdown": SimulationScenario(
        name="Industrial Shutdown (-70% Industry, -40% Power)",
        description="Mandatory shutdown of non-essential boilers and industrial power stacks.",
        industrial_emission_factor=0.3,
        power_plant_emission_factor=0.6,
        construction_emission_factor=0.5,
        preset_id="industrial_shutdown",
    ),
    "monsoon_washout": SimulationScenario(
        name="Monsoon Washout (15 mm/h Rain, +30% Wind)",
        description="Intense tropical precipitation scavenging wet deposition with brisk oceanic winds.",
        rainfall_mm_h=15.0,
        wind_speed_factor=1.35,
        humidity_pct=92.0,
        preset_id="monsoon_washout",
    ),
    "wind_stagnation": SimulationScenario(
        name="Wind Stagnation (0.4x Wind, BLH -50%)",
        description="Atmospheric inversion trap with minimal ventilation and ground-level trapping.",
        wind_speed_factor=0.4,
        blh_factor=0.5,
        temperature_delta_c=-3.0,
        preset_id="wind_stagnation",
    ),
    "emergency_restrictions": SimulationScenario(
        name="Emergency Environmental Restrictions (GRAP Stage IV)",
        description="Comprehensive emergency action: -60% traffic, -70% industrial, -100% construction halt.",
        traffic_emission_factor=0.4,
        industrial_emission_factor=0.3,
        power_plant_emission_factor=0.5,
        construction_emission_factor=0.0,
        preset_id="emergency_restrictions",
    ),
    "thermal_inversion": SimulationScenario(
        name="Severe Winter Inversion Trap (BLH -50%, Stagnant)",
        description="Low winter boundary layer height with stagnant dispersion.",
        wind_speed_factor=0.6,
        blh_factor=0.5,
        temperature_delta_c=-3.0,
        preset_id="thermal_inversion",
    ),
}
