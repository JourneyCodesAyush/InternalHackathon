# Multi-Agent Environmental Intelligence System — Architecture

## Overview

The AirQ Insight chatbot has been upgraded from a single conversational assistant into a **collaborative multi-agent environmental intelligence system**. The user interacts with what feels like an environmental command center: one message triggers a coordinated investigation by 5 specialist AI agents, producing a unified intelligence briefing with mission cards, evidence trails, and autonomous action triggers.

## Graph Topology

```
User Query
    │
    ▼
┌────────────┐
│ parse_intent│ ─── greeting/help ──→ build_response → END
└─────┬──────┘
      │ action intent
      ▼
┌──────────┐
│ validate  │ ─── missing fields ──→ END (ask follow-up)
└─────┬────┘
      │ all fields OK
      ▼
┌──────────────┐
│ execute_tools │   ← calls existing backend services (downscale, forecast, report, hotspot)
└──────┬───────┘
       │ raw results in state
       ▼
┌────────────────┐
│ detect_triggers│   ← scans for CPCB exceedance, anomalies, hazardous conditions
└──────┬─────────┘
       │ autonomous_triggers[] populated
       ▼
┌────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ analysis_agent │ →  │ forecast_agent  │ →  │ compliance_agent │
└────────────────┘    └─────────────────┘    └──────┬───────────┘
                                                    │
                                                    ▼
                                          ┌──────────────┐    ┌──────────────┐
                                          │ drone_agent  │ →  │ report_agent │
                                          └──────────────┘    └──────┬───────┘
                                                                     │
                                                                     ▼
                                                          ┌─────────────────────┐
                                                          │ mission_controller  │ → END
                                                          └─────────────────────┘
```

## Specialist Agents

### 1. Analysis Agent (`specialists.py::analysis_agent`)
- **Wraps:** `analysis.py` (hotspots, anomalies, source attribution)
- **Produces:** `AnomalyResult` — severity, anomaly explanations, source list, affected area, population exposed
- **Evidence:** `"analysis_agent: mean=85.3, severity=critical"`

### 2. Forecast Agent (`specialists.py::forecast_agent`)
- **Wraps:** forecasting engine (ConvLSTM + dispersion)
- **Produces:** `ForecastResult` — movement summary, trend direction, alert texts
- **Evidence:** `"forecast_agent: wind=3.2 m/s from 270°, trend=rising"`

### 3. Compliance Agent (`specialists.py::compliance_agent`)
- **Wraps:** CPCB NAAQS (80 µg/m³) and WHO (25 µg/m³) checks
- **Produces:** `ComplianceResult` — classification (advisory/investigation/hazardous), recommended actions
- **Evidence:** `"compliance_agent: classification=investigation, cpcb=EXCEEDED"`

### 4. Drone Mission Agent (`specialists.py::drone_agent`)
- **Wraps:** `flightplan.py` + `haze.py` (DCP haze, DGCA airspace, battery model)
- **Produces:** `DroneResult` — GO/NO-GO decision, VLOS/airspace/battery/weather checks, flight plans
- **Evidence:** `"drone_agent: deploy=True, vlos=True, airspace=True"`

### 5. Report Agent (`specialists.py::report_agent`)
- **Wraps:** `pdf.py` (multilingual ReportLab PDF generation)
- **Produces:** `ReportResult` — auto-generates PDF for hazardous events
- **Evidence:** `"report_agent: generated=True, trigger=auto"`

## Mission Controller (`mission_controller.py`)

Fuses all 5 specialist outputs into:
- **Risk Level:** `critical | high | moderate | low`
- **Mission Brief:** headline, situation report, actions taken, recommended actions
- **Evidence Chain:** complete trail linking all specialist findings
- **Mission Cards:** structured JSON for frontend rendering

## Automatic Workflows

The `detect_triggers` node fires autonomous triggers:

| Trigger | Condition | Auto-action |
|---------|-----------|-------------|
| `cpcb_exceedance` | Mean NO₂ > 80 µg/m³ | Auto-generate report |
| `hazardous_hotspot` | Status = critical/critical_spike | Escalation protocol |
| `anomaly_detected` | Anomalies found in analysis | Investigation workflow |
| `critical_forecast` | Forecast alert level = critical | Alert + report |
| `exceedance_forecast` | CPCB exceedance expected | Pre-position monitoring |

## Explainability

Every specialist attaches `evidence[]` strings. The mission controller collects them into `evidence_chain` and renders them as a trail at the bottom of the response:

```
*Evidence trail: analysis_agent: mean=85.3, severity=critical →
 compliance_agent: classification=investigation, cpcb=EXCEEDED →
 drone_agent: deploy=True, vlos=True → ...*
```

## Frontend Mission Cards

The `MissionCards.tsx` component renders:
1. **Pipeline Visualiser** — shows which agents were active
2. **Trigger Badges** — autonomous events that fired
3. **Status Card** — overall risk level with color coding
4. **Analysis Card** — anomaly count, hotspots, affected area, population
5. **Forecast Card** — wind, trend direction, active alerts
6. **Compliance Card** — CPCB/WHO status, classification, actions
7. **Drone Card** — GO/NO-GO with VLOS/airspace/battery/weather checks
8. **Report Card** — auto-generated documentation status

## API Extensions

`ChatResponse` now includes:
```json
{
  "response": "...",
  "mission_cards": [...],
  "mission_brief": {...},
  "active_specialists": ["analysis", "forecast", "compliance", "drone"],
  "autonomous_triggers": ["cpcb_exceedance", "anomaly_detected"],
  "risk_level": "high"
}
```

## Files Modified / Created

| File | Action | Purpose |
|------|--------|---------|
| `backend/app/agent/state.py` | **Modified** | Extended with specialist result types + mission state |
| `backend/app/agent/specialists.py` | **Created** | 5 specialist agent nodes |
| `backend/app/agent/mission_controller.py` | **Created** | Fusion + mission cards + evidence chain |
| `backend/app/agent/graph.py` | **Modified** | Multi-agent pipeline + trigger detection |
| `backend/app/agent/api.py` | **Modified** | Extended ChatResponse with multi-agent fields |
| `frontend/.../MissionCards.tsx` | **Created** | Government-style intelligence cards |
| `frontend/.../MessageBubble.tsx` | **Modified** | Renders MissionCards inside chat |
| `frontend/.../page.tsx` | **Modified** | ChatMessage type + response handling |

## Preserved Components

All existing modules are **reused without duplication**:
- `parser.py` — intent extraction (unchanged)
- `validators.py` — field validation (unchanged)
- `tools.py` — backend service calls (unchanged)
- `analysis.py` — anomaly detection, hotspot finding (wrapped by Analysis Agent)
- `flightplan.py` — drone flight planning (wrapped by Drone Agent)
- `haze.py` — DCP haze estimation (wrapped by Drone Agent)
- `pdf.py` — PDF report generation (wrapped by Report Agent)
- `forecasting/` — ConvLSTM engine (wrapped by Forecast Agent)
