"""Pydantic schemas for the What-If Simulator endpoints."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class NodeOverride(BaseModel):
    id: str
    name: str | None = None
    emission_factor: float = Field(default=1.0, ge=0.0, le=2.0)
    category: str | None = None
    coordinates: list[float] | None = None


class SimulatorRunRequest(BaseModel):
    region_name: str = "Mumbai (MMR / Shivaji Park)"
    bbox: str = "72.77,18.88,73.12,19.32"  # west,south,east,north
    observation_date: str | None = None

    # Meteorological Levers
    wind_speed_factor: float = Field(default=1.0, ge=0.1, le=3.0)
    wind_direction_delta_deg: float = Field(default=0.0, ge=-180.0, le=180.0)
    temperature_delta_c: float = Field(default=0.0, ge=-10.0, le=10.0)
    humidity_pct: float = Field(default=65.0, ge=10.0, le=100.0)
    rainfall_mm_h: float = Field(default=0.0, ge=0.0, le=50.0)
    blh_factor: float = Field(default=1.0, ge=0.2, le=3.0)

    # Sector Emission Levers
    traffic_emission_factor: float = Field(default=1.0, ge=0.0, le=2.5)
    industrial_emission_factor: float = Field(default=1.0, ge=0.0, le=2.5)
    power_plant_emission_factor: float = Field(default=1.0, ge=0.0, le=2.5)
    construction_emission_factor: float = Field(default=1.0, ge=0.0, le=2.5)
    background_emission_factor: float = Field(default=1.0, ge=0.0, le=2.5)

    # Specific facility / node overrides
    node_overrides: list[NodeOverride] = Field(default_factory=list)

    # Preset identifier if selected
    preset_id: str | None = None


class SimulatorReportRequest(BaseModel):
    region_name: str = "Mumbai (MMR / Shivaji Park)"
    scenario_name: str = "Custom What-If Policy Intervention"
    impact: dict[str, Any]
    xai: dict[str, Any]
    anomalies: list[dict[str, Any]] = Field(default_factory=list)
    policy_changes: dict[str, float] = Field(default_factory=dict)
