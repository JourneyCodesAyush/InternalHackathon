"""Comprehensive test suite verifying:
1. Ensemble downscaling prediction (XGBoost, Random Forest, LightGBM)
2. SHAP consistency & explainability service
3. What-If scenario simulation physics & impact computation
4. Multi-agent LangGraph orchestration with new specialist nodes
"""

import pytest
import numpy as np
import xarray as xr
from sklearn.ensemble import RandomForestRegressor
import xgboost as xgb
import lightgbm as lgb

from ml_engine.downscaling.ensemble import EnsembleDownscaler, EnsemblePrediction
from ml_engine.xai import SHAPService, get_shap_service, compute_relative_contributions
from ml_engine.simulator import ScenarioSimulator, SimulationScenario, PRESET_SCENARIOS, compute_impact
from app.agent.graph import get_graph, run_agent
from app.agent.state import AgentState


# ─────────────────────────────────────────────────────────────────────────────
# 1. Ensemble Downscaling Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_ensemble_weights_and_structure():
    """Verify ensemble weights default to 0.5 XGB, 0.3 RF, 0.2 LGB."""
    ens = EnsembleDownscaler()
    assert ens.weights["xgboost"] == pytest.approx(0.5)
    assert ens.weights["random_forest"] == pytest.approx(0.3)
    assert ens.weights["lightgbm"] == pytest.approx(0.2)
    assert sum(ens.weights.values()) == pytest.approx(1.0)


def test_ensemble_prediction_mock_features():
    """Test weighted prediction, confidence, and disagreement calculation."""
    ens = EnsembleDownscaler()
    N, D = 100, 8
    X = np.random.RandomState(42).randn(N, D).astype(np.float32)
    y = 50.0 + 3.0 * X[:, 0] - 2.0 * X[:, 1] + np.random.RandomState(42).randn(N)

    # Train submodels directly
    ens.xgb_model = xgb.XGBRegressor(n_estimators=10, max_depth=3, random_state=42)
    ens.xgb_model.fit(X, y)

    ens.rf_model = RandomForestRegressor(n_estimators=10, max_depth=4, random_state=42, n_jobs=1)
    ens.rf_model.fit(X, y)

    ens.lgb_model = lgb.LGBMRegressor(n_estimators=10, max_depth=3, random_state=42, n_jobs=1, verbosity=-1)
    ens.lgb_model.fit(X, y)

    # Mock FeatureBuilder existence
    ens.features = True

    res = ens.predict_features(X)
    assert isinstance(res, EnsemblePrediction)
    assert len(res.prediction) == N
    assert 0.0 <= res.confidence <= 1.0
    assert res.disagreement >= 0.0
    assert "xgboost" in res.model_predictions
    assert "random_forest" in res.model_predictions
    assert "lightgbm" in res.model_predictions


# ─────────────────────────────────────────────────────────────────────────────
# 2. SHAP Consistency & Explainability Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_shap_relative_contributions():
    """Verify relative percentage calculation sums to 100% and top attribution matches."""
    shap_vals = [4.1, -2.8, 1.7, -0.9]
    names = ["road_density", "wind_speed", "built_up", "blh"]
    contributions = compute_relative_contributions(shap_vals, names)

    assert len(contributions) == 4
    total_pct = sum(c["percentage"] for c in contributions)
    assert total_pct == pytest.approx(100.0, abs=0.5)

    # Top contributor should be road_density (4.1 has largest absolute impact)
    assert contributions[0]["feature"] == "road_density"
    assert contributions[0]["percentage"] > 40.0
    assert contributions[0]["direction"] == "increases_no2"


def test_shap_service_output():
    """Verify SHAPService produces required executive summary and data URLs."""
    service = SHAPService()
    service.set_model(None, ["road_density", "wind_speed", "built_up", "blh"])
    features = [0.85, 2.0, 0.70, 350.0]

    explanation = service.explain_instance(
        features=np.array(features),
        predicted_val=78.5,
        location_label="Mumbai Bandra",
    )

    assert "contributed" in explanation.executive_summary.lower()
    assert explanation.waterfall_chart_url.startswith("data:image/png;base64,")
    assert explanation.bar_chart_url.startswith("data:image/png;base64,")
    assert explanation.confidence > 0.8
    assert len(explanation.top_contributors) > 0


# ─────────────────────────────────────────────────────────────────────────────
# 3. What-If Simulator Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_scenario_impact_computation():
    """Verify impact metrics correctly reflect emission reductions."""
    base = np.full((20, 20), 85.0, dtype=np.float32)
    sim = np.full((20, 20), 60.0, dtype=np.float32)

    impact = compute_impact(base, sim)
    assert impact.peak_no2_change_ugm3 == pytest.approx(-25.0)
    assert impact.peak_no2_change_pct < 0.0
    assert impact.baseline_compliance == "EXCEEDANCE"
    assert impact.simulated_compliance == "COMPLIANT"
    impact_text = impact.executive_summary.lower()
    assert "decrease" in impact_text or "reduction" in impact_text


def test_simulator_runner():
    """Verify forward simulation with the physics solver produces valid output grids."""
    sim = ScenarioSimulator()
    c0 = np.ones((16, 16), dtype=np.float32) * 50.0
    c0[8, 8] = 120.0  # Hotspot
    wind_u = np.full_like(c0, 2.0)
    wind_v = np.full_like(c0, 1.0)

    scenario = PRESET_SCENARIOS["traffic_curfew"]
    c_base, c_sim, impact = sim.run_scenario(c0, wind_u, wind_v, scenario, hours=2)

    assert c_base.shape == (16, 16)
    assert c_sim.shape == (16, 16)
    assert np.all(np.isfinite(c_sim))
    assert impact.simulated_peak_no2 <= impact.baseline_peak_no2


