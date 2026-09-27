"""Loss functions for the spatiotemporal NO₂ forecasting model.

Combined loss:
    L = w_mse  · L_MSE
      + w_grad · L_gradient
      + w_mass · L_mass

L_MSE        : mean squared error on log1p-normalised NO₂.
L_gradient   : penalises blurring by matching spatial gradients of the prediction.
L_mass       : enforces mass conservation across the forecast horizon.

Mathematical formulation
------------------------
Gradient loss (Sobel approximation):
    G_x = ∂C/∂x   G_y = ∂C/∂y
    L_grad = MSE(G_x_pred, G_x_true) + MSE(G_y_pred, G_y_true)

Mass conservation loss:
    m̂_k = Σ_ij ŷ_k(i,j)   (predicted total)
    m_k  = Σ_ij  y_k(i,j)  (target total)
    L_mass = mean_k [ (m̂_k - m_k)² / (m_k + ε)² ]

All losses require PyTorch and are designed to work with torch.cuda.amp
automatic mixed precision.
"""

from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger(__name__)


def _torch_available() -> bool:
    try:
        import torch  # noqa: F401
        return True
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Gradient (Sobel) operators – registered as buffers once
# ---------------------------------------------------------------------------

def _sobel_kernels():
    """Return (Kx, Ky) Sobel kernels as (1,1,3,3) float tensors."""
    import torch
    kx = torch.tensor([[[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]],
                      dtype=torch.float32).unsqueeze(0)
    ky = torch.tensor([[[-1, -2, -1], [0, 0, 0], [1, 2, 1]]],
                      dtype=torch.float32).unsqueeze(0)
    return kx, ky


def _spatial_gradients(x):
    """Compute Sobel gradients for each (B, C, H, W) tensor using F.conv2d."""
    import torch
    import torch.nn.functional as F
    kx, ky = _sobel_kernels()
    kx = kx.to(x.device)
    ky = ky.to(x.device)
    B, C, H, W = x.shape
    x_flat = x.reshape(B * C, 1, H, W)
    gx = F.conv2d(x_flat, kx, padding=1)
    gy = F.conv2d(x_flat, ky, padding=1)
    return gx.reshape(B, C, H, W), gy.reshape(B, C, H, W)


# ---------------------------------------------------------------------------
# Individual loss functions
# ---------------------------------------------------------------------------

def mse_loss(pred, target):
    """Standard MSE."""
    import torch.nn.functional as F
    return F.mse_loss(pred, target)


def gradient_loss(pred, target):
    """Gradient (sharpness) loss via Sobel operators."""
    p_gx, p_gy = _spatial_gradients(pred)
    t_gx, t_gy = _spatial_gradients(target)
    import torch.nn.functional as F
    return 0.5 * (F.mse_loss(p_gx, t_gx) + F.mse_loss(p_gy, t_gy))


def mass_conservation_loss(pred, target):
    """Relative mass conservation loss across forecast horizons.

    pred, target : (B, horizons, H, W)
    """
    import torch
    # Sum over spatial dims
    m_pred = pred.sum(dim=(-1, -2))    # (B, horizons)
    m_true = target.sum(dim=(-1, -2))  # (B, horizons)
    eps = 1.0
    loss = ((m_pred - m_true) ** 2 / (m_true + eps) ** 2)
    return loss.mean()


# ---------------------------------------------------------------------------
# Combined loss
# ---------------------------------------------------------------------------

class ForecastLoss:
    """Weighted combination of MSE + gradient + mass conservation losses.

    Parameters
    ----------
    w_mse, w_grad, w_mass : loss weights (floats)
    """

    def __init__(
        self,
        w_mse: float = 1.0,
        w_grad: float = 0.3,
        w_mass: float = 0.2,
    ):
        if not _torch_available():
            raise RuntimeError("PyTorch is required for ForecastLoss")
        self.w_mse = w_mse
        self.w_grad = w_grad
        self.w_mass = w_mass

    def __call__(self, pred, target) -> dict:
        """Compute losses and return a dict of individual and total values.

        Parameters
        ----------
        pred   : (B, horizons, H, W) predicted residual + physics
        target : (B, horizons, H, W) true future NO₂

        Returns
        -------
        dict with keys: total, mse, gradient, mass
        """
        l_mse  = mse_loss(pred, target)
        l_grad = gradient_loss(pred, target)
        l_mass = mass_conservation_loss(pred, target)
        total  = self.w_mse * l_mse + self.w_grad * l_grad + self.w_mass * l_mass
        return {
            "total":    total,
            "mse":      l_mse.detach(),
            "gradient": l_grad.detach(),
            "mass":     l_mass.detach(),
        }

    def numpy_eval(
        self,
        pred: np.ndarray,
        target: np.ndarray,
    ) -> dict[str, float]:
        """CPU-only evaluation for validation without autograd."""
        import torch
        with torch.no_grad():
            p = torch.from_numpy(pred.astype(np.float32))
            t = torch.from_numpy(target.astype(np.float32))
            losses = self(p, t)
        return {k: float(v) for k, v in losses.items()}
