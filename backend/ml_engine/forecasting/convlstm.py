"""ConvLSTM residual correction network.

Architecture
------------

                     ┌──────────────┐
  static features ──►│  StaticEmbed │─────────────────────────────┐
                     └──────────────┘                             │
                                                                  ▼
  dynamic frames    ┌──────────────┐   ┌───────────┐   ┌─────────────────┐
  (seq_len × C) ───►│ UNetEncoder  │──►│ ConvLSTM  │──►│  ResidualHead   │──► correction
                    └──────────────┘   └───────────┘   └─────────────────┘

The residual head predicts Δno₂ for each of the 4 forecast horizons (t+30,
t+60, t+90, t+120).  The final forecast is:

    ŷ(t+k) = physics(t+k) + Δ(t+k)

Mathematical notes
------------------
ConvLSTM cell equations (Shi et al., 2015):

    i_t = σ(W_{xi}*X_t + W_{hi}*H_{t-1} + b_i)
    f_t = σ(W_{xf}*X_t + W_{hf}*H_{t-1} + b_f)
    g_t = tanh(W_{xg}*X_t + W_{hg}*H_{t-1} + b_g)
    o_t = σ(W_{xo}*X_t + W_{ho}*H_{t-1} + b_o)
    C_t = f_t ⊙ C_{t-1} + i_t ⊙ g_t
    H_t = o_t ⊙ tanh(C_t)

where * denotes 2-D convolution and ⊙ is elementwise multiplication.

All Conv2d layers use padding='same' so spatial dimensions are preserved.

The network is designed to run without a GPU (pure CPU inference), but
training with CUDA is supported via torch.cuda.amp for mixed precision.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

# ------------------------------------------------------------------
# We import torch lazily so the rest of the engine works even if
# PyTorch is not installed (physics-only mode).
# ------------------------------------------------------------------

def _torch_available() -> bool:
    try:
        import torch  # noqa: F401
        return True
    except ImportError:
        return False


# ------------------------------------------------------------------
# ConvLSTM cell
# ------------------------------------------------------------------

def _build_convlstm_cell(in_ch: int, hid_ch: int, kernel: int):
    """Build a single ConvLSTM cell using torch.nn."""
    import torch
    import torch.nn as nn

    class ConvLSTMCell(nn.Module):
        def __init__(self, input_channels: int, hidden_channels: int, kernel_size: int):
            super().__init__()
            pad = kernel_size // 2
            self.gates = nn.Conv2d(
                input_channels + hidden_channels,
                4 * hidden_channels,
                kernel_size,
                padding=pad,
            )
            nn.init.xavier_uniform_(self.gates.weight)
            if self.gates.bias is not None:
                nn.init.zeros_(self.gates.bias)
                # Initialize forget gate bias to 1.0 for LSTM training stability
                self.gates.bias.data[hidden_channels : 2 * hidden_channels].fill_(1.0)

        def forward(self, x, h_c):
            h, c = h_c
            combined = torch.cat([x, h], dim=1)
            gates = self.gates(combined)
            i, f, g, o = gates.chunk(4, dim=1)
            i = torch.sigmoid(i)
            f = torch.sigmoid(f)
            g = torch.tanh(g)
            o = torch.sigmoid(o)
            c_next = f * c + i * g
            h_next = o * torch.tanh(c_next)
            return h_next, c_next

    return ConvLSTMCell(in_ch, hid_ch, kernel)


# ------------------------------------------------------------------
# U-Net encoder / decoder blocks
# ------------------------------------------------------------------

def _build_unet_encoder(in_ch: int, channels: tuple[int, ...]):
    """Build a lightweight U-Net encoder (downsampling only, no decoder)."""
    import torch.nn as nn

    blocks = nn.ModuleList()
    ch = in_ch
    for out_ch in channels:
        blocks.append(nn.Sequential(
            nn.Conv2d(ch, out_ch, 3, padding=1),
            nn.BatchNorm2d(out_ch),
            nn.GELU(),
            nn.Conv2d(out_ch, out_ch, 3, padding=1),
            nn.BatchNorm2d(out_ch),
            nn.GELU(),
        ))
        ch = out_ch
    return blocks, ch  # (blocks, final out_channels)


# ------------------------------------------------------------------
# Full model
# ------------------------------------------------------------------

class ConvLSTMResidualModel:
    """Python wrapper around the PyTorch module.

    Using a wrapper class lets us keep a clean numpy interface and
    handle the optional torch dependency gracefully.
    """

    def __init__(self, cfg, checkpoint_path=None, device: str = "auto"):
        self.cfg = cfg
        self._model = None
        self._device = None
        if _torch_available():
            self._build(checkpoint_path, device=device)

    # ------------------------------------------------------------------
    def _build(self, checkpoint_path=None, device: str = "auto"):
        import torch
        import torch.nn as nn

        c = self.cfg

        class _Model(nn.Module):
            def __init__(self, cfg):
                super().__init__()
                self.cfg = cfg

                # Static feature embedding
                self.static_embed = nn.Sequential(
                    nn.Conv2d(cfg.static_channels, cfg.hidden_channels, 1),
                    nn.GELU(),
                )

                # U-Net encoder (optional)
                if cfg.use_unet_encoder:
                    blocks, enc_out = _build_unet_encoder(
                        cfg.dynamic_channels, cfg.unet_channels
                    )
                    self.unet_blocks = blocks
                    enc_ch = enc_out
                else:
                    self.unet_blocks = None
                    enc_ch = cfg.dynamic_channels

                # ConvLSTM layers
                cells = []
                in_ch = enc_ch + cfg.hidden_channels  # concat static embed
                for i in range(cfg.num_layers):
                    cells.append(_build_convlstm_cell(
                        in_ch, cfg.hidden_channels, cfg.kernel_size
                    ))
                    in_ch = cfg.hidden_channels
                self.cells = nn.ModuleList(cells)
                self.dropout = nn.Dropout2d(cfg.dropout)

                # Residual output head
                self.head = nn.Sequential(
                    nn.Conv2d(cfg.hidden_channels, cfg.hidden_channels, 3, padding=1),
                    nn.GELU(),
                    nn.Conv2d(cfg.hidden_channels, cfg.output_horizons, 1),
                )

            def _encode_frame(self, x):
                """x: (B, dynamic_channels, H, W)"""
                if self.unet_blocks is not None:
                    for blk in self.unet_blocks:
                        x = blk(x)
                return x

            def forward(self, dynamic_seq, static_feat):
                """
                Parameters
                ----------
                dynamic_seq : (B, seq_len, dynamic_channels, H, W)
                static_feat : (B, static_channels, H, W)

                Returns
                -------
                residual : (B, output_horizons, H, W)
                """
                B, T, C, H, W = dynamic_seq.shape
                device = dynamic_seq.device

                static_emb = self.static_embed(static_feat)  # (B, hid, H, W)

                # Initialize ConvLSTM hidden states
                h = [torch.zeros(B, self.cfg.hidden_channels, H, W, device=device)
                     for _ in self.cells]
                c_state = [torch.zeros_like(h_) for h_ in h]

                for t in range(T):
                    x_t = dynamic_seq[:, t]  # (B, C, H, W)
                    x_t = self._encode_frame(x_t)
                    x_t = torch.cat([x_t, static_emb], dim=1)
                    for i, cell in enumerate(self.cells):
                        h[i], c_state[i] = cell(x_t, (h[i], c_state[i]))
                        x_t = self.dropout(h[i])

                return self.head(h[-1])  # (B, output_horizons, H, W)

        def _resolve_device(pref: str) -> torch.device:
            pref = pref.lower()
            if pref == "cuda" and torch.cuda.is_available():
                return torch.device("cuda")
            if pref == "mps" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                return torch.device("mps")
            if pref in ("auto", "gpu"):
                if torch.cuda.is_available():
                    return torch.device("cuda")
                if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                    return torch.device("mps")
            return torch.device("cpu")

        target_device = _resolve_device(device if isinstance(device, str) else "auto")
        try:
            model = _Model(c).to(target_device)
        except Exception:
            # Fallback to CPU if MPS or CUDA fails during tensor allocation
            target_device = torch.device("cpu")
            model = _Model(c).to(target_device)

        if checkpoint_path is not None:
            import os
            if os.path.isfile(checkpoint_path):
                state = torch.load(checkpoint_path, map_location=target_device, weights_only=True)
                model.load_state_dict(state["model"])

        self._model = model
        self._device = target_device

    # ------------------------------------------------------------------
    def predict(
        self,
        dynamic_seq: np.ndarray,
        static_feat: np.ndarray,
    ) -> np.ndarray:
        """Run inference (no gradient).

        Parameters
        ----------
        dynamic_seq : (seq_len, dynamic_channels, H, W) float32
        static_feat : (static_channels, H, W) float32

        Returns
        -------
        residual    : (output_horizons, H, W) float32
        """
        if self._model is None:
            # PyTorch not available — return zero corrections
            sh = (self.cfg.output_horizons, *static_feat.shape[-2:])
            return np.zeros(sh, dtype=np.float32)

        import torch
        self._model.eval()
        with torch.no_grad():
            dyn = torch.from_numpy(dynamic_seq[None]).to(self._device)
            sta = torch.from_numpy(static_feat[None]).to(self._device)
            out = self._model(dyn, sta)
        return out.squeeze(0).cpu().numpy()

    # ------------------------------------------------------------------
    def count_parameters(self) -> int:
        if self._model is None:
            return 0
        return sum(p.numel() for p in self._model.parameters())
