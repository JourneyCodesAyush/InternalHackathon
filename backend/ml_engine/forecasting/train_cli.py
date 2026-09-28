"""Forecasting ConvLSTM Training CLI with Apple Silicon MPS & TensorBoard support.

Usage:
    # Run training with auto device detection (Apple Silicon MPS / CUDA / CPU) and TensorBoard:
    python -m ml_engine.forecasting.train_cli --epochs 20 --batch-size 4 --device auto

    # View training in TensorBoard:
    tensorboard --logdir backend/runs/forecasting
"""

from __future__ import annotations

import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import argparse
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("train_cli")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Train the Spatiotemporal ConvLSTM Residual NO₂ Forecasting Model"
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default="cache/forecasting",
        help="Path to preprocessed / downloaded training data directory",
    )
    parser.add_argument(
        "--checkpoint-dir",
        type=str,
        default="models/forecasting",
        help="Directory where model checkpoints will be saved",
    )
    parser.add_argument(
        "--log-dir",
        type=str,
        default="runs/forecasting",
        help="TensorBoard log directory",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=25,
        help="Maximum training epochs",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="Batch size",
    )
    parser.add_argument(
        "--lr",
        type=float,
        default=3e-4,
        help="Learning rate",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        choices=["auto", "mps", "cuda", "cpu"],
        help="Device selector (auto chooses Apple Silicon MPS if available, else CUDA, else CPU)",
    )
    parser.add_argument(
        "--synth-samples",
        type=int,
        default=128,
        help="Number of synthetic sequence samples if raw data cache is empty",
    )
    parser.add_argument(
        "--resume",
        type=str,
        default=None,
        help="Path to an existing checkpoint to resume training from",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    from ml_engine.forecasting.config import ForecastConfig, TrainerConfig, ConvLSTMConfig
    from ml_engine.forecasting.dataset import ForecastDataset, build_synthetic_dataset
    from ml_engine.forecasting.trainer import ForecastTrainer

    cfg = ForecastConfig(
        convlstm=ConvLSTMConfig(
            patch_size=48,
            hidden_channels=32,
            num_layers=2,
            use_unet_encoder=True,
            unet_channels=(16, 32),
            dynamic_channels=10,
            static_channels=7,
            output_horizons=4,
        ),
        trainer=TrainerConfig(
            batch_size=args.batch_size,
            max_epochs=args.epochs,
            learning_rate=args.lr,
            device=args.device,
            log_dir=Path(args.log_dir),
            checkpoint_dir=Path(args.checkpoint_dir),
            use_tensorboard=True,
            save_every=5,
            patience=10,
        ),
    )

    from ml_engine.forecasting.datasets.loader import load_dataset, get_configured_dataset_mode

    data_mode = get_configured_dataset_mode()
    data_dir = Path(args.data_dir)
    h5_files = list(data_dir.glob("*.h5")) if data_dir.exists() else []

    if data_mode == "real" and h5_files:
        log.info("Loading REAL dataset from %d preprocessed data tiles in %s...", len(h5_files), data_dir)
        full_ds = ForecastDataset.from_cache(data_dir, split="train")
        n_val = max(1, int(len(full_ds) * cfg.trainer.val_fraction))
        n_train = len(full_ds) - n_val
        train_ds, val_ds = full_ds.split(n_train, n_val)
    else:
        log.info(
            "Generating rich multi-regime spatiotemporal sequences via dual loader (mode=%s, %d samples)...",
            data_mode, args.synth_samples
        )
        train_ds, val_ds = load_dataset(
            cfg=cfg,
            mode="synthetic",
            num_samples=args.synth_samples,
            h=48,
            w=48,
            val_frac=cfg.trainer.val_fraction,
        )

    log.info("Loaded datasets: %d train sequences | %d val sequences", len(train_ds), len(val_ds))
    log.info("Initializing trainer with device='%s' and TensorBoard log_dir='%s'...", args.device, args.log_dir)

    trainer = ForecastTrainer(cfg, resume=args.resume)
    log.info("Active PyTorch compute device: %s", trainer.model._device)

    history = trainer.train(train_ds, val_ds)

    log.info("Training complete!")
    log.info("Checkpoints saved in: %s", Path(args.checkpoint_dir).resolve())
    log.info("TensorBoard logs written to: %s", Path(args.log_dir).resolve())
    log.info("To view interactive training charts & metrics, run:")
    log.info("   tensorboard --logdir %s", Path(args.log_dir).resolve())


if __name__ == "__main__":
    main()
