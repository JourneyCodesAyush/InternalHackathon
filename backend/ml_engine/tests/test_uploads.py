import json

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from ml_engine import service, uploads


def _tif(day: str, value: float = 30.0, width: int = 4, height: int = 3, west: float = 72.8) -> bytes:
    import io

    buf = io.BytesIO()
    data = np.full((height, width), value, np.float32)
    data[0, 0] = np.nan
    with rasterio.MemoryFile() as mem:
        with mem.open(driver="GTiff", width=width, height=height, count=1, dtype="float32", crs="EPSG:4326",
                      transform=from_origin(west, 19.2, 0.035, 0.035), nodata=np.nan) as dst:
            dst.write(data, 1)
            dst.update_tags(units="umol m-2")
        buf.write(mem.read())
    return buf.getvalue()


@pytest.fixture
def roots(tmp_path, monkeypatch):
    monkeypatch.setattr(uploads, "UPLOADS_ROOT", tmp_path / "uploads")
    monkeypatch.setattr(service, "RUNS_ROOT", tmp_path / "runs")
    return tmp_path


def test_rejects_wrong_files(roots):
    with pytest.raises(ValueError, match="GeoTIFF"):
        uploads.submit_upload([("notes.txt", b"x")])
    with pytest.raises(ValueError, match="date"):
        uploads.submit_upload([("no2.tif", _tif("x"))])
    with pytest.raises(ValueError, match="No files"):
        uploads.submit_upload([])


def test_grid_mismatch_is_reported_before_running(roots, monkeypatch):
    monkeypatch.setattr(uploads, "_run", lambda job_id: pytest.fail("must not start"))
    files = [("no2_raw_coarse_2025-12-01.tif", _tif("a")), ("no2_raw_coarse_2025-12-02.tif", _tif("b", west=73.0))]
    with pytest.raises(ValueError, match="grid differs"):
        uploads.submit_upload(files)


def test_same_files_reuse_the_job(roots, monkeypatch):
    started = []
    monkeypatch.setattr(uploads, "_run", lambda job_id: started.append(job_id))
    files = [(f"no2_raw_coarse_2025-12-0{d}.tif", _tif(str(d))) for d in (1, 2, 3)]
    first = uploads.submit_upload(files)
    assert first["state"] == "queued" and first["first_date"] == "2025-12-01" and first["last_date"] == "2025-12-03"
    uploads._threads[first["job_id"]] = object()  # still "running"
    again = uploads.submit_upload(list(reversed(files)))
    assert again["job_id"] == first["job_id"]
    uploads._threads.clear()


def test_interrupted_job_is_reported_failed(roots, monkeypatch):
    monkeypatch.setattr(uploads, "_run", lambda job_id: None)
    job = uploads.submit_upload([("no2_raw_coarse_2025-12-01.tif", _tif("a"))])
    uploads._threads.clear()  # e.g. the server restarted
    status = uploads.job_status(job["job_id"])
    assert status["state"] == "failed" and "interrupted" in status["error"]
    with pytest.raises(KeyError):
        uploads.job_status("../../etc")


def _fake_run(run_dir, days, mtime):
    import os

    for day in days:
        (run_dir / "daily" / day).mkdir(parents=True)
        (run_dir / "daily" / day / "no2_surface_fine.tif").write_bytes(b"tif")
    (run_dir / "report.json").write_text("{}")
    os.utime(run_dir / "report.json", (mtime, mtime))


def test_latest_output_prefers_finished_uploads(roots):
    assert uploads.latest_output() is None
    _fake_run(roots / "runs" / "aaaa", ["2025-12-30", "2025-12-31"], 1000)
    out = uploads.latest_output()
    assert out["source"] == "run" and out["date"] == "2025-12-31"

    job = roots / "uploads" / "0123456789abcdef"
    _fake_run(job / "run", ["2025-12-06", "2025-12-07"], 500)  # older than the stored run, still preferred
    (job / "status.json").write_text(json.dumps({"job_id": "0123456789abcdef", "state": "done", "stats": {"days": 2}}))
    out = uploads.latest_output()
    assert out["source"] == "upload" and out["job_id"] == "0123456789abcdef" and out["date"] == "2025-12-07"
    assert uploads.job_output("0123456789abcdef", "2025-12-06")["date"] == "2025-12-06"
