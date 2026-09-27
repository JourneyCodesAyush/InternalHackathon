"""PDF rendering of an area NO2 report (English, Hindi, Marathi).

Devanagari needs a TrueType font with Devanagari glyphs plus text shaping (conjuncts, vowel-sign
placement). ReportLab shapes with HarfBuzz (``uharfbuzz``) when a paragraph style has ``shaping=1``;
every text in the document — table cells, header and footer included — is therefore a shaped
Paragraph. Font lookup: ``REPORT_FONT_REGULAR`` / ``REPORT_FONT_BOLD`` environment variables, then
common system fonts (Windows Nirmala UI, Noto Sans Devanagari, Lohit Devanagari).
"""

from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (Image as RLImage, KeepTogether, ListFlowable, ListItem, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

from . import texts as tx
from .analysis import BAND_KEYS, NAAQS_24H, NAAQS_ANNUAL, WHO_24H

INK = colors.HexColor("#1b2430")
MUTED = colors.HexColor("#5b6675")
ACCENT = colors.HexColor("#1f4e79")
RULE = colors.HexColor("#d5dbe3")
ZEBRA = colors.HexColor("#f4f6f9")
log = logging.getLogger(__name__)
NOTICE_FILL, NOTICE_EDGE = "#fff4e0", "#ef6c00"
STATUS_COLOURS = {"normal": "#2e7d32", "elevated": "#f9a825", "critical": "#ef6c00", "critical_spike": "#c62828"}
BAND_COLOURS = {"normal": "#2e7d32", "moderate": "#f9a825", "unhealthy": "#ef6c00", "hazardous": "#c62828"}
# Continuous map colours anchored on the SRS band edges (ug/m3).
COLOUR_STOPS = [(0, (46, 125, 50)), (40, (249, 168, 37)), (80, (239, 108, 0)), (180, (198, 40, 40)),
                (260, (106, 27, 154))]

FONT_CANDIDATES = [  # (regular path, regular index, bold path, bold index)
    (r"C:\Windows\Fonts\Nirmala.ttc", 0, r"C:\Windows\Fonts\Nirmala.ttc", 1),
    ("/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf", 0,
     "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansDevanagari-Regular.ttf", 0,
     "/usr/share/fonts/opentype/noto/NotoSansDevanagari-Bold.ttf", 0),
    ("/usr/share/fonts/noto/NotoSansDevanagari-Regular.ttf", 0, "/usr/share/fonts/noto/NotoSansDevanagari-Bold.ttf", 0),
    ("/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf", 0,
     "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf", 0),
    ("/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc", 0,
     "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc", 1),
]
_fonts: tuple[str, str, bool] | None = None


def resolve_fonts() -> tuple[str, str, bool]:
    """(regular name, bold name, devanagari_capable). Registers the font once per process."""
    global _fonts
    if _fonts is not None:
        return _fonts
    candidates = []
    if os.environ.get("REPORT_FONT_REGULAR"):
        reg = os.environ["REPORT_FONT_REGULAR"]
        candidates.append((reg, 0, os.environ.get("REPORT_FONT_BOLD", reg), 0))
    candidates += FONT_CANDIDATES
    for reg, ri, bold, bi in candidates:
        if Path(reg).exists():
            try:
                pdfmetrics.registerFont(TTFont("RptRegular", reg, subfontIndex=ri))
                pdfmetrics.registerFont(TTFont("RptBold", bold if Path(bold).exists() else reg,
                                               subfontIndex=bi if Path(bold).exists() else ri))
                pdfmetrics.registerFontFamily("RptRegular", normal="RptRegular", bold="RptBold",
                                              italic="RptRegular", boldItalic="RptBold")
                _fonts = ("RptRegular", "RptBold", True)
                return _fonts
            except Exception:  # unreadable font file: try the next one
                continue
    _fonts = ("Helvetica", "Helvetica-Bold", False)
    return _fonts


def _styles(regular: str, bold: str, shaping: bool) -> dict[str, ParagraphStyle]:
    s = 1 if shaping else 0
    base = dict(fontName=regular, textColor=INK, shaping=s)
    return {
        "title": ParagraphStyle("title", fontName=bold, fontSize=20, leading=26, textColor=ACCENT, shaping=s),
        "subtitle": ParagraphStyle("subtitle", fontSize=10.5, leading=14, textColor=MUTED, spaceBefore=6, **{k: v for k, v in base.items() if k != "textColor"}),
        "h2": ParagraphStyle("h2", fontName=bold, fontSize=13.5, leading=18, textColor=ACCENT, spaceBefore=12, spaceAfter=6,
                             keepWithNext=1, shaping=s),
        "body": ParagraphStyle("body", fontSize=10, leading=14.5, spaceAfter=4, **base),
        "small": ParagraphStyle("small", fontSize=8.5, leading=11.5, **{**base, "textColor": MUTED}),
        "cell": ParagraphStyle("cell", fontSize=9, leading=12, **base),
        "cellb": ParagraphStyle("cellb", fontName=bold, fontSize=9, leading=12, textColor=INK, shaping=s),
        "head": ParagraphStyle("head", fontName=bold, fontSize=9, leading=12, textColor=colors.white, shaping=s),
        "kpi": ParagraphStyle("kpi", fontName=bold, fontSize=17, leading=21, textColor=INK, alignment=TA_CENTER, shaping=s),
        "kpil": ParagraphStyle("kpil", fontSize=8.5, leading=11, alignment=TA_CENTER, **{**base, "textColor": MUTED}),
        "badge": ParagraphStyle("badge", fontName=bold, fontSize=12, leading=16, textColor=colors.white, shaping=s),
        "badged": ParagraphStyle("badged", fontSize=9.5, leading=13, textColor=colors.white, fontName=regular, shaping=s),
    }


def _ai_text(text: str) -> str:
    """Escape model output for ReportLab markup and format NO2."""
    return escape(text).replace("NO₂", tx.NO2).replace("NO2", tx.NO2)


def _colourise(values: np.ndarray) -> np.ndarray:
    v = np.nan_to_num(values, nan=0.0)
    out = np.zeros(v.shape + (3,), dtype=np.float64)
    xs = [s[0] for s in COLOUR_STOPS]
    for ch in range(3):
        out[..., ch] = np.interp(v, xs, [s[1][ch] for s in COLOUR_STOPS])
    out[~np.isfinite(values)] = (220, 220, 220)
    return out.astype(np.uint8)


def map_image(surface: np.ndarray, hotspots: list[dict], grid, scale: int = 4,
              water: np.ndarray | None = None) -> io.BytesIO:
    rgb = _colourise(surface).astype(np.float64)
    if water is not None:  # mute open water so the coastline and land shape read at a glance
        rgb[water] = 0.3 * rgb[water] + 0.7 * np.array([214, 224, 234])
    img = Image.fromarray(rgb.astype(np.uint8)).resize((surface.shape[1] * scale, surface.shape[0] * scale), Image.NEAREST)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=int(9 * scale / 2))
    except TypeError:  # older Pillow
        font = ImageFont.load_default()
    for h in hotspots:
        col = int((h["lon"] - grid.west) / grid.res) * scale + scale // 2
        row = int((grid.north - h["lat"]) / grid.res) * scale + scale // 2
        r = 9 * scale // 2
        draw.ellipse((col - r, row - r, col + r, row + r), fill=(255, 255, 255), outline=(20, 20, 20), width=2)
        draw.text((col, row), str(h["rank"]), fill=(20, 20, 20), font=font, anchor="mm")
    draw.rectangle((0, 0, img.width - 1, img.height - 1), outline=(120, 120, 120), width=1)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _legend(width: float) -> Drawing:
    d = Drawing(width, 26)
    bar_w, x0 = width - 44, 6
    vmax = COLOUR_STOPS[-1][0]
    steps = 60
    for i in range(steps):
        v = vmax * (i + 0.5) / steps
        rgb = _colourise(np.array([[v]]))[0, 0] / 255.0
        d.add(Rect(x0 + bar_w * i / steps, 12, bar_w / steps + 0.5, 8, fillColor=colors.Color(*rgb), strokeColor=None))
    for v in (0, 40, 80, 180, 260):
        x = x0 + bar_w * v / vmax
        d.add(Line(x, 10, x, 20, strokeColor=INK, strokeWidth=0.6))
        d.add(String(x, 1, str(v), fontName="Helvetica", fontSize=7, fillColor=INK, textAnchor="middle"))
    d.add(String(x0 + bar_w + 6, 13, "µg/m³", fontName="Helvetica", fontSize=7, fillColor=MUTED, textAnchor="start"))
    return d


