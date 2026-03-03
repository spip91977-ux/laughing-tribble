#!/usr/bin/env python3
"""
KJ Land Surveyors — PDF Quote Generator
Phase 4: Bold modern design with survey imagery
Usage: python3 generate_quote.py --client "James Mwangi" --phone "254712345678" \
         --county "Kiambu" --service "Land Subdivision" --plot "2 acres" \
         --items "Survey fieldwork:45000,Mutation documents:15000,County approvals:8000"
"""

import sys
import os
import json
import argparse
from datetime import datetime, timedelta
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

# ── BRAND PALETTE ──────────────────────────────────
NAVY       = colors.HexColor('#0a1628')
DARK_BLUE  = colors.HexColor('#0f2a4a')
MID_BLUE   = colors.HexColor('#1e4a7a')
GOLD       = colors.HexColor('#d4a017')
GOLD_LIGHT = colors.HexColor('#f0c040')
WHITE      = colors.white
OFF_WHITE  = colors.HexColor('#f8f6f0')
LIGHT_GRAY = colors.HexColor('#e8e4dc')
MID_GRAY   = colors.HexColor('#8a8070')
TEXT_DARK  = colors.HexColor('#1a1410')
TEXT_MID   = colors.HexColor('#3a3020')
GREEN_OK   = colors.HexColor('#1a6b3c')

W, H = A4  # 595.27 x 841.89 pts