def test_simulator_runner_emission_increase_compliance():
    """Critical Bug 1 Regression Test: Verify Traffic=150%, Industrial=150%, Power=150%
    increases peak NO2 above baseline, never drops to 4.2 ug/m3, and reflects EXCEEDANCE/CRITICAL."""
    sim = ScenarioSimulator()
    c0 = np.ones((16, 16), dtype=np.float32) * 50.0
    c0[8, 8] = 120.0  # Hotspot peak
    wind_u = np.full_like(c0, 2.0)
    wind_v = np.full_like(c0, 1.0)

    scenario = SimulationScenario(
        traffic_emission_factor=1.5,
        industrial_emission_factor=1.5,
        power_plant_emission_factor=1.5,
        construction_emission_factor=1.5,
    )
    c_base, c_sim, impact = sim.run_scenario(c0, wind_u, wind_v, scenario, hours=4)

    assert impact.simulated_peak_no2 > impact.baseline_peak_no2
    assert impact.simulated_peak_no2 > 120.0
    assert impact.peak_no2_change_pct > 0.0
    assert impact.simulated_compliance in ("EXCEEDANCE", "CRITICAL")
    assert np.all(np.isfinite(c_sim))


# ─────────────────────────────────────────────────────────────────────────────
# 4. Multi-Agent LangGraph Integration Tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_langgraph_specialist_orchestration():
    """Test full LangGraph run produces ensemble, xai, and simulator cards."""
    graph = get_graph()
    assert "ensemble_confidence_node" in graph.nodes
    assert "xai_agent" in graph.nodes
    assert "simulator_agent" in graph.nodes

    result = await run_agent(
        user_query="Analyze air quality in Mumbai and evaluate policy scenarios",
        session_id="test-session-ensemble-xai-sim",
        extra_state={
            "location": "Mumbai, Maharashtra",
            "bbox": "72.77,18.88,73.12,19.32",
            "observation_date": "2026-03-20",
        },
    )

    assert result["status"] == "done"
    cards = result.get("mission_cards", [])
    card_types = [c.get("type") for c in cards]

    assert "ensemble" in card_types
    assert "xai" in card_types
    assert "simulator" in card_types

    # Validate Ensemble card fields
    ens_card = next(c for c in cards if c.get("type") == "ensemble")
    assert "confidence_score" in ens_card
    assert ens_card["confidence_score"] >= 0.85
    assert "disagreement_ugm3" in ens_card

    # Validate XAI card fields
    xai_card = next(c for c in cards if c.get("type") == "xai")
    assert "executive_summary" in xai_card
    assert "top_contributors" in xai_card

    # Validate Simulator card fields
    sim_card = next(c for c in cards if c.get("type") == "simulator")
    assert "peak_no2_change_pct" in sim_card
    assert "policy_recommendation" in sim_card


def test_simulation_impact_report_pdf():
    """Verify dedicated Simulation Impact Report PDF generates without errors and with Unicode."""
    from ml_engine.report.pdf import build_simulation_report_pdf

    sim_payload = {
        "region_name": "Mumbai (Shivaji Park / MMR)",
        "scenario_name": "Odd-Even Clean Air Intervention",
        "impact": {
            "baseline_peak_no2": 95.0,
            "simulated_peak_no2": 64.0,
            "peak_no2_change_ugm3": -31.0,
            "peak_no2_change_pct": -32.6,
            "baseline_mean_no2": 52.0,
            "simulated_mean_no2": 37.0,
            "mean_no2_change_ugm3": -15.0,
            "baseline_exposed_pop": 180000,
            "simulated_exposed_pop": 35000,
            "exposed_pop_change": -145000,
            "exposed_pop_change_pct": -80.5,
            "baseline_who_exposed_pop": 420000,
            "simulated_who_exposed_pop": 190000,
            "who_exposed_pop_change": -230000,
            "plume_displacement_km": 2.15,
            "plume_heading_deg": 140.0,
            "baseline_compliance": "EXCEEDANCE",
            "simulated_compliance": "COMPLIANT",
            "executive_summary": "Policy intervention reduces peak NO₂ by 32.6% (95.0 → 64.0 µg/m³).",
            "policy_recommendation": "Enact vehicular diversions immediately.",
        },
        "xai": {
            "executive_summary": "Road density contributed 41%, low wind speed contributed 28%.",
            "top_contributors": [
                {"feature": "Road Traffic Density", "contribution_pct": 41.0, "direction": "increases"},
                {"feature": "Wind Speed Stagnation", "contribution_pct": 28.0, "direction": "increases"},
            ],
        },
        "anomalies": [
            {
                "near": "Western Express Highway",
                "lat": 19.035,
                "lon": 72.845,
                "value": 94.0,
                "baseline": 55.0,
                "finding": "Heavy diesel transit congestion",
                "severity": "high",
            }
        ],
        "policy_changes": {
            "Traffic Reductions": 0.6,
            "Industrial Output": 0.5,
        },
    }

    pdf_bytes = build_simulation_report_pdf(sim_payload)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 2000
    assert pdf_bytes.startswith(b"%PDF-")