def trend_chart(trend: dict, width: float, height: float = 170) -> Drawing:
    d = Drawing(width, height)
    lp = LinePlot()
    lp.x, lp.y, lp.width, lp.height = 36, 22, width - 50, height - 34
    obs = [(i, v) for i, v in enumerate(trend["observed"]) if v == v]
    adj = [(i, v) for i, v in enumerate(trend["adjusted"]) if v == v]
    n = len(trend["observed"])
    lp.data = [obs, adj, [(0, NAAQS_24H), (n - 1, NAAQS_24H)]]
    lp.lines[0].strokeColor, lp.lines[0].strokeWidth = colors.HexColor("#1f77b4"), 1.6
    lp.lines[1].strokeColor, lp.lines[1].strokeWidth = colors.HexColor("#2e7d32"), 1.6
    lp.lines[2].strokeColor, lp.lines[2].strokeWidth = colors.HexColor("#c62828"), 1
    lp.lines[2].strokeDashArray = [3, 3]
    values = [v for _, v in obs + adj] + [NAAQS_24H]
    lp.yValueAxis.valueMin = 0
    lp.yValueAxis.valueMax = max(values) * 1.15
    lp.yValueAxis.labels.fontName = lp.xValueAxis.labels.fontName = "Helvetica"
    lp.yValueAxis.labels.fontSize = lp.xValueAxis.labels.fontSize = 7
    lp.xValueAxis.valueMin, lp.xValueAxis.valueMax = 0, n - 1
    step = max(1, n // 6)
    lp.xValueAxis.valueSteps = list(range(0, n, step))
    dates = trend["dates"]
    lp.xValueAxis.labelTextFormat = lambda i: f"{int(dates[int(i)][8:10])}/{int(dates[int(i)][5:7])}"
    lp.yValueAxis.gridStrokeColor = RULE
    lp.yValueAxis.visibleGrid = 1
    d.add(lp)
    return d


def _table(rows: list[list], styles: dict, widths: list[float], header: bool = True) -> Table:
    data = [[c if not isinstance(c, str) else Paragraph(c, styles["head"] if header and i == 0 else styles["cell"])
             for c in row] for i, row in enumerate(rows)]
    tbl = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("GRID", (0, 0), (-1, -1), 0.4, RULE),
             ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), ACCENT), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ZEBRA])]
    tbl.setStyle(TableStyle(style))
    return tbl


