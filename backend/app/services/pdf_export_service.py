import io
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas to dynamically compute and render total page count
    along with running header and running footer decorations.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []
        self.doc_title = "Deep Research AI — Intelligence Dossier"
        self.doc_date = datetime.now(timezone.utc).strftime("%B %d, %Y")

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_decorations(num_pages)
            super().showPage()
        super().save()

    def _draw_decorations(self, total_pages: int):
        self.saveState()
        page_w, page_h = letter
        margin = 48

        # Running Header (Top)
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#0891b2"))
        self.drawString(margin, page_h - 36, "DEEP RESEARCH AI — INTELLIGENCE DOSSIER")

        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748b"))
        self.drawRightString(page_w - margin, page_h - 36, self.doc_date)

        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.75)
        self.line(margin, page_h - 42, page_w - margin, page_h - 42)

        # Running Footer (Bottom)
        self.line(margin, 44, page_w - margin, 44)
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748b"))
        self.drawString(margin, 30, "Autonomous Multi-Agent Deep Research Engine")
        self.drawRightString(
            page_w - margin,
            30,
            f"Page {self._pageNumber} of {total_pages}",
        )

        self.restoreState()


class PDFExportService:
    """Enterprise-grade Vector PDF generator converting Markdown research dossiers into vector PDFs."""

    def __init__(self):
        self._init_styles()

    def _init_styles(self):
        self.styles = getSampleStyleSheet()

        # Primary Title (H1)
        self.title_style = ParagraphStyle(
            "DocTitle",
            parent=self.styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=25,
            textColor=colors.HexColor("#0f172a"),
            spaceAfter=12,
        )

        # H2 Section Header
        self.h2_style = ParagraphStyle(
            "DocH2",
            parent=self.styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=13.5,
            leading=18,
            textColor=colors.HexColor("#0f172a"),
            spaceBefore=14,
            spaceAfter=6,
            keepWithNext=True,
        )

        # H3 Subsection Header
        self.h3_style = ParagraphStyle(
            "DocH3",
            parent=self.styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=15,
            textColor=colors.HexColor("#1e293b"),
            spaceBefore=10,
            spaceAfter=4,
            keepWithNext=True,
        )

        # Body Text
        self.body_style = ParagraphStyle(
            "DocBody",
            parent=self.styles["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14.5,
            textColor=colors.HexColor("#334155"),
            spaceAfter=7,
        )

        # Bullet List Item
        self.bullet_style = ParagraphStyle(
            "DocBullet",
            parent=self.styles["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#334155"),
            leftIndent=16,
            firstLineIndent=-10,
            spaceAfter=4,
        )

        # Numbered List Item
        self.numbered_style = ParagraphStyle(
            "DocNumbered",
            parent=self.styles["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#334155"),
            leftIndent=20,
            firstLineIndent=-14,
            spaceAfter=4,
        )

        # Blockquote / Callout
        self.blockquote_style = ParagraphStyle(
            "DocBlockquote",
            parent=self.styles["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9.0,
            leading=13.5,
            textColor=colors.HexColor("#1e293b"),
            leftIndent=14,
            spaceBefore=4,
            spaceAfter=6,
        )

        # Table Cell
        self.table_cell_style = ParagraphStyle(
            "DocTableCell",
            parent=self.styles["Normal"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=11.5,
            textColor=colors.HexColor("#334155"),
        )

        # Table Header
        self.table_header_style = ParagraphStyle(
            "DocTableHeader",
            parent=self.styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11.5,
            textColor=colors.HexColor("#0f172a"),
        )

        # Sources Citation Text
        self.source_style = ParagraphStyle(
            "DocSource",
            parent=self.styles["Normal"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=12.5,
            textColor=colors.HexColor("#475569"),
            leftIndent=18,
            firstLineIndent=-14,
            spaceAfter=4,
        )

    def _sanitize_inline_markdown(self, text: str) -> str:
        """Escape XML entities and transform Markdown bold, italics, code, and links into ReportLab XML."""
        if not text:
            return ""

        # 1. Escape literal ampersands and angle brackets not part of XML tags
        text = text.replace("&", "&amp;")
        text = text.replace("<", "&lt;").replace(">", "&gt;")

        # 2. Convert markdown links: [text](url) -> <a href="url" color="#0284c7"><u>text</u></a>
        def link_sub(m):
            lbl, url = m.group(1), m.group(2)
            return f'<a href="{url}" color="#0284c7"><u>{lbl}</u></a>'

        text = re.sub(r"\[([^\]]+)\]\((https?://[^\)]+)\)", link_sub, text)

        # 3. Convert markdown bold: **text** or __text__ -> <b>text</b>
        text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
        text = re.sub(r"__([^_]+)__", r"<b>\1</b>", text)

        # 4. Convert markdown italics: *text* or _text_ -> <i>text</i>
        text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
        text = re.sub(r"(?<!_)_([^_]+)_(?!_)", r"<i>\1</i>", text)

        # 5. Convert inline code: `code` -> <font face="Courier" color="#0f172a">\1</font>
        text = re.sub(
            r"`([^`]+)`",
            r'<font face="Courier" color="#0f172a" backcolor="#f1f5f9"> \1 </font>',
            text,
        )

        # 6. Re-allow unescaped tags created by transformation
        text = text.replace("&lt;b&gt;", "<b>").replace("&lt;/b&gt;", "</b>")
        text = text.replace("&lt;i&gt;", "<i>").replace("&lt;/i&gt;", "</i>")
        text = text.replace("&lt;u&gt;", "<u>").replace("&lt;/u&gt;", "</u>")
        text = text.replace("&lt;a ", "<a ").replace("&lt;/a&gt;", "</a>")
        text = text.replace("&lt;font ", "<font ").replace("&lt;/font&gt;", "</font>")

        return text

    def _parse_markdown_to_flowables(self, markdown_text: str) -> List[Any]:
        """Converts raw Markdown document into a sequence of ReportLab Flowables."""
        flowables = []
        lines = markdown_text.splitlines()
        i = 0
        n = len(lines)

        while i < n:
            raw_line = lines[i]
            line = raw_line.strip()

            if not line:
                i += 1
                continue

            # 1. Horizontal rules
            if line in ("---", "***", "___") or re.match(r"^[-*_]{3,}$", line):
                flowables.append(Spacer(1, 4))
                flowables.append(
                    HRFlowable(
                        width="100%",
                        thickness=0.5,
                        color=colors.HexColor("#e2e8f0"),
                        spaceBefore=4,
                        spaceAfter=8,
                    )
                )
                i += 1
                continue

            # 2. Markdown Tables (| col1 | col2 |)
            if line.startswith("|") and line.endswith("|") and i + 1 < n and ("---" in lines[i + 1]):
                table_lines = []
                while i < n and lines[i].strip().startswith("|") and lines[i].strip().endswith("|"):
                    table_lines.append(lines[i].strip())
                    i += 1

                if len(table_lines) >= 2:
                    t_flowable = self._build_table_flowable(table_lines)
                    if t_flowable:
                        flowables.append(Spacer(1, 4))
                        flowables.append(t_flowable)
                        flowables.append(Spacer(1, 8))
                continue

            # 3. Headings (# H1, ## H2, ### H3, #### H4)
            if line.startswith("#"):
                m = re.match(r"^(#{1,6})\s+(.*)$", line)
                if m:
                    level = len(m.group(1))
                    header_text = self._sanitize_inline_markdown(m.group(2).strip())
                    if level == 1:
                        flowables.append(Spacer(1, 10))
                        flowables.append(Paragraph(header_text, self.title_style))
                    elif level == 2:
                        flowables.append(Spacer(1, 8))
                        flowables.append(Paragraph(header_text, self.h2_style))
                    else:
                        flowables.append(Spacer(1, 6))
                        flowables.append(Paragraph(header_text, self.h3_style))
                    i += 1
                    continue

            # 4. Blockquotes (> quote)
            if line.startswith(">"):
                quote_lines = []
                while i < n and lines[i].strip().startswith(">"):
                    quote_lines.append(re.sub(r"^>\s?", "", lines[i].strip()))
                    i += 1
                full_quote = " ".join(quote_lines)
                sanitized_quote = self._sanitize_inline_markdown(full_quote)

                # Format as callout card with a left border
                p_quote = Paragraph(sanitized_quote, self.blockquote_style)
                quote_table = Table(
                    [[p_quote]],
                    colWidths=[516],
                )
                quote_table.setStyle(
                    TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                            ("LINELEFT", (0, 0), (0, -1), 3.0, colors.HexColor("#0891b2")),
                            ("TOPPADDING", (0, 0), (-1, -1), 6),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                            ("LEFTPADDING", (0, 0), (-1, -1), 8),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ]
                    )
                )
                flowables.append(Spacer(1, 4))
                flowables.append(quote_table)
                flowables.append(Spacer(1, 6))
                continue

            # 5. Bullet Lists (- item, * item)
            if re.match(r"^[-*+]\s+", line):
                bullet_content = re.sub(r"^[-*+]\s+", "", line)
                sanitized_bullet = self._sanitize_inline_markdown(bullet_content)
                flowables.append(
                    Paragraph(
                        f"&bull;&nbsp;&nbsp;{sanitized_bullet}",
                        self.bullet_style,
                    )
                )
                i += 1
                continue

            # 6. Numbered Lists (1. item)
            num_match = re.match(r"^(\d+)\.\s+(.*)$", line)
            if num_match:
                num = num_match.group(1)
                num_content = num_match.group(2)
                sanitized_num = self._sanitize_inline_markdown(num_content)
                flowables.append(
                    Paragraph(
                        f"<b>{num}.</b>&nbsp;&nbsp;{sanitized_num}",
                        self.numbered_style,
                    )
                )
                i += 1
                continue

            # 7. Standard Paragraph
            # Accumulate contiguous text lines until empty line or markdown control
            para_lines = [line]
            i += 1
            while i < n:
                next_line = lines[i].strip()
                if not next_line:
                    break
                if (
                    next_line.startswith("#")
                    or next_line.startswith(">")
                    or next_line.startswith("|")
                    or re.match(r"^[-*+]\s+", next_line)
                    or re.match(r"^\d+\.\s+", next_line)
                    or next_line in ("---", "***", "___")
                ):
                    break
                para_lines.append(next_line)
                i += 1

            full_para = " ".join(para_lines)
            sanitized_para = self._sanitize_inline_markdown(full_para)
            flowables.append(Paragraph(sanitized_para, self.body_style))

        return flowables

    def _build_table_flowable(self, table_lines: List[str]) -> Optional[Table]:
        """Constructs a formatted ReportLab Table from raw Markdown table strings."""
        try:
            rows_data = []
            for idx, r_line in enumerate(table_lines):
                # Skip the delimiter line |---|---|
                if idx == 1 and "---" in r_line:
                    continue

                cells = [c.strip() for c in r_line.strip("|").split("|")]
                formatted_cells = []
                is_header = idx == 0
                style = self.table_header_style if is_header else self.table_cell_style

                for cell in cells:
                    sanitized = self._sanitize_inline_markdown(cell)
                    formatted_cells.append(Paragraph(sanitized, style))
                rows_data.append(formatted_cells)

            if not rows_data:
                return None

            num_cols = max(len(r) for r in rows_data)
            # Normalize row length
            for r in rows_data:
                while len(r) < num_cols:
                    r.append(Paragraph("", self.table_cell_style))

            total_width = 516.0
            col_width = total_width / num_cols

            t = Table(rows_data, colWidths=[col_width] * num_cols)
            t.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                        ("LEFTPADDING", (0, 0), (-1, -1), 6),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                    ]
                )
            )
            return t
        except Exception:
            return None

    def generate_dossier_pdf(
        self,
        title: str,
        query: str,
        markdown_content: str,
        sources: Optional[List[Dict[str, Any]]] = None,
        effort_level: str = "medium",
        date_str: Optional[str] = None,
    ) -> bytes:
        """
        Renders an intelligence dossier report into vector PDF bytes.
        """
        buffer = io.BytesIO()

        # Target printable width: 612 (letter width) - 2*48 (margins) = 516 pt
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            leftMargin=48,
            rightMargin=48,
            topMargin=54,
            bottomMargin=54,
        )

        effective_date = date_str or datetime.now(timezone.utc).strftime("%B %d, %Y")
        story = []

        # Metadata Info Card
        meta_html = (
            f"<b>TOPIC:</b> {query or title} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"<b>EFFORT:</b> {effort_level.upper()} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"<b>DATE:</b> {effective_date}"
        )
        meta_p = Paragraph(
            meta_html,
            ParagraphStyle(
                "MetaText",
                parent=self.styles["Normal"],
                fontName="Helvetica-Bold",
                fontSize=8.0,
                leading=10.5,
                textColor=colors.HexColor("#0891b2"),
            ),
        )
        meta_table = Table([[meta_p]], colWidths=[516])
        meta_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ecfeff")),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#a5f3fc")),
                ]
            )
        )
        story.append(meta_table)
        story.append(Spacer(1, 12))

        # Dossier H1 Title
        doc_heading = title if title and not title.lower().startswith("dossier") else query
        if not markdown_content.strip().startswith("# "):
            story.append(Paragraph(doc_heading or "Executive Intelligence Dossier", self.title_style))
            story.append(Spacer(1, 8))

        # Main Report Body (Markdown -> Flowables)
        body_flowables = self._parse_markdown_to_flowables(markdown_content)
        story.extend(body_flowables)

        # Sources & References Cited
        if sources and len(sources) > 0:
            story.append(Spacer(1, 14))
            story.append(
                HRFlowable(
                    width="100%",
                    thickness=1.0,
                    color=colors.HexColor("#0891b2"),
                    spaceBefore=8,
                    spaceAfter=10,
                )
            )
            story.append(
                Paragraph(
                    "Sources &amp; References Cited",
                    self.h2_style,
                )
            )
            story.append(Spacer(1, 4))

            for idx, s in enumerate(sources):
                url = s.get("url", "")
                stitle = s.get("title") or url or f"Source {idx + 1}"
                domain = ""
                if url:
                    try:
                        domain = urlparse(url).netloc.replace("www.", "")
                    except Exception:
                        domain = ""

                domain_part = f" ({domain})" if domain else ""
                if url:
                    src_line = f"<b>[{idx + 1}]</b> <a href='{url}' color='#0284c7'><u>{self._sanitize_inline_markdown(stitle)}</u></a>{domain_part}"
                else:
                    src_line = f"<b>[{idx + 1}]</b> {self._sanitize_inline_markdown(stitle)}"

                story.append(Paragraph(src_line, self.source_style))

        # Build document using NumberedCanvas for dynamic two-pass page numbers
        def canvas_maker(*args, **kwargs):
            c = NumberedCanvas(*args, **kwargs)
            c.doc_date = effective_date
            return c

        doc.build(story, canvasmaker=canvas_maker)
        pdf_data = buffer.getvalue()
        buffer.close()
        return pdf_data


# Global singleton instance
pdf_export_service = PDFExportService()
