"""Character sheet PDF generation using reportlab.

Layout:
  Page 1 — Cover: character name, creation date, Mely AI branding
  Page 2 — DNA Parameters: table of traits + auto_prompt
  Page 3 — Reference Images: 3x3 grid of training images (max 9)
  Page 4+ — Costumes: one section per costume (name + prompt + 2x2 previews)

Chinese font detection order:
  1. macOS: /System/Library/Fonts/Supplemental/NotoSansCJKsc-Regular.otf
  2. Linux: /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
  3. Windows: C:/Windows/Fonts/msyh.ttc
  4. Fallback: reportlab built-in UniGB-UCS2-H (basic CJK support)
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# reportlab imports
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
)


class PDFExportError(Exception):
    pass


class PDFCharacterNotFoundError(PDFExportError):
    pass


@dataclass
class CostumeSheetEntry:
    name: str
    costume_prompt: str
    preview_image_paths: list[Path] = field(default_factory=list)


@dataclass
class CharacterSheetData:
    character_name: str
    character_id: str
    created_at: str
    dna: dict
    auto_prompt: str
    trigger_word: str | None
    recommended_weight: float | None
    base_checkpoint: str | None
    training_status: str | None
    costumes: list[CostumeSheetEntry]
    reference_images: list[Path]
    proof_chain_length: int


_FONT_REGISTERED: str | None = None


def _register_chinese_font() -> str:
    global _FONT_REGISTERED
    if _FONT_REGISTERED:
        return _FONT_REGISTERED

    font_candidates = [
        ("/System/Library/Fonts/Supplemental/NotoSansCJKsc-Regular.otf", "NotoSansCJKsc"),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "NotoSansCJK"),
        ("C:/Windows/Fonts/msyh.ttc", "MicrosoftYaHei"),
    ]
    for font_path, font_name in font_candidates:
        if Path(font_path).exists():
            try:
                pdfmetrics.registerFont(TTFont(font_name, font_path))
                _FONT_REGISTERED = font_name
                return font_name
            except Exception:
                continue

    # Fallback: reportlab built-in CJK font
    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        _FONT_REGISTERED = "STSong-Light"
        return "STSong-Light"
    except Exception:
        pass

    _FONT_REGISTERED = "Helvetica"
    return "Helvetica"


def aggregate_character_sheet_data(
    conn: sqlite3.Connection,
    data_root: Path,
    character_id: str,
) -> CharacterSheetData:
    conn.row_factory = sqlite3.Row

    char_row = conn.execute(
        "SELECT id, name, created_at FROM characters WHERE id = ?", (character_id,)
    ).fetchone()
    if char_row is None:
        raise PDFCharacterNotFoundError("角色不存在，请刷新后重试。")

    dna_row = conn.execute(
        "SELECT * FROM character_dna WHERE character_id = ?", (character_id,)
    ).fetchone()
    dna = {}
    auto_prompt = ""
    if dna_row:
        dna = {
            "发色": dna_row["hair_color"] or "",
            "瞳色": dna_row["eye_color"] or "",
            "肤色": dna_row["skin_tone"] or "",
            "体型": dna_row["body_type"] or "",
            "风格": dna_row["style"] or "",
        }
        auto_prompt = dna_row["auto_prompt"] or ""

    va_row = conn.execute(
        "SELECT * FROM visual_assets WHERE character_id = ?", (character_id,)
    ).fetchone()
    trigger_word = va_row["trigger_word"] if va_row else None
    recommended_weight = va_row["recommended_weight"] if va_row else None
    base_checkpoint = va_row["base_checkpoint"] if va_row else None
    training_status = va_row["training_status"] if va_row else None

    costume_rows = conn.execute(
        "SELECT id, name, costume_prompt FROM costumes WHERE character_id = ? ORDER BY created_at ASC",
        (character_id,),
    ).fetchall()
    costumes = []
    for c_row in costume_rows:
        preview_rows = conn.execute(
            "SELECT image_path FROM costume_previews WHERE costume_id = ? ORDER BY sort_order ASC LIMIT 4",
            (c_row["id"],),
        ).fetchall()
        previews = [Path(p["image_path"]) for p in preview_rows if Path(p["image_path"]).exists()]
        costumes.append(CostumeSheetEntry(
            name=c_row["name"],
            costume_prompt=c_row["costume_prompt"],
            preview_image_paths=previews,
        ))

    # Training reference images (up to 9)
    training_dir = data_root / "characters" / character_id / "training_data"
    reference_images = []
    if training_dir.exists():
        for img_path in sorted(training_dir.iterdir()):
            if img_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                reference_images.append(img_path)
                if len(reference_images) >= 9:
                    break

    proof_count = conn.execute(
        "SELECT COUNT(*) FROM creation_proofs WHERE character_id = ?", (character_id,)
    ).fetchone()[0]

    return CharacterSheetData(
        character_name=char_row["name"],
        character_id=character_id,
        created_at=char_row["created_at"],
        dna=dna,
        auto_prompt=auto_prompt,
        trigger_word=trigger_word,
        recommended_weight=recommended_weight,
        base_checkpoint=base_checkpoint,
        training_status=training_status,
        costumes=costumes,
        reference_images=reference_images,
        proof_chain_length=proof_count,
    )


def generate_character_sheet_pdf(
    data: CharacterSheetData,
    data_root: Path,
    character_id: str,
) -> Path:
    exports_dir = data_root / "characters" / character_id / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safe_name = data.character_name.replace("/", "_").replace("\\", "_")[:20]
    output_path = exports_dir / f"character-{safe_name}-{ts}.pdf"

    font_name = _register_chinese_font()

    # Build styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("MelyTitle", fontName=font_name, fontSize=28, leading=34, alignment=1)
    heading_style = ParagraphStyle("MelyHeading", fontName=font_name, fontSize=16, leading=20, spaceAfter=6)
    body_style = ParagraphStyle("MelyBody", fontName=font_name, fontSize=10, leading=14)
    small_style = ParagraphStyle("MelySmall", fontName=font_name, fontSize=8, leading=11, textColor=colors.grey)

    story = []

    # Cover page
    story.append(Spacer(1, 4 * cm))
    story.append(Paragraph(data.character_name, title_style))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph("角色设定书", ParagraphStyle("sub", fontName=font_name, fontSize=16, alignment=1, textColor=colors.grey)))
    story.append(Spacer(1, 1 * cm))
    story.append(Paragraph(f"创建日期：{data.created_at[:10]}", ParagraphStyle("date", fontName=font_name, fontSize=12, alignment=1)))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph(f"角色 ID：{data.character_id}", ParagraphStyle("id_style", fontName=font_name, fontSize=9, alignment=1, textColor=colors.grey)))
    story.append(Spacer(1, 1 * cm))
    story.append(Paragraph("Mely AI — 本地优先 AI 角色创作工具", ParagraphStyle("brand", fontName=font_name, fontSize=10, alignment=1, textColor=colors.grey)))
    story.append(PageBreak())

    # DNA parameters page
    story.append(Paragraph("角色 DNA 参数", heading_style))
    story.append(Spacer(1, 0.3 * cm))
    if data.dna:
        table_data = [["属性", "值"]] + [[k, v or "—"] for k, v in data.dna.items()]
        if data.trigger_word:
            table_data.append(["触发词", data.trigger_word])
        if data.recommended_weight is not None:
            table_data.append(["推荐 LoRA 权重", f"{data.recommended_weight:.2f}"])
        if data.training_status:
            table_data.append(["训练状态", data.training_status])
        t = Table(table_data, colWidths=[4 * cm, 12 * cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d3748")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#f7fafc"), colors.white]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(t)
    story.append(Spacer(1, 0.5 * cm))
    if data.auto_prompt:
        story.append(Paragraph("基础 Prompt", ParagraphStyle("ph", fontName=font_name, fontSize=11, leading=14, spaceAfter=4)))
        story.append(Paragraph(data.auto_prompt, body_style))
    story.append(PageBreak())

    # Reference images page
    if data.reference_images:
        story.append(Paragraph("训练参考图", heading_style))
        story.append(Spacer(1, 0.3 * cm))
        img_w = 5.5 * cm
        grid_data = []
        row = []
        for i, img_path in enumerate(data.reference_images[:9]):
            try:
                img = Image(str(img_path), width=img_w, height=img_w)
                row.append(img)
            except Exception:
                row.append(Paragraph("（图片不可用）", small_style))
            if len(row) == 3:
                grid_data.append(row)
                row = []
        if row:
            while len(row) < 3:
                row.append("")
            grid_data.append(row)
        if grid_data:
            img_table = Table(grid_data, colWidths=[img_w + 0.3 * cm] * 3)
            img_table.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(img_table)
        story.append(PageBreak())

    # Costume pages
    for costume in data.costumes:
        story.append(Paragraph(f"造型：{costume.name}", heading_style))
        story.append(Spacer(1, 0.2 * cm))
        story.append(Paragraph(costume.costume_prompt, body_style))
        story.append(Spacer(1, 0.4 * cm))
        if costume.preview_image_paths:
            prev_w = 8 * cm
            row1 = []
            row2 = []
            for i, p in enumerate(costume.preview_image_paths[:4]):
                try:
                    img = Image(str(p), width=prev_w, height=prev_w)
                except Exception:
                    img = Paragraph("（预览不可用）", small_style)
                if i < 2:
                    row1.append(img)
                else:
                    row2.append(img)
            while len(row1) < 2:
                row1.append("")
            while len(row2) < 2:
                row2.append("")
            prev_table = Table([row1, row2], colWidths=[prev_w + 0.5 * cm] * 2)
            prev_table.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(prev_table)
        story.append(PageBreak())

    # Footer note
    story.append(Paragraph(
        f"本设定书由 Mely AI 生成 · 创作证明记录 {data.proof_chain_length} 条 · 生成时间 {ts[:8]}",
        ParagraphStyle("footer_p", fontName=font_name, fontSize=8, textColor=colors.grey, alignment=1),
    ))

    try:
        doc = SimpleDocTemplate(
            str(output_path),
            pagesize=A4,
            leftMargin=2 * cm,
            rightMargin=2 * cm,
            topMargin=2 * cm,
            bottomMargin=2 * cm,
        )
        doc.build(story)
    except Exception as exc:
        raise PDFExportError(f"PDF 生成失败，请稍后重试") from exc

    return output_path