def _notice_box(text: str, title: str, st: dict, page_w: float) -> Table:
    box = Table([[Paragraph(f"<b>{escape(title)}</b>", st["cell"])], [Paragraph(escape(text), st["body"])]],
                colWidths=[page_w])
    box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(NOTICE_FILL)),
                             ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor(NOTICE_EDGE)),
                             ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 4),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return box


def build_unavailable_pdf(area_name: str, date: str, lang: str, notice: dict) -> bytes:
    """The fallback document when no model map exists: standards, hazard bands and health guidance."""
    regular, bold, deva = resolve_fonts()
    if lang != "en" and not deva:
        lang = "en"
    st = _styles(regular, bold, shaping=deva)
    L = tx.T[lang]
    buf = io.BytesIO()
    page_w = A4[0] - 3.6 * cm
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.6 * cm,
                            bottomMargin=2.0 * cm, title=f"NO2 report {area_name} {date}")
    meta = Table([[Paragraph(f"<b>{L['area']}:</b> {escape(area_name)}", st["cell"]),
                   Paragraph(f"<b>{L['report_date']}:</b> {tx.fmt_date(date, lang)}", st["cell"])],
                  [Paragraph(f"<b>{L['generated']}:</b> {generated}", st["cell"]), ""]], colWidths=[page_w / 2] * 2)
    story = [Paragraph(L["title"], st["title"]), Paragraph(L["subtitle"], st["subtitle"]), Spacer(1, 8), meta,
             Spacer(1, 8), _notice_box(tx.notice_text(notice, lang), L["h_notice"], st, page_w)]
    rows = [[L["metric"], L["standard"]],
            ["CPCB NAAQS, 24 h", f"{NAAQS_24H:.0f} {tx.UG}"],
            ["CPCB NAAQS, annual", f"{NAAQS_ANNUAL:.0f} {tx.UG}"],
            ["WHO 2021 guideline, 24 h", f"{WHO_24H:.0f} {tx.UG}"]]
    story += [Paragraph(L["h_standards"], st["h2"]), _table(rows, st, [page_w * 0.6, page_w * 0.4])]
    band_rows = [["", L["band"], L["range"], L["advice"]]]
    ranges = {"normal": "0–40", "moderate": "40–80", "unhealthy": "80–180", "hazardous": "> 180"}
    for code in (1, 2, 3, 4):
        k = BAND_KEYS[code]
        band_rows.append(["", tx.BAND[lang][k], ranges[k], tx.BAND_ADVICE[lang][k]])
    band_tbl = _table(band_rows, st, [page_w * 0.03, page_w * 0.2, page_w * 0.15, page_w * 0.62])
    band_tbl.setStyle(TableStyle([("BACKGROUND", (0, i), (0, i), colors.HexColor(BAND_COLOURS[BAND_KEYS[i]]))
                                  for i in (1, 2, 3, 4)]))
    story += [Spacer(1, 6), band_tbl]
    doc.build(story)
    return buf.getvalue()


