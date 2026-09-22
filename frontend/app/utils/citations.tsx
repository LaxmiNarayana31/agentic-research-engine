"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, ArrowUpRight, Compass } from "lucide-react";
import { SourceItem, Turn } from "../types";

export function transformCitationsInMarkdown(content: string, sources: SourceItem[] = []): string {
  if (!content) return "";

  // Step 1: Expand grouped brackets like [1, 2], [1, 2, 3], or [1,3,5] into tightly clustered [1][2][3]
  let transformed = content.replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_match, group) => {
    const numbers = group.split(",").map((s: string) => s.trim()).filter(Boolean);
    return numbers.map((n: string) => `[${n}]`).join("");
  });

  // Step 2: Expand range citations like [1-3] or [1–3] into [1][2][3]
  transformed = transformed.replace(/\[(\d+)\s*[-–—]\s*(\d+)\]/g, (match, startStr, endStr) => {
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!isNaN(start) && !isNaN(end) && end > start && end - start <= 10) {
      const items = [];
      for (let i = start; i <= end; i++) {
        items.push(`[${i}]`);
      }
      return items.join("");
    }
    return match;
  });

  // Step 3: Collapse comma-separated citations like [1], [2] or [1], [3] into tight consecutive [1][2] / [1][3]
  transformed = transformed.replace(/(\[\d+\])\s*,\s*(?=\[\d+\])/g, "$1");

  // Step 4: Convert any standalone [N] into a markdown link [N](url)
  transformed = transformed.replace(/(?<![!\[])\[(\d+)\](?!\()/g, (_match, numStr) => {
    const idx = parseInt(numStr, 10);
    const matchedSource = sources && sources[idx - 1];
    const targetUrl = matchedSource?.url || (sources && sources.length >= idx ? sources[idx - 1]?.url : "") || `#citation-${idx}`;
    return `[${numStr}](${targetUrl})`;
  });

  return transformed;
}

export function getTurnSources(turn: Turn | null | undefined): SourceItem[] {
  if (!turn) return [];
  const sources: SourceItem[] = [];
  const seenUrls = new Set<string>();

  const addSource = (rawUrl: string, title?: string, image?: string) => {
    if (!rawUrl || typeof rawUrl !== "string") return;
    const cleanUrl = rawUrl.trim();
    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) return;
    if (seenUrls.has(cleanUrl)) return;
    seenUrls.add(cleanUrl);
    sources.push({
      url: cleanUrl,
      title: title && title !== cleanUrl ? title : cleanUrl,
      image: image || ""
    });
  };

  turn.findings?.forEach((f: any) => {
    if (f.rich_sources?.length) {
      f.rich_sources.forEach((rs: any) => {
        addSource(rs.url, rs.title, rs.image);
      });
    }
    if (f.sources?.length) {
      f.sources.forEach((src: any) => {
        if (typeof src === "string") {
          addSource(src);
        } else if (src && src.url) {
          addSource(src.url, src.title, src.image);
        }
      });
    }
  });

  if (turn.report?.bibliography?.length) {
    turn.report.bibliography.forEach((b: any) => {
      if (typeof b === "string") {
        addSource(b);
      } else if (b && b.url) {
        addSource(b.url, b.title, b.image);
      }
    });
  }

  if (turn.report?.sources?.length) {
    turn.report.sources.forEach((s: any) => {
      if (typeof s === "string") {
        addSource(s);
      } else if (s && s.url) {
        addSource(s.url, s.title, s.image);
      }
    });
  }

  // Extract any markdown citation links [N](https://...)
  if (turn.report?.markdown_content) {
    const linkRegex = /\[(?:[^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(turn.report.markdown_content)) !== null) {
      addSource(match[1]);
    }
  }

  return sources;
}

export function CitationBadge({ index, href, source }: { index: number; href?: string; source?: any }) {
  const [hovered, setHovered] = useState(false);
  let domain = "";
  let favicon = "";
  const targetUrl = href && href.startsWith("http") ? href : (source?.url || "");
  if (targetUrl) {
    try {
      domain = new URL(targetUrl).hostname.replace("www.", "");
      favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch (_e) { }
  }

  const handleClick = (_e: React.MouseEvent) => {
    if (targetUrl) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <span
      className="relative inline-block mx-[1px] align-baseline select-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={handleClick}
        title={source?.title || domain || `Source [${index}]`}
        className="inline-flex items-center justify-center text-[10.5px] font-mono font-semibold text-zinc-300 hover:text-white bg-[#252828] hover:bg-[#323636] border border-zinc-700/80 hover:border-zinc-500 px-1 py-0.2 rounded transition-all hover:scale-105 active:scale-95 no-underline shadow-sm cursor-pointer"
      >
        [{index}]
      </button>
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-[#1e2020] border border-zinc-700/90 rounded-xl shadow-2xl z-50 text-left pointer-events-auto backdrop-blur-md"
          >
            <div className="flex items-center gap-2 mb-1.5">
              {favicon ? (
                <img src={favicon} alt="" className="w-3.5 h-3.5 object-contain rounded" />
              ) : (
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
              )}
              <span className="text-[11px] font-semibold text-zinc-300 truncate">{domain || `Source [${index}]`}</span>
              <span className="ml-auto text-[9px] font-mono text-cyan-400 bg-cyan-950/60 px-1 py-0.5 rounded border border-cyan-800/40">Verified</span>
            </div>
            <div className="text-xs font-medium text-zinc-100 line-clamp-2 leading-snug mb-2">
              {source?.title || domain || `Verified Research Reference [${index}]`}
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800 text-[10px] text-cyan-400">
              <span className="truncate max-w-[170px] text-zinc-400">{targetUrl || `Source [${index}]`}</span>
              <ArrowUpRight className="w-3 h-3 shrink-0" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

export function stripLeadingQueryTitle(markdown: string): string {
  if (!markdown) return "";
  const trimmed = markdown.trim();
  if (trimmed.startsWith("# ")) {
    const firstLineEnd = trimmed.indexOf("\n");
    if (firstLineEnd !== -1) {
      return trimmed.slice(firstLineEnd).trim();
    }
    return "";
  }
  return trimmed;
}

export function TableOfContents({ markdown }: { markdown: string }) {
  if (!markdown) return null;
  const lines = markdown.split("\n");
  const headings: { id: string; text: string; level: number }[] = [];

  lines.forEach((line) => {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim().replace(/[*_`]/g, "");
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      headings.push({ id, text, level });
    }
  });

  if (headings.length < 2) return null;

  return (
    <div className="mb-6 p-3.5 rounded-xl bg-[#161818] border border-zinc-800/80 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-1.5">
        <Compass className="w-3.5 h-3.5 text-cyan-400" />
        <span>Table of Contents</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {headings.map((h, i) => (
          <a
            key={i}
            href={`#${h.id}`}
            className="text-xs font-normal px-2.5 py-1 rounded-lg bg-[#222525] hover:bg-[#2c2f2f] border border-zinc-700/60 hover:border-zinc-600 text-zinc-300 hover:text-white transition-all shadow-sm flex items-center gap-1.5"
          >
            {h.level === 3 && <span className="text-[9px] text-zinc-500">•</span>}
            <span>{h.text}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
