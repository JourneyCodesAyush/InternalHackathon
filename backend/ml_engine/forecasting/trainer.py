"""Training loop for the ConvLSTM residual forecasting model.

Features
--------
* Mixed precision training (torch.cuda.amp) when GPU is available.
* Checkpointing with epoch + best-validation-loss saving.
* Early stopping with configurable patience.
* Resume training from any checkpoint.
* Leakage-free validation split (temporal, not random).
* Detailed logging of per-batch and per-epoch losses.

Usage
-----
    from ml_engine.forecasting.trainer import ForecastTrainer
    from ml_engine.forecasting.config import ForecastConfig

    cfg = ForecastConfig()
    trainer = ForecastTrainer(cfg)
    trainer.train(train_dataset, val_dataset)
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import numpy as np

from .config import ForecastConfig, TrainerConfig
from .convlstm import ConvLSTMResidualModel
from .losses import ForecastLoss
from .metrics import ForecastMetrics

log = logging.getLogger(__name__)


def _torch_available() -> bool:
    try:
        import torch  # noqa: F401
        return True
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Trainer
# ---------------------------------------------------------------------------

class ForecastTrainer:
    """End-to-end training orchestrator for the ConvLSTM residual model.

    Parameters
    ----------
    cfg      : ForecastConfig (master config)
    resume   : path to an existing checkpoint to resume from
    """

    def __init__(self, cfg: ForecastConfig, resume: str | Path | None = None):
        if not _torch_available():
            raise RuntimeError(
                "PyTorch is required for training. "
                "Install it via: pip install torch"
            )
        self.cfg = cfg
        self.tr_cfg: TrainerConfig = cfg.trainer
        self.model = ConvLSTMResidualModel(
            cfg.convlstm,
            checkpoint_path=resume,
            device=self.tr_cfg.device,
        )
        self.loss_fn = ForecastLoss(
            w_mse=self.tr_cfg.loss_mse_weight,
            w_grad=self.tr_cfg.loss_gradient_weight,
            w_mass=self.tr_cfg.loss_mass_weight,
        )
        self._setup_optimizer()
        self._history: list[dict] = []
        self._start_epoch = 0
        self._best_val_loss = float("inf")

        # TensorBoard SummaryWriter setup
        self.writer = None
        if self.tr_cfg.use_tensorboard:
            try:
                from torch.utils.tensorboard import SummaryWriter
                run_dir = Path(self.tr_cfg.log_dir) / time.strftime("%Y%m%d-%H%M%S")
                run_dir.mkdir(parents=True, exist_ok=True)
                self.writer = SummaryWriter(log_dir=str(run_dir))
                log.info("TensorBoard logging enabled: %s", run_dir)
            except Exception as e:
                log.warning("TensorBoard SummaryWriter unavailable (%s). Continuing without it.", e)

        if resume:
            self._load_checkpoint(Path(resume))

    # ------------------------------------------------------------------
    def _setup_optimizer(self):
        import torch.optim as optim
        params = self.model._model.parameters()
        self._optimizer = optim.AdamW(
            params,
            lr=self.tr_cfg.learning_rate,
            weight_decay=self.tr_cfg.weight_decay,
        )
        self._scheduler = optim.lr_scheduler.CosineAnnealingLR(
            self._optimizer,
            T_max=self.tr_cfg.max_epochs,
            eta_min=1e-6,
        )
        self._scaler = None
        if self.tr_cfg.use_amp:
            try:
                import torch
                if torch.cuda.is_available() and self.model._device.type == "cuda":
                    self._scaler = torch.cuda.amp.GradScaler()
            except Exception:
                pass

    # ------------------------------------------------------------------
    def _save_checkpoint(self, epoch: int, val_loss: float, tag: str = "latest"):
        import torch
        ck_dir = Path(self.tr_cfg.checkpoint_dir)
        ck_dir.mkdir(parents=True, exist_ok=True)
        path = ck_dir / f"checkpoint_{tag}.pt"
        torch.save(
            {
                "epoch": epoch,
                "model": self.model._model.state_dict(),
                "optimizer": self._optimizer.state_dict(),
                "scheduler": self._scheduler.state_dict(),
                "val_loss": val_loss,
                "history": self._history,
            },
            path,
        )
        log.info("Saved checkpoint [%s] epoch=%d val_loss=%.4f", tag, epoch, val_loss)

    # ------------------------------------------------------------------
    def _load_checkpoint(self, path: Path):
        import torch
        if not path.exists():
            log.warning("Checkpoint not found: %s", path)
            return
        state = torch.load(path, map_location=self.model._device, weights_only=False)
        self.model._model.load_state_dict(state["model"])
        self._optimizer.load_state_dict(state["optimizer"])
        self._scheduler.load_state_dict(state["scheduler"])
        self._start_epoch = state["epoch"] + 1
        self._best_val_loss = state.get("val_loss", float("inf"))
        self._history = state.get("history", [])
        log.info("Resumed from %s (epoch %d)", path, self._start_epoch)

    # ------------------------------------------------------------------
    def _make_loader(self, dataset, shuffle: bool):
        import torch
        from torch.utils.data import DataLoader
        td = dataset.as_torch()
        return DataLoader(
            td,
            batch_size=self.tr_cfg.batch_size,
            shuffle=shuffle,
            num_workers=0,
            pin_memory=torch.cuda.is_available(),
            drop_last=shuffle,
        )

    # ------------------------------------------------------------------
    def _train_epoch(self, loader) -> dict[str, float]:
        import torch
        import torch.cuda.amp as amp
        model = self.model._model.train()
        device = self.model._device
        totals: dict[str, float] = {"total": 0.0, "mse": 0.0, "gradient": 0.0, "mass": 0.0}
        n = 0

        for dyn, sta, tgt in loader:
            dyn = dyn.to(device)
            sta = sta.to(device)
            tgt = tgt.to(device)

            self._optimizer.zero_grad(set_to_none=True)

            use_amp = self._scaler is not None
            ctx = amp.autocast() if use_amp else _null_ctx()

            with ctx:
                pred = model(dyn, sta)     # (B, horizons, H, W)
                losses = self.loss_fn(pred, tgt)

            if use_amp:
                self._scaler.scale(losses["total"]).backward()
                self._scaler.unscale_(self._optimizer)
                torch.nn.utils.clip_grad_norm_(
                    model.parameters(), self.tr_cfg.grad_clip
                )
                self._scaler.step(self._optimizer)
                self._scaler.update()
            else:
                losses["total"].backward()
                torch.nn.utils.clip_grad_norm_(
                    model.parameters(), self.tr_cfg.grad_clip
                )
                self._optimizer.step()

            for k in totals:
                val = losses[k]
                totals[k] += float(val.detach().item() if hasattr(val, "detach") else val)
            n += 1

        return {k: v / max(n, 1) for k, v in totals.items()}

    # ------------------------------------------------------------------
    def _val_epoch(self, loader) -> dict[str, float]:
        import torch
        model = self.model._model.eval()
        device = self.model._device
        totals: dict[str, float] = {"total": 0.0, "mse": 0.0, "gradient": 0.0, "mass": 0.0}
        n = 0

        with torch.no_grad():
            for dyn, sta, tgt in loader:
                dyn = dyn.to(device)
                sta = sta.to(device)
                tgt = tgt.to(device)
                pred = model(dyn, sta)
                losses = self.loss_fn(pred, tgt)
                for k in totals:
                    val = losses[k]
                    totals[k] += float(val.detach().item() if hasattr(val, "detach") else val)
                n += 1

        return {k: v / max(n, 1) for k, v in totals.items()}

    # ------------------------------------------------------------------
    def train(self, train_dataset, val_dataset) -> list[dict]:
        """Run the full training loop.

        Parameters
        ----------
        train_dataset, val_dataset : ForecastDataset instances

        Returns
        -------
        history : list of per-epoch metric dicts
        """
        train_loader = self._make_loader(train_dataset, shuffle=True)
        val_loader   = self._make_loader(val_dataset,   shuffle=False)

        log.info(
            "Training ConvLSTM: %d train / %d val samples | %d params | device=%s",
            len(train_dataset), len(val_dataset),
            self.model.count_parameters(),
            self.model._device,
        )

        patience_counter = 0

        for epoch in range(self._start_epoch, self.tr_cfg.max_epochs):
            t0 = time.time()
            tr = self._train_epoch(train_loader)
            vl = self._val_epoch(val_loader)
            self._scheduler.step()
            elapsed = time.time() - t0

            row = {
                "epoch": epoch,
                "elapsed_s": round(elapsed, 1),
                "train": tr,
                "val": vl,
            }
            self._history.append(row)

            # TensorBoard metrics logging
            if self.writer is not None:
                lr = self._optimizer.param_groups[0]["lr"]
                self.writer.add_scalar("LearningRate", lr, epoch)
                for k in ("total", "mse", "gradient", "mass"):
                    if k in tr:
                        self.writer.add_scalar(f"Loss/train_{k}", tr[k], epoch)
                    if k in vl:
                        self.writer.add_scalar(f"Loss/val_{k}", vl[k], epoch)

            log.info(
                "Epoch %03d | train_loss=%.4f | val_loss=%.4f | %.1fs",
                epoch, tr["total"], vl["total"], elapsed,
            )

            # Checkpoint every N epochs
            if (epoch + 1) % self.tr_cfg.save_every == 0:
                self._save_checkpoint(epoch, vl["total"], tag="latest")

            # Best checkpoint
            if vl["total"] < self._best_val_loss:
                self._best_val_loss = vl["total"]
                self._save_checkpoint(epoch, vl["total"], tag="best")
                patience_counter = 0
            else:
                patience_counter += 1

            # Early stopping
            if patience_counter >= self.tr_cfg.patience:
                log.info("Early stopping at epoch %d (patience=%d)", epoch, self.tr_cfg.patience)
                break

        # Flush & close TensorBoard writer
        if self.writer is not None:
            self.writer.flush()
            self.writer.close()
            log.info("TensorBoard event logs written and closed.")

        # Save final history
        ck_dir = Path(self.tr_cfg.checkpoint_dir)
        ck_dir.mkdir(parents=True, exist_ok=True)
        (ck_dir / "training_history.json").write_text(json.dumps(self._history, indent=2))

        log.info("Training complete. Best val_loss=%.4f", self._best_val_loss)
        return self._history


# ---------------------------------------------------------------------------
# Validation runner (post-training, leakage-free)
# ---------------------------------------------------------------------------

def validate_forecast(
    model: ConvLSTMResidualModel,
    physics_preds: np.ndarray,   # (N, horizons, H, W) physics baseline
    ai_preds: np.ndarray,        # (N, horizons, H, W) model corrections
    targets: np.ndarray,         # (N, horizons, H, W) ground truth
    horizon_mins: list[int],
    lats: np.ndarray | None = None,
    lons: np.ndarray | None = None,
) -> dict:
    """Evaluate physics-only vs. hybrid (physics + AI) on held-out data.

    Returns
    -------
    dict with keys:
      "physics"  : ForecastMetrics for the pure physics baseline
      "hybrid"   : ForecastMetrics for physics + AI residual
      "improvement" : Δ in RMSE, R², etc.
    """
    hybrid = physics_preds + ai_preds

    def _batch_metrics(pred_4d, true_4d):
        # Average over batch dimension
        all_h = []
        for n in range(pred_4d.shape[0]):
            all_h.append(ForecastMetrics.compute(
                pred_4d[n], true_4d[n], horizon_mins, lats, lons
            ))
        # Aggregate overall
        keys = all_h[0].overall.keys()
        agg = {}
        for k in keys:
            vals = [m.overall[k] for m in all_h if not np.isnan(m.overall[k])]
            agg[k] = float(np.mean(vals)) if vals else float("nan")
        return agg

    phy_overall = _batch_metrics(physics_preds, targets)
    hyb_overall = _batch_metrics(hybrid, targets)

    improvement = {
        k: hyb_overall.get(k, float("nan")) - phy_overall.get(k, float("nan"))
        for k in phy_overall
    }

    return {
        "physics": phy_overall,
        "hybrid": hyb_overall,
        "improvement": improvement,
    }


# ---------------------------------------------------------------------------
# Context manager stub (for non-CUDA path)
# ---------------------------------------------------------------------------

class _null_ctx:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass
