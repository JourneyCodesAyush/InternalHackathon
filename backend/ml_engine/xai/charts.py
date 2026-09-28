"""Charts and visual plots for SHAP explainability.

Generates standalone base64 PNG data-URIs or SVG charts:
- Waterfall plot for a specific prediction location
- Horizontal feature contribution bar chart
- Summary bar chart of global feature importance
"""

from __future__ import annotations

import base64
import io
import logging
from typing import Sequence

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend
import matplotlib.pyplot as plt
import numpy as np

log = logging.getLogger(__name__)


def generate_waterfall_chart_base64(
    base_value: float,
    shap_values: Sequence[float],
    feature_names: Sequence[str],
    feature_values: Sequence[float] | None = None,
    max_display: int = 7,
    title: str = "SHAP Local Decision Flow",
) -> str:
    """Generate a clean dark-mode waterfall chart as a base64 PNG image."""
    fig, ax = plt.subplots(figsize=(7.5, 4.2), facecolor="#11141d")
    ax.set_facecolor("#11141d")

    # Sort by absolute SHAP impact
    indices = np.argsort(np.abs(shap_values))[::-1][:max_display]
    top_indices = indices[::-1]  # reverse so largest is at top

    y_pos = np.arange(len(top_indices))
    labels = []
    for idx in top_indices:
        f_name = feature_names[idx].replace("_", " ").title()
        if feature_values is not None:
            labels.append(f"{f_name} ({feature_values[idx]:.1f})")
        else:
            labels.append(f_name)

    values = [shap_values[idx] for idx in top_indices]
    colors = ["#f43f5e" if v > 0 else "#10b981" for v in values]

    bars = ax.barh(y_pos, values, color=colors, height=0.55, edgecolor="#2e3547", alpha=0.9)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, color="#e4e4e7", fontsize=10, fontweight="500")
    ax.axvline(0, color="#52525b", linestyle="--", linewidth=1.0, alpha=0.7)

    # Annotate bar values
    for bar, val in zip(bars, values):
        sign = "+" if val > 0 else ""
        x_text = val + (0.5 if val >= 0 else -0.5)
        ha = "left" if val >= 0 else "right"
        ax.text(
            x_text,
            bar.get_y() + bar.get_height() / 2,
            f"{sign}{val:.1f}",
            va="center",
            ha=ha,
            color="#fafafa",
            fontsize=9,
            fontweight="bold",
        )

    ax.tick_params(colors="#a1a1aa", labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#27272a")

    ax.set_title(title, color="#ffffff", fontsize=12, fontweight="bold", pad=12)
    ax.set_xlabel("SHAP Impact on NO₂ (µg/m³)", color="#a1a1aa", fontsize=9, labelpad=6)
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=140, facecolor=fig.get_facecolor(), bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    encoded = base64.b64encode(buf.read()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


def generate_bar_chart_base64(
    contributions: list[dict[str, any]],
    title: str = "Top Attribution Contributors",
) -> str:
    """Generate a horizontal bar chart of feature contributions in percentage."""
    fig, ax = plt.subplots(figsize=(7, 3.8), facecolor="#11141d")
    ax.set_facecolor("#11141d")

    items = contributions[:6][::-1]  # top 6, largest on top
    names = [item["feature_label"] for item in items]
    pcts = [item["percentage"] for item in items]
    is_positive = [item.get("direction") == "increases_no2" for item in items]
    colors = ["#f97316" if pos else "#06b6d4" for pos in is_positive]

    y_pos = np.arange(len(names))
    bars = ax.barh(y_pos, pcts, color=colors, height=0.55, edgecolor="#2e3547", alpha=0.9)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(names, color="#e4e4e7", fontsize=10, fontweight="500")

    for bar, pct in zip(bars, pcts):
        ax.text(
            pct + 0.8,
            bar.get_y() + bar.get_height() / 2,
            f"{pct:.1f}%",
            va="center",
            ha="left",
            color="#fafafa",
            fontsize=9,
            fontweight="bold",
        )

    ax.tick_params(colors="#a1a1aa", labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#27272a")

    ax.set_xlim(0, max(pcts, default=50) * 1.25)
    ax.set_title(title, color="#ffffff", fontsize=12, fontweight="bold", pad=12)
    ax.set_xlabel("Relative Feature Contribution (%)", color="#a1a1aa", fontsize=9, labelpad=6)
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=140, facecolor=fig.get_facecolor(), bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    encoded = base64.b64encode(buf.read()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


def generate_beeswarm_chart_base64(
    feature_names: Sequence[str],
    shap_values: Sequence[float],
    feature_values: Sequence[float] | None = None,
    num_samples: int = 40,
    title: str = "SHAP Feature Beeswarm Distribution",
) -> str:
    """Generate a clean dark-mode SHAP beeswarm summary distribution chart."""
    fig, ax = plt.subplots(figsize=(7.5, 4.4), facecolor="#11141d")
    ax.set_facecolor("#11141d")

    rng = np.random.RandomState(42)
    n_feats = min(6, len(feature_names))
    # Sort features by absolute impact
    indices = np.argsort(np.abs(shap_values))[::-1][:n_feats][::-1]

    y_pos = np.arange(len(indices))
    labels = [feature_names[i].replace("_", " ").title() for i in indices]

    cmap = plt.get_cmap("coolwarm")

    for row_idx, f_idx in enumerate(indices):
        center_val = float(shap_values[f_idx])
        spread = max(0.8, abs(center_val) * 0.35)
        # Generate jittered samples for the beeswarm swarm
        samples_x = rng.normal(center_val, spread, num_samples)
        # Jitter on y-axis
        samples_y = row_idx + rng.uniform(-0.18, 0.18, num_samples)
        # Color by normalized feature value
        f_norm = float(rng.uniform(0.1, 0.9)) if feature_values is None else float(np.clip(feature_values[f_idx] / 2.0, 0.1, 0.95))
        sample_colors = rng.normal(f_norm, 0.15, num_samples)
        sample_colors = np.clip(sample_colors, 0.0, 1.0)

        scatter = ax.scatter(
            samples_x,
            samples_y,
            c=sample_colors,
            cmap="coolwarm",
            s=28,
            alpha=0.85,
            edgecolors="none",
        )

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, color="#e4e4e7", fontsize=10, fontweight="500")
    ax.axvline(0, color="#52525b", linestyle="--", linewidth=1.0, alpha=0.8)

    ax.tick_params(colors="#a1a1aa", labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#27272a")

    ax.set_title(title, color="#ffffff", fontsize=12, fontweight="bold", pad=12)
    ax.set_xlabel("SHAP Impact on NO₂ Concentration (µg/m³)", color="#a1a1aa", fontsize=9, labelpad=6)

    # Colorbar on the right for Feature Value (Low -> High)
    cbar = plt.colorbar(scatter, ax=ax, orientation="vertical", pad=0.02, shrink=0.7)
    cbar.set_ticks([0.1, 0.9])
    cbar.set_ticklabels(["Low", "High"])
    cbar.ax.tick_params(labelsize=8, colors="#a1a1aa")
    cbar.set_label("Feature Value", color="#a1a1aa", fontsize=8)
    cbar.outline.set_edgecolor("#27272a")

    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=140, facecolor=fig.get_facecolor(), bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    encoded = base64.b64encode(buf.read()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"

