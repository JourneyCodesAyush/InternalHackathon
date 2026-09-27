"""Pytest session configuration for backend test suite."""

import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

try:
    import torch
    torch.set_num_threads(1)
except Exception:
    pass