def build_pdf(facts: dict, lang: str, narrative: dict | None, language_fallback: bool = False) -> bytes:
    regular, bold, deva = resolve_fonts()
    st = _styles(regular, bold, shaping=deva)
    L = tx.T[lang]
    cur, pop, fc = facts["current"], facts.get("population"), facts["forecast"]
    buf = io.BytesIO()
    page_w = A4[0] - 3.6 * cm
    ai = narrative or {}
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.line(1.8 * cm, 1.45 * cm, A4[0] - 1.8 * cm, 1.45 * cm)
        foot = Paragraph(f"{facts['area']['name']} · {tx.fmt_date(facts['date'], lang)} · {L['page']} {doc.page}", st["small"])
        w, h = foot.wrap(page_w, 2 * cm)
        foot.drawOn(canvas, 1.8 * cm, 1.45 * cm - h - 3)
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.6 * cm,
                            bottomMargin=2.0 * cm, title=f"NO2 report {facts['area']['name']} {facts['date']}")
    story = [Paragraph(L["title"], st["title"]), Paragraph(L["subtitle"], st["subtitle"]), Spacer(1, 8)]

    meta = [[Paragraph(f"<b>{L['area']}:</b> {escape(facts['area']['name'])}", st["cell"]),
             Paragraph(f"<b>{L['report_date']}:</b> {tx.fmt_date(facts['date'], lang)}", st["cell"])],
            [Paragraph(f"<b>{L['window']}:</b> {tx.fmt_date(facts['window']['start'], lang)} – "
                       f"{tx.fmt_date(facts['window']['end'], lang)}", st["cell"]),
             Paragraph(f"<b>{L['generated']}:</b> {generated}", st["cell"])]]
    mt = Table(meta, colWidths=[page_w / 2] * 2)
    mt.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story += [mt, Spacer(1, 8)]

    badge = Table([[Paragraph(f"{L['status']}: {tx.STATUS[lang][cur['status']]}", st["badge"])],
                   [Paragraph(tx.STATUS_DESC[lang][cur["status"]], st["badged"])]], colWidths=[page_w])
    badge.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(STATUS_COLOURS[cur["status"]])),
                               ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 5),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [badge, Spacer(1, 8)]
    if facts.get("notice"):
        story += [_notice_box(tx.notice_text(facts["notice"], lang), L["h_notice"], st, page_w), Spacer(1, 8)]

    sign = "+" if cur["pct_vs_naaqs"] > 0 else ""
    kpis = [(f"{cur['mean']:.0f} {tx.UG}", L["kpi_mean"]), (f"{sign}{cur['pct_vs_naaqs']:.0f}%", L["kpi_vs"]),
            (f"{tx.pct(cur['share_above_naaqs'])}%", L["kpi_area"]),
            (tx.fmt_people(pop["above_naaqs"], lang) if pop else "—", L["kpi_people"])]
    kt = Table([[Paragraph(v, st["kpi"]) for v, _ in kpis], [Paragraph(l, st["kpil"]) for _, l in kpis]],
               colWidths=[page_w / 4] * 4)
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, RULE), ("INNERGRID", (0, 0), (-1, -1), 0.5, RULE),
                            ("BACKGROUND", (0, 0), (-1, -1), ZEBRA), ("TOPPADDING", (0, 0), (-1, -1), 6)]))
    story += [kt]

    story += [Paragraph(L["h_summary"], st["h2"]),
              Paragraph(_ai_text(ai["executive_summary"]) if "executive_summary" in ai else tx.summary_text(facts, lang), st["body"])]

    diff = lambda v, s: f"{'+' if v > s else ''}{(v - s) / s * 100:.0f}%"  # noqa: E731
    rows = [[L["metric"], L["current"], L["standard"], L["difference"]],
            [L["row_mean"], f"{cur['mean']:.0f} {tx.UG}", f"{NAAQS_24H:.0f} (CPCB 24 h)", diff(cur["mean"], NAAQS_24H)],
            [L["row_p95"], f"{cur['p95']:.0f} {tx.UG}", f"{NAAQS_24H:.0f}", diff(cur["p95"], NAAQS_24H)],
            [L["row_max"], f"{cur['max']:.0f} {tx.UG}", f"{NAAQS_24H:.0f}", diff(cur["max"], NAAQS_24H)],
            [L["row_window"], f"{facts['window_stats']['mean']:.0f} {tx.UG}", f"{NAAQS_ANNUAL:.0f} (CPCB annual)",
             diff(facts["window_stats"]["mean"], NAAQS_ANNUAL)],
            [L["row_share_naaqs"], f"{tx.pct(cur['share_above_naaqs'])}%", "—", "—"],
            [L["row_share_who"], f"{tx.pct(cur['share_above_who'])}%", f"{WHO_24H:.0f} (WHO 24 h)", "—"]]
    story += [Paragraph(L["h_comparison"], st["h2"]), _table(rows, st, [page_w * 0.42, page_w * 0.18, page_w * 0.24, page_w * 0.16])]
    band_rows = [["", L["band"], L["range"], L["share_area"], L["people"], L["advice"]]]
    ranges = {"normal": "0–40", "moderate": "40–80", "unhealthy": "80–180", "hazardous": "> 180"}
    for code in (1, 2, 3, 4):
        k = BAND_KEYS[code]
        band_rows.append(["", tx.BAND[lang][k], ranges[k], f"{tx.pct(cur['band_shares'][k])}%",
                          tx.fmt_people(pop["by_band"][k], lang) if pop else "—", tx.BAND_ADVICE[lang][k]])
    band_tbl = _table(band_rows, st, [page_w * 0.025, page_w * 0.185, page_w * 0.12, page_w * 0.13, page_w * 0.15,
                                      page_w * 0.39])
    band_tbl.setStyle(TableStyle([("BACKGROUND", (0, i), (0, i), colors.HexColor(BAND_COLOURS[BAND_KEYS[i]]))
                                  for i in (1, 2, 3, 4)]))
    story += [Spacer(1, 6), band_tbl]

    col = facts.get("column")
    if col:
        def both(v):  # µmol/m² and mol/m² (satellite unit) side by side
            if v is None:
                return "—", "—"
            mant, exp = f"{v * 1e-6:.2e}".split("e")
            return f"{v:.1f}", f"{mant} × 10<super>{int(exp)}</super>"
        rows = [[L["metric"], "µmol/m²", "mol/m²"]]
        for key, value in (("col_obs", col["observed_mean"]), ("col_max", col["observed_max"]),
                           ("col_filled", col["filled_mean"])):
            rows.append([L[key], *both(value)])
        rows.append([L["col_cloud"], f"{col['cloud_share'] * 100:.0f}%", "—"])
        story += [KeepTogether([Paragraph(L["h_column"], st["h2"]),
                                _table(rows, st, [page_w * 0.52, page_w * 0.2, page_w * 0.28]),
                                Spacer(1, 3), Paragraph(L["col_note"], st["small"])])]

    try:
        grid = facts["grid"]
        img_buf = map_image(facts["surface_map"], facts["hotspots"], grid, water=facts.get("water_mask"))
        aspect = facts["surface_map"].shape[0] / facts["surface_map"].shape[1]
        map_w = min(page_w * 0.62, 11 * cm / aspect)
        hot_rows = [[L["hotspot"], L["location"], L["value"], L["sources"]]]
        for h in facts["hotspots"]:
            hot_rows.append([str(h["rank"]), f"{escape(h['near'])}<br/><font size='7.5' color='#5b6675'>{h['lat']:.3f}°N, "
                                             f"{h['lon']:.3f}°E</font>",
                             f"{h['value']:.0f} ({tx.BAND[lang][h['band']]})", ", ".join(tx.SOURCE[lang][s] for s in h["sources"])])
        story += [Paragraph(L["h_map"], st["h2"]),
                  KeepTogether([RLImage(img_buf, width=map_w, height=map_w * aspect), _legend(map_w),
                                Paragraph(L["map_caption"].format(no2=tx.NO2, ug=tx.UG, date=tx.fmt_date(facts["date"], lang),
                                                                  max=f"{cur['max']:.0f}", near=escape(cur["max_near"])), st["small"])]),
                  Spacer(1, 6), _table(hot_rows, st, [page_w * 0.06, page_w * 0.36, page_w * 0.24, page_w * 0.34])]
    except Exception:  # noqa: BLE001 - the rest of the report is still useful without the figure
        log.exception("Map figure failed")
        story += [Paragraph(L["h_map"], st["h2"]), Paragraph(L["no_map"], st["body"])]

    story += [Paragraph(L["h_exposure"], st["h2"])]
    story += [Paragraph(tx.population_text(facts, lang), st["body"])] if pop else [Paragraph(L["no_population"], st["body"])]

    fc_rows = [[L["horizon"], L["fc_mean"], L["fc_max"], L["fc_share"]]]
    for hz in fc["horizons"]:
        fc_rows.append([f"+{hz['hours']} h", f"{hz['mean']:.0f}", f"{hz['max']:.0f}", f"{tx.pct(hz['share_above_naaqs'])}%"])
    alert_lines = tx.forecast_texts(facts, lang)
    story += [Paragraph(L["h_forecast"], st["h2"])]
    alert_tbl = Table([["", Paragraph(line, st["body"])] for line in alert_lines], colWidths=[0.18 * cm, page_w - 0.18 * cm])
    level_colour = {"critical": "#c62828", "warning": "#ef6c00", "info": "#1f4e79"}
    alert_style = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (1, 0), (1, -1), 8),
                   ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
    for i, a in enumerate(fc["alerts"] + [None]):
        alert_style.append(("BACKGROUND", (0, i), (0, i), colors.HexColor(level_colour.get(a["level"], "#5b6675") if a else "#9aa5b1")))
    alert_tbl.setStyle(TableStyle(alert_style))
    story += [alert_tbl, Spacer(1, 6)]
    if fc["horizons"]:
        story += [_table(fc_rows, st, [page_w * 0.22, page_w * 0.26, page_w * 0.26, page_w * 0.26])]

    story += [Paragraph(L["h_trend"], st["h2"])]
    if facts.get("trend"):
        story += [trend_chart(facts["trend"], page_w), Paragraph(L["trend_legend"].format(ug=tx.UG), st["small"]),
                  Spacer(1, 4)]
    story += [Paragraph(" ".join(tx.trend_texts(facts, lang)), st["body"])]

    story += [Paragraph(L["h_risk"], st["h2"]),
              Paragraph(_ai_text(ai["risk_context"]) if "risk_context" in ai else tx.risk_text(facts, lang), st["body"])]
    recos = [_ai_text(r) for r in ai["recommendations"]] if "recommendations" in ai else tx.recommendations(facts, lang)
    story += [Paragraph(L["h_reco"], st["h2"]),
              ListFlowable([ListItem(Paragraph(r, st["body"]), leftIndent=12) for r in recos], bulletType="bullet",
                           start="•", leftIndent=12)]

    story += [Paragraph(L["h_method"], st["h2"]), Paragraph(tx.method_text(facts, lang), st["small"]), Spacer(1, 4),
              Paragraph(L["narrative_ai"] if narrative else L["narrative_template"], st["small"])]
    if language_fallback:
        story.append(Paragraph(tx.T["en"]["lang_fallback"], st["small"]))
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()
