"""Pre-compute everything a demo will show, so it runs without Earth Engine (``ML_ENGINE_OFFLINE=true``).

    uv run python -m ml_engine.prewarm --globe --report Mumbai:2025-12-31 --report Delhi:2025-12-31
    uv run python -m ml_engine.prewarm --check --report Mumbai:2025-12-31     # is it ready for offline use?

Each ``--report CITY:DATE`` runs the full pipeline once (a few minutes and some Earth Engine quota the first
time) and builds the report in every ``--languages`` language; with ``--ai`` the Gemini narratives are cached
too (one call per language), so the presentation makes no API calls at all. ``--globe`` stores the latest
global NO2 snapshot. Run it the day before; results persist on disk (``outputs/runs``, ``cache/``).
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from . import service
from .cities import city_bbox
from .env import offline


def _parse_report(spec: str) -> tuple[str, str]:
    city, sep, day = spec.rpartition(":")
    if not sep or not city or not day:
        raise argparse.ArgumentTypeError(f"expected CITY:YYYY-MM-DD, got {spec!r}")
    return city.strip(), day.strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m ml_engine.prewarm", description=__doc__.split("\n\n")[0])
    ap.add_argument("--report", action="append", type=_parse_report, default=[], metavar="CITY:DATE",
                    help="city and report date to prepare (repeatable)")
    ap.add_argument("--languages", nargs="+", default=["en", "hi", "mr"], choices=["en", "hi", "mr"])
    ap.add_argument("--ai", action="store_true", help="also cache the Gemini narratives (1 call per language)")
    ap.add_argument("--globe", action="store_true", help="store the latest global NO2 snapshot")
    ap.add_argument("--check", action="store_true", help="only report what is ready for offline use")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if not (args.report or args.globe):
        ap.error("nothing to do: pass --report CITY:DATE and/or --globe")

    ok = True
    if args.globe:
        from .globe import _load, RES_DEG

        if args.check:
            cached = _load(24, RES_DEG)
            ready = cached is not None
            print(f"[{'ready' if ready else 'MISSING'}] globe snapshot"
                  + (f" from {cached[0]['meta']['fetched_at']}" if ready else ""))
            ok &= ready
        else:
            from .globe import global_no2

            snap = global_no2(24)
            print(f"[ready] globe snapshot {snap['meta']['fetched_at']}, newest orbit {snap['meta']['newest_obs']},"
                  f" coverage {snap['meta']['coverage']:.0%}{' (STALE: Earth Engine failed)' if snap['meta']['stale'] else ''}")

    for city, day in args.report:
        try:
            bbox = city_bbox(city)
        except KeyError as exc:
            print(f"[ERROR] {city}: {exc}")
            ok = False
            continue
        parsed = service._parse_date(day)
        if str(parsed.date()) != day:
            print(f"[note] {city}: {day} has no weather data yet; using {parsed.date()}")
        stored = service.stored_run(bbox, parsed)
        if args.check:
            print(f"[{'ready' if stored else 'MISSING'}] {city} {parsed.date()}")
            ok &= stored is not None
            continue
        if offline():
            print("[ERROR] ML_ENGINE_OFFLINE is on; turn it off to prepare new runs")
            return 1
        from . import report

        report.RUN_WAIT_S = 24 * 3600  # wait for the full run instead of falling back to a stored map
        for lang in args.languages:
            started = time.monotonic()
            _, meta = report.generate_report(city=city, date=day, language=lang, use_ai=args.ai)
            good = meta["notice"] is None and meta["status"] != "unavailable"
            ok &= good
            print(f"[{'ready' if good else 'PROBLEM'}] {city} {meta['date']} {lang}: status {meta['status']}, "
                  f"narrative {meta['narrative']}, {time.monotonic() - started:.0f} s"
                  + ("" if good else f" (notice: {meta['notice']})"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
