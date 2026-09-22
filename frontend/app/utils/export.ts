import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { Turn } from "../types";
import { getTurnSources } from "./citations";

export const handleCopyTurnMarkdown = (
  turn: Turn | null | undefined,
  setCopied: (val: boolean) => void
) => {
  if (!turn?.report?.markdown_content) return;
  let content = turn.report.markdown_content.trim();
  if (!content.startsWith("# ") && turn.query) {
    content = `# ${turn.query}\n\n${content}`;
  }
  navigator.clipboard.writeText(content);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
};

export const handleDownloadTurnMarkdown = (turn: Turn | null | undefined) => {
  if (!turn?.report?.markdown_content) return;
  let content = turn.report.markdown_content.trim();
  // Ensure the downloaded markdown file always includes the full question as the top H1 header
  if (!content.startsWith("# ") && turn.query) {
    content = `# ${turn.query}\n\n${content}`;
  }
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `research_${(turn.query || "report").slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}.md`;
  link.click();
  URL.revokeObjectURL(url);
};

export const handleDownloadTurnPDF = async (
  turn: Turn | null | undefined,
  turnIdx: number,
  setIsExportingPDF: (val: boolean) => void,
  sessionId?: string
) => {
  if (!turn?.report?.markdown_content) return;

  // 1. Attempt high-fidelity Server-Side Vector PDF Export first
  if (sessionId) {
    try {
      setIsExportingPDF(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("auth_token") || localStorage.getItem("token")
          : null;
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(
        `${apiUrl}/api/research/${sessionId}/export/pdf?turn_idx=${turnIdx}`,
        {
          method: "GET",
          headers,
        }
      );

      if (res.ok) {
        const blob = await res.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        const safeName = (turn.query || "research_dossier")
          .slice(0, 30)
          .replace(/[^a-zA-Z0-9]/g, "_");
        link.download = `${safeName}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
        setIsExportingPDF(false);
        return;
      }
    } catch (serverErr) {
      console.warn("Server PDF generation failed, falling back to client canvas:", serverErr);
    }
  }

  // 2. Client-side rasterized PDF export fallback
  let wrapper: HTMLDivElement | null = null;
  try {
    setIsExportingPDF(true);
    const articleEl = document.getElementById(`turn-report-article-${turnIdx}`);
    if (!articleEl) {
      console.error("Article element not found for turn", turnIdx);
      setIsExportingPDF(false);
      return;
    }

    // Create a dedicated off-canvas container positioned at (0,0) with exact 720px width
    wrapper = document.createElement("div");
    wrapper.id = "pdf-temp-export-container";
    wrapper.style.position = "absolute";
    wrapper.style.top = "0px";
    wrapper.style.left = "0px";
    wrapper.style.width = "720px";
    wrapper.style.padding = "24px 32px";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.backgroundColor = "#ffffff";
    wrapper.style.color = "#0f172a";
    wrapper.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    wrapper.style.zIndex = "-9999";
    wrapper.style.opacity = "1";
    wrapper.style.pointerEvents = "none";

    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const turnSources = getTurnSources(turn);

    wrapper.innerHTML = `
      <div style="border-bottom: 2px solid #0891b2; padding-bottom: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end;">
        <div style="font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #0891b2;">Deep Research AI — Intelligence Dossier</div>
        <div style="font-size: 10px; color: #64748b; font-family: monospace;">${dateStr}</div>
      </div>
      <h1 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0; line-height: 1.35; word-wrap: break-word;">${turn.query || "Research Dossier"}</h1>
      <div class="pdf-rendered-body" style="color: #334155; line-height: 1.7; font-size: 12.5px;">
        ${articleEl.innerHTML}
      </div>
      ${turnSources && turnSources.length > 0 ? `
        <div class="pdf-sources-block" style="margin-top: 28px; padding-top: 14px; border-top: 1px solid #cbd5e1;">
          <div style="font-size: 12.5px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Sources & References Cited</div>
          ${turnSources.map((s: any, idx: number) => {
            let domain = "";
            try { domain = s.url ? new URL(s.url).hostname.replace("www.", "") : ""; } catch(_e) {}
            return `
              <div style="font-size: 10.5px; color: #475569; margin-bottom: 4px; line-height: 1.4;">
                <strong>[${idx + 1}]</strong> <a href="${s.url}" style="color: #0284c7; text-decoration: underline;" target="_blank">${s.title || s.url}</a> ${domain ? `(${domain})` : ""}
              </div>
            `;
          }).join("")}
        </div>
      ` : ""}
      <div style="margin-top: 32px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between;">
        <span>Autonomous Deep Research Engine</span>
        <span>Confidential Intelligence Dossier</span>
      </div>
    `;

    // Transform citation badge buttons into clean inline blue text [N]
    wrapper.querySelectorAll("button").forEach((btn: any) => {
      const text = btn.textContent ? btn.textContent.trim() : "";
      const match = text.match(/^\[?(\d+)\]?$/);
      if (match) {
        const num = match[1];
        const span = document.createElement("span");
        span.textContent = `[${num}]`;
        span.style.color = "#0284c7";
        span.style.fontWeight = "700";
        span.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        span.style.fontSize = "11px";
        span.style.display = "inline";
        span.style.margin = "0 2px";
        span.style.verticalAlign = "baseline";
        span.style.textDecoration = "none";
        btn.parentNode?.replaceChild(span, btn);
      } else {
        btn.style.display = "none";
      }
    });

    // Style headings
    wrapper.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el: any) => {
      el.style.color = "#0f172a";
      el.style.fontWeight = "700";
      el.style.marginTop = "16px";
      el.style.marginBottom = "8px";
      el.style.lineHeight = "1.3";
    });

    // Style paragraphs and lists
    wrapper.querySelectorAll("p, li").forEach((el: any) => {
      el.style.color = "#334155";
      el.style.fontSize = "12px";
      el.style.lineHeight = "1.7";
      el.style.marginBottom = "8px";
    });

    wrapper.querySelectorAll("strong, b").forEach((el: any) => {
      el.style.color = "#0f172a";
      el.style.fontWeight = "700";
    });

    // Style tables
    wrapper.querySelectorAll("table").forEach((el: any) => {
      el.style.width = "100%";
      el.style.borderCollapse = "collapse";
      el.style.margin = "14px 0";
      el.style.fontSize = "11px";
      el.style.backgroundColor = "#ffffff";
      el.style.border = "1px solid #cbd5e1";
    });

    wrapper.querySelectorAll("th").forEach((el: any) => {
      el.style.background = "#f1f5f9";
      el.style.color = "#0f172a";
      el.style.fontWeight = "700";
      el.style.border = "1px solid #cbd5e1";
      el.style.padding = "7px 10px";
      el.style.textAlign = "left";
      el.style.fontSize = "11px";
    });

    wrapper.querySelectorAll("td").forEach((el: any) => {
      el.style.border = "1px solid #e2e8f0";
      el.style.padding = "7px 10px";
      el.style.color = "#334155";
      el.style.lineHeight = "1.5";
      el.style.fontSize = "10.5px";
      el.style.backgroundColor = "#ffffff";
    });

    wrapper.querySelectorAll("a").forEach((el: any) => {
      el.style.color = "#0284c7";
      el.style.textDecoration = "underline";
    });

    wrapper.querySelectorAll("blockquote").forEach((el: any) => {
      el.style.borderLeft = "3px solid #0891b2";
      el.style.paddingLeft = "12px";
      el.style.color = "#475569";
      el.style.fontStyle = "italic";
      el.style.margin = "12px 0";
    });

    document.body.appendChild(wrapper);

    // Brief delay to allow browser to calculate layout
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Measure block elements for intelligent page breaking
    const blockElements = Array.from(wrapper.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, table, tr, p, li, blockquote, .pdf-sources-block"
    )) as HTMLElement[];

    const wrapperRect = wrapper.getBoundingClientRect();
    const elementsWithOffsets = blockElements.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top - wrapperRect.top,
        bottom: rect.bottom - wrapperRect.top,
        height: rect.height,
        isHeading: /^H[1-6]$/i.test(el.tagName),
        isTable: el.tagName.toLowerCase() === "table",
        isTableRow: el.tagName.toLowerCase() === "tr"
      };
    }).filter(item => item.height > 0);

    elementsWithOffsets.sort((a, b) => a.top - b.top);

    const totalHeightPx = wrapper.scrollHeight;
    const pageHeightPx = 1000;

    const pageBreaks: number[] = [0];
    let currentTop = 0;

    while (currentTop < totalHeightPx) {
      const idealBottom = currentTop + pageHeightPx;
      if (idealBottom >= totalHeightPx) {
        pageBreaks.push(totalHeightPx);
        break;
      }

      let bestBreak = idealBottom;
      let foundCandidate = false;

      for (let i = 0; i < elementsWithOffsets.length; i++) {
        const item = elementsWithOffsets[i];
        if (item.top > currentTop + 100 && item.top < idealBottom && item.bottom > idealBottom) {
          bestBreak = item.top - 6;
          foundCandidate = true;
          break;
        }
        if (item.isHeading && item.top > currentTop + 100 && (idealBottom - item.top) < 80) {
          bestBreak = item.top - 6;
          foundCandidate = true;
          break;
        }
      }

      if (!foundCandidate || (bestBreak - currentTop) < 400) {
        bestBreak = idealBottom;
      }

      pageBreaks.push(bestBreak);
      currentTop = bestBreak;
    }

    // High-res canvas capture at 2x
    const canvas = await html2canvas(wrapper, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 720,
      scrollX: 0,
      scrollY: 0
    });

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4"
    });

    const pdfPageWidth = pdf.internal.pageSize.getWidth(); // 595.28 pt
    const margin = 25; // 25pt margin
    const printableWidth = pdfPageWidth - (margin * 2); // 545.28 pt
    const scaleFactor = canvas.width / 720; // 2

    for (let i = 0; i < pageBreaks.length - 1; i++) {
      const startPx = pageBreaks[i];
      const endPx = pageBreaks[i + 1];
      const sliceHeightPx = endPx - startPx;

      if (sliceHeightPx <= 0) continue;

      if (i > 0) {
        pdf.addPage();
      }

      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.round(sliceHeightPx * scaleFactor);

      const ctx = sliceCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(
          canvas,
          0,
          Math.round(startPx * scaleFactor),
          canvas.width,
          Math.round(sliceHeightPx * scaleFactor),
          0,
          0,
          sliceCanvas.width,
          sliceCanvas.height
        );

        const sliceImgData = sliceCanvas.toDataURL("image/jpeg", 0.95);
        const renderHeightPt = (sliceHeightPx / 720) * printableWidth;

        pdf.addImage(
          sliceImgData,
          "JPEG",
          margin,
          margin,
          printableWidth,
          renderHeightPt,
          undefined,
          "FAST"
        );
      }
    }

    const cleanFilename = `research_${(turn.query || "report").slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
    pdf.save(cleanFilename);
  } catch (err) {
    console.error("PDF export failed:", err);
  } finally {
    if (wrapper && document.body.contains(wrapper)) {
      document.body.removeChild(wrapper);
    }
    setIsExportingPDF(false);
  }
};