def generate_quote(
    client_name,
    client_phone,
    client_county,
    service,
    plot_size,
    line_items,       # list of (description, amount_kes)
    quote_ref=None,
    valid_days=30,
    output_path=None,
    client_email="",
    notes="",
):
    ref = quote_ref or f"KJ-Q-{datetime.now().strftime('%Y%m%d')}-{datetime.now().strftime('%H%M')}"
    output_path = output_path or f"KJ_Quote_{ref}.pdf"
    valid_until = (datetime.now() + timedelta(days=valid_days)).strftime("%d %B %Y")
    date_str    = datetime.now().strftime("%d %B %Y")

    subtotal = sum(amt for _, amt in line_items)
    vat_note = "All prices exclusive of VAT"

    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle(f"KJ Land Surveyors — Quotation {ref}")
    c.setAuthor("KJ Land Surveyors & Realtors Consultants")
    c.setSubject(f"Land Survey Quotation — {service}")

    # ══════════════════════════════════════════════
    # HEADER BAND — full-width dark navy
    # ══════════════════════════════════════════════
    header_h = 110 * mm
    c.setFillColor(NAVY)
    c.rect(0, H - header_h, W, header_h, fill=1, stroke=0)

    # Survey grid pattern overlay
    c.setStrokeColor(colors.HexColor('#ffffff'))
    c.setLineWidth(0.3)
    c.setStrokeAlpha(0.05)
    for x in range(0, int(W), 18):
        c.line(x, H - header_h, x, H)
    for y in range(int(H - header_h), int(H), 18):
        c.line(0, y, W, y)
    c.setStrokeAlpha(1.0)

    # Gold accent bar (left edge)
    c.setFillColor(GOLD)
    c.rect(0, H - header_h, 6, header_h, fill=1, stroke=0)

    # Diagonal accent shape (top right)
    c.setFillColor(MID_BLUE)
    path = c.beginPath()
    path.moveTo(W - 120*mm, H)
    path.lineTo(W, H)
    path.lineTo(W, H - header_h)
    path.lineTo(W - 80*mm, H - header_h)
    path.close()
    c.drawPath(path, fill=1, stroke=0)

    # Coordinate crosshair decoration (top right area)
    cx_x, cx_y = W - 40*mm, H - 28*mm
    c.setStrokeColor(GOLD)
    c.setStrokeAlpha(0.35)
    c.setLineWidth(0.8)
    c.line(cx_x - 15*mm, cx_y, cx_x + 15*mm, cx_y)
    c.line(cx_x, cx_y - 15*mm, cx_x, cx_y + 15*mm)
    c.circle(cx_x, cx_y, 6*mm, fill=0, stroke=1)
    c.circle(cx_x, cx_y, 1.5*mm, fill=0, stroke=1)
    c.setStrokeAlpha(1.0)

    # KJ Monogram badge
    badge_x, badge_y = 18*mm, H - 22*mm
    c.setFillColor(GOLD)
    c.roundRect(badge_x - 2*mm, badge_y - 13*mm, 22*mm, 18*mm, 3*mm, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(badge_x + 9*mm, badge_y - 8*mm, "KJ")

    # Company name
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(46*mm, H - 14*mm, "KJ Land Surveyors")
    c.setFont("Helvetica", 9)
    c.setFillColor(GOLD_LIGHT)
    c.drawString(46*mm, H - 21*mm, "& Realtors Consultants")
    c.setFillColor(colors.HexColor('#a0b8d0'))
    c.setFont("Helvetica", 7.5)
    c.drawString(46*mm, H - 28*mm, "ISK Registered  ·  Ministry of Lands Approved  ·  All 47 Counties")

    # QUOTATION label
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(16*mm, H - 52*mm, "QUOTATION")
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(16*mm, H - 60*mm, f"REF: {ref}")

    # Date / validity pills
    pill_y = H - 75*mm
    def draw_pill(x, label, value):
        c.setFillColor(colors.HexColor('#1e3a5a'))
        c.roundRect(x, pill_y - 3*mm, 52*mm, 10*mm, 2*mm, fill=1, stroke=0)
        c.setFillColor(GOLD_LIGHT)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(x + 2*mm, pill_y + 4*mm, label.upper())
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 8)
        c.drawString(x + 2*mm, pill_y - 0.5*mm, value)

    draw_pill(16*mm, "Date Issued", date_str)
    draw_pill(72*mm, "Valid Until", valid_until)
    draw_pill(128*mm, "Service", service[:22])

    # Survey coordinates (decorative)
    c.setFillColor(colors.HexColor('#4a7090'))
    c.setFont("Helvetica", 6.5)
    c.drawRightString(W - 8*mm, H - 92*mm, "LAT –1.2921° S  ·  LON 36.8219° E  ·  DATUM ARC 1960  ·  ZONE 37S")

    # ══════════════════════════════════════════════
    # CLIENT SECTION
    # ══════════════════════════════════════════════
    sec_y = H - header_h - 12*mm

    # Two-column: Client | Contact
    c.setFillColor(OFF_WHITE)
    c.roundRect(12*mm, sec_y - 42*mm, 122*mm, 40*mm, 3*mm, fill=1, stroke=0)
    c.setFillColor(LIGHT_GRAY)
    c.roundRect(140*mm, sec_y - 42*mm, 53*mm, 40*mm, 3*mm, fill=1, stroke=0)

    # Section labels
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(15*mm, sec_y - 5*mm, "PREPARED FOR")
    c.drawString(143*mm, sec_y - 5*mm, "CONTACT")

    # Client details
    c.setFillColor(TEXT_DARK)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(15*mm, sec_y - 14*mm, client_name)
    c.setFont("Helvetica", 9)
    c.setFillColor(TEXT_MID)
    c.drawString(15*mm, sec_y - 22*mm, f"County: {client_county}")
    if plot_size:
        c.drawString(15*mm, sec_y - 30*mm, f"Plot Size: {plot_size}")
    if client_email:
        c.drawString(15*mm, sec_y - 38*mm, client_email)

    # Contact
    c.setFillColor(TEXT_DARK)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(143*mm, sec_y - 14*mm, "KJ Land Surveyors")
    c.setFont("Helvetica", 8)
    c.setFillColor(TEXT_MID)
    c.drawString(143*mm, sec_y - 21.5*mm, f"+{client_phone}" if not client_phone.startswith('+') else client_phone)
    c.drawString(143*mm, sec_y - 28*mm, "+254 720 397313")
    c.drawString(143*mm, sec_y - 34.5*mm, "info@kjlandsurveyors.co.ke")
    c.drawString(143*mm, sec_y - 41*mm, "Nairobi, Kenya")

    # ══════════════════════════════════════════════
    # SERVICE DESCRIPTION BANNER
    # ══════════════════════════════════════════════
    srv_y = sec_y - 50*mm
    c.setFillColor(DARK_BLUE)
    c.roundRect(12*mm, srv_y - 8*mm, 181*mm, 12*mm, 2*mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.rect(12*mm, srv_y - 8*mm, 4*mm, 12*mm, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20*mm, srv_y - 1.5*mm, f"SERVICE:  {service.upper()}")

    # ══════════════════════════════════════════════
    # LINE ITEMS TABLE
    # ══════════════════════════════════════════════
    tbl_y = srv_y - 16*mm

    # Table header
    c.setFillColor(NAVY)
    c.rect(12*mm, tbl_y - 8*mm, 181*mm, 9*mm, fill=1, stroke=0)
    c.setFillColor(GOLD_LIGHT)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(15*mm, tbl_y - 4*mm, "#")
    c.drawString(22*mm, tbl_y - 4*mm, "DESCRIPTION")
    c.drawRightString(190*mm, tbl_y - 4*mm, "AMOUNT (KES)")

    # Rows
    row_h = 11*mm
    row_y = tbl_y - 8*mm
    for i, (desc, amount) in enumerate(line_items):
        row_y -= row_h
        bg = OFF_WHITE if i % 2 == 0 else WHITE
        c.setFillColor(bg)
        c.rect(12*mm, row_y, 181*mm, row_h, fill=1, stroke=0)

        # row number
        c.setFillColor(GOLD)
        c.circle(17.5*mm, row_y + 5.5*mm, 3.5*mm, fill=1, stroke=0)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(17.5*mm, row_y + 3.8*mm, str(i + 1))

        c.setFillColor(TEXT_DARK)
        c.setFont("Helvetica", 9)
        c.drawString(22*mm, row_y + 3.5*mm, desc)
        c.setFont("Helvetica-Bold", 9)
        c.drawRightString(190*mm, row_y + 3.5*mm, f"KES {amount:,.0f}")

        # subtle left border
        c.setStrokeColor(LIGHT_GRAY)
        c.setLineWidth(0.5)
        c.line(12*mm, row_y, 12*mm, row_y + row_h)

    # ══════════════════════════════════════════════
    # TOTAL BOX
    # ══════════════════════════════════════════════
    total_y = row_y - 6*mm

    # Subtotal line
    c.setFillColor(LIGHT_GRAY)
    c.rect(120*mm, total_y - 3*mm, 73*mm, 8*mm, fill=1, stroke=0)
    c.setFillColor(TEXT_MID)
    c.setFont("Helvetica", 8)
    c.drawString(123*mm, total_y + 1.5*mm, "SUBTOTAL (Ex-VAT)")
    c.setFont("Helvetica-Bold", 8)
    c.drawRightString(190*mm, total_y + 1.5*mm, f"KES {subtotal:,.0f}")

    # VAT note
    total_y -= 7*mm
    c.setFillColor(TEXT_MID)
    c.setFont("Helvetica-Oblique", 7.5)
    c.drawString(123*mm, total_y + 1.5*mm, vat_note)

    # Grand total banner
    total_y -= 12*mm
    c.setFillColor(NAVY)
    c.roundRect(100*mm, total_y - 4*mm, 93*mm, 14*mm, 2*mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(103*mm, total_y + 4.5*mm, "TOTAL DUE")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawRightString(190*mm, total_y + 3.5*mm, f"KES {subtotal:,.0f}")

    # ══════════════════════════════════════════════
    # NOTES / SCOPE
    # ══════════════════════════════════════════════
    notes_y = total_y - 16*mm
    if notes:
        c.setFillColor(colors.HexColor('#f0f4f8'))
        c.roundRect(12*mm, notes_y - 28*mm, 84*mm, 30*mm, 2*mm, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(15*mm, notes_y - 4*mm, "NOTES & SCOPE")
        c.setFillColor(TEXT_MID)
        c.setFont("Helvetica", 8)
        lines = notes[:300].split('\n')
        ny = notes_y - 12*mm
        for line in lines[:5]:
            c.drawString(15*mm, ny, line[:80])
            ny -= 5*mm

    # Payment terms (right side)
    terms_x = 100*mm if notes else 12*mm
    terms_w = 93*mm if notes else 181*mm
    c.setFillColor(colors.HexColor('#f0f4f8'))
    c.roundRect(terms_x, notes_y - 28*mm, terms_w, 30*mm, 2*mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(terms_x + 3*mm, notes_y - 4*mm, "PAYMENT TERMS & PROCESS")
    c.setFillColor(TEXT_MID)
    c.setFont("Helvetica", 8)
    terms = [
        "50% deposit on acceptance of quotation",
        "Balance payable upon project completion",
        "M-Pesa Paybill / Bank transfer accepted",
        f"Quotation valid until {valid_until}",
    ]
    ty = notes_y - 12*mm
    for t in terms:
        c.setFillColor(GOLD)
        c.circle(terms_x + 5*mm, ty + 2*mm, 1.5*mm, fill=1, stroke=0)
        c.setFillColor(TEXT_MID)
        c.drawString(terms_x + 9*mm, ty, t)
        ty -= 6*mm

    # ══════════════════════════════════════════════
    # PROCESS STEPS STRIP
    # ══════════════════════════════════════════════
    strip_y = notes_y - 38*mm
    c.setFillColor(DARK_BLUE)
    c.rect(0, strip_y - 22*mm, W, 22*mm, fill=1, stroke=0)

    steps = [
        ("01", "Consultation", "Review & agree scope"),
        ("02", "Site Survey", "RTK GPS fieldwork"),
        ("03", "Processing", "Certified plans & docs"),
        ("04", "Delivery", "Title deed / survey cert"),
    ]
    step_w = W / len(steps)
    for i, (num, title, sub) in enumerate(steps):
        sx = i * step_w + step_w / 2
        # connector line
        if i < len(steps) - 1:
            c.setStrokeColor(GOLD)
            c.setStrokeAlpha(0.3)
            c.setLineWidth(0.6)
            c.line(sx + step_w/2 - 5, strip_y - 10*mm, sx + step_w/2 + 5, strip_y - 10*mm)
            c.setStrokeAlpha(1.0)
        c.setFillColor(GOLD)
        c.circle(sx, strip_y - 10*mm, 5*mm, fill=1, stroke=0)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(sx, strip_y - 12*mm, num)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(sx, strip_y - 3*mm, title)
        c.setFillColor(colors.HexColor('#8ab0d0'))
        c.setFont("Helvetica", 6.5)
        c.drawCentredString(sx, strip_y - 19*mm, sub)

    # ══════════════════════════════════════════════
    # ACCEPTANCE SECTION
    # ══════════════════════════════════════════════
    acc_y = strip_y - 32*mm
    c.setFillColor(OFF_WHITE)
    c.roundRect(12*mm, acc_y - 24*mm, 181*mm, 25*mm, 2*mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(15*mm, acc_y - 4*mm, "ACCEPTANCE — Sign & return to confirm your order")

    sig_items = [
        (15*mm,   "Client Signature", 70*mm),
        (95*mm,   "Printed Name",     70*mm),
        (155*mm,  "Date",             38*mm),
    ]
    for sx, label, sw in sig_items:
        line_y = acc_y - 18*mm
        c.setStrokeColor(LIGHT_GRAY)
        c.setLineWidth(0.8)
        c.line(sx, line_y, sx + sw, line_y)
        c.setFillColor(MID_GRAY)
        c.setFont("Helvetica", 7)
        c.drawString(sx, line_y - 5*mm, label)

    # ══════════════════════════════════════════════
    # FOOTER
    # ══════════════════════════════════════════════
    c.setFillColor(NAVY)
    c.rect(0, 0, W, 18*mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.rect(0, 18*mm, W, 1.5, fill=1, stroke=0)

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(W/2, 12*mm, "KJ Land Surveyors & Realtors Consultants")
    c.setFillColor(colors.HexColor('#7090b0'))
    c.setFont("Helvetica", 7)
    c.drawCentredString(W/2, 7*mm, "+254 720 397313   ·   info@kjlandsurveyors.co.ke   ·   Nairobi, Kenya   ·   ISK Registered")
    c.setFont("Helvetica", 6.5)
    c.drawCentredString(W/2, 3*mm, f"Quotation Reference: {ref}   ·   Generated: {date_str}   ·   Valid: {valid_until}")

    # Gold corners
    for corner_x, corner_y, flip_x, flip_y in [(0, H, 1, -1), (W, H, -1, -1)]:
        c.setFillColor(GOLD)
        c.setFillAlpha(0.15)
        path = c.beginPath()
        path.moveTo(corner_x, corner_y)
        path.lineTo(corner_x + flip_x * 20*mm, corner_y)
        path.lineTo(corner_x, corner_y + flip_y * 20*mm)
        path.close()
        c.drawPath(path, fill=1, stroke=0)
        c.setFillAlpha(1.0)

    c.save()
    return output_path


# ── CLI ENTRYPOINT ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate a KJ Land Surveyors PDF quote")
    parser.add_argument("--client",  required=True, help="Client full name")
    parser.add_argument("--phone",   required=True, help="Client phone e.g. 254712345678")
    parser.add_argument("--county",  required=True, help="Client county")
    parser.add_argument("--service", required=True, help="Service type")
    parser.add_argument("--plot",    default="",    help="Plot size e.g. 2 acres")
    parser.add_argument("--email",   default="",    help="Client email")
    parser.add_argument("--notes",   default="",    help="Scope notes")
    parser.add_argument("--ref",     default=None,  help="Custom quote reference")
    parser.add_argument("--output",  default=None,  help="Output PDF file path")
    parser.add_argument("--items",   required=True,
                        help='Line items as JSON: [["desc",12000],["desc2",8000]] '
                             'or shorthand: "desc1:12000,desc2:8000"')
    args = parser.parse_args()

    # Parse line items
    try:
        raw = args.items.strip()
        if raw.startswith("["):
            line_items = [tuple(x) for x in json.loads(raw)]
        else:
            line_items = []
            for part in raw.split(","):
                desc, amt = part.rsplit(":", 1)
                line_items.append((desc.strip(), float(amt.strip())))
    except Exception as e:
        print(f"Error parsing --items: {e}", file=sys.stderr)
        sys.exit(1)

    out = generate_quote(
        client_name=args.client,
        client_phone=args.phone,
        client_county=args.county,
        service=args.service,
        plot_size=args.plot,
        line_items=line_items,
        quote_ref=args.ref,
        output_path=args.output,
        client_email=args.email,
        notes=args.notes,
    )
    print(f"✅ Quote generated: {out}")
