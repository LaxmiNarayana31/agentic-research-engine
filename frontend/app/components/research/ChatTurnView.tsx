"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  Sparkles,
  Check,
  Copy,
  FileText,
  Printer,
  Loader2,
  ShieldCheck,
  Coins,
} from "lucide-react";
import { Turn } from "../../types";
import {
  CitationBadge,
  stripLeadingQueryTitle,
  transformCitationsInMarkdown,
  getTurnSources,
} from "../../utils/citations";

interface ChatTurnViewProps {
  turn: Turn;
  turnIdx: number;
  isTurnLoading: boolean;
  liveStatus?: string;
  copied: boolean;
  isExportingPDF: boolean;
  onCopyMarkdown: (turn: Turn) => void;
  onDownloadMarkdown: (turn: Turn) => void;
  onDownloadPDF: (turn: Turn, idx: number) => void;
}

export default function ChatTurnView({
  turn,
  turnIdx,
  isTurnLoading,
  liveStatus,
  copied,
  isExportingPDF,
  onCopyMarkdown,
  onDownloadMarkdown,
  onDownloadPDF,
}: ChatTurnViewProps) {
  const turnSources = getTurnSources(turn);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="bg-[#1e2020]/90 border border-zinc-800/80 rounded-2xl p-6 md:p-8 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-zinc-700/50">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5 text-zinc-100 font-semibold text-xl">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <span>AI Overview</span>
            </div>

            {/* Factuality & Groundedness Score Badge */}
            {(turn.report?.groundedness_score || turn.groundedness_score) ? (
              <span 
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 shadow-sm"
                title="Citation entailment and factuality score verified by NLI model"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{turn.report?.groundedness_score || turn.groundedness_score}% Grounded</span>
              </span>
            ) : null}

            {/* Token Usage & Cost Meter */}
            {(turn.report?.total_tokens || turn.total_tokens) ? (
              <span 
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 shadow-sm"
                title={`Prompt: ${turn.report?.prompt_tokens || turn.prompt_tokens || 0}, Completion: ${turn.report?.completion_tokens || turn.completion_tokens || 0}`}
              >
                <Coins className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  {(((turn.report?.total_tokens || turn.total_tokens || 0) / 1000)).toFixed(1)}k tokens
                  {((turn.report?.estimated_cost_usd || turn.estimated_cost_usd || 0) > 0) && (
                    <span className="text-zinc-400 ml-1">• ${(turn.report?.estimated_cost_usd || turn.estimated_cost_usd).toFixed(4)}</span>
                  )}
                </span>
              </span>
            ) : null}
          </div>

          {/* Action Toolbar (Targeting this exact turn's report) */}
          <div className="flex items-center gap-2 relative">
            <button
              type="button"
              onClick={() => onCopyMarkdown(turn)}
              title={copied ? "Copied markdown!" : "Copy markdown"}
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm cursor-pointer"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onDownloadMarkdown(turn)}
              title="Download Markdown"
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm cursor-pointer"
            >
              <FileText className="w-4 h-4 text-cyan-400" />
            </button>

            <button
              type="button"
              disabled={isExportingPDF}
              onClick={() => onDownloadPDF(turn, turnIdx)}
              title="Download PDF"
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {isExportingPDF ? (
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              ) : (
                <Printer className="w-4 h-4 text-rose-400" />
              )}
            </button>
          </div>
        </div>

        <article
          id={`turn-report-article-${turnIdx}`}
          className="w-full font-manrope text-zinc-100 antialiased tracking-normal"
        >
          {turn.report?.markdown_content ? (
            <div>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  a: ({ node, href, children, ...props }) => {
                    const text = String(children);
                    const citationMatch = text.match(/^\[?(\d+)\]?$/);
                    if (citationMatch) {
                      const idx = parseInt(citationMatch[1], 10);
                      const matchedSource = turnSources[idx - 1];
                      return (
                        <CitationBadge
                          index={idx}
                          href={href || matchedSource?.url}
                          source={matchedSource}
                        />
                      );
                    }
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 underline font-medium text-[15.5px] md:text-[16.5px]"
                        {...props}
                      >
                        {children}
                      </a>
                    );
                  },
                  h1: ({ node, children, ...props }) => {
                    return (
                      <h1
                        className="text-xl md:text-2xl font-extrabold text-white tracking-tight mt-3 mb-5 pb-3 border-b border-zinc-700/60 leading-tight"
                        {...props}
                      >
                        {children}
                      </h1>
                    );
                  },
                  h2: ({ node, children, ...props }) => {
                    const text = String(children);
                    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                    return (
                      <h2
                        id={id}
                        className="text-lg md:text-xl font-bold text-white tracking-tight mt-7 mb-3.5 scroll-mt-24 flex items-center gap-2 border-b border-zinc-800/80 pb-2.5 leading-snug"
                        {...props}
                      >
                        {children}
                      </h2>
                    );
                  },
                  h3: ({ node, children, ...props }) => {
                    const text = String(children);
                    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                    return (
                      <h3
                        id={id}
                        className="text-base md:text-lg font-semibold text-cyan-200 tracking-tight mt-5 mb-2.5 scroll-mt-24 leading-snug"
                        {...props}
                      >
                        {children}
                      </h3>
                    );
                  },
                  p: ({ node, children, ...props }) => {
                    return (
                      <p
                        className="text-[15.5px] md:text-[16.5px] leading-[1.8] my-4 text-zinc-200"
                        {...props}
                      >
                        {children}
                      </p>
                    );
                  },
                  ul: ({ node, children, ...props }) => {
                    return (
                      <ul
                        className="space-y-2.5 my-5 list-disc pl-6 text-[15.5px] md:text-[16.5px] text-[#e4e4e7] leading-[1.8]"
                        {...props}
                      >
                        {children}
                      </ul>
                    );
                  },
                  ol: ({ node, children, ...props }) => {
                    return (
                      <ol
                        className="space-y-2.5 my-5 list-decimal pl-6 text-[15.5px] md:text-[16.5px] text-[#e4e4e7] leading-[1.8]"
                        {...props}
                      >
                        {children}
                      </ol>
                    );
                  },
                  li: ({ node, children, ...props }) => {
                    return (
                      <li
                        className="leading-[1.8] pl-1.5 text-[15.5px] md:text-[16.5px] text-[#e4e4e7]"
                        {...props}
                      >
                        {children}
                      </li>
                    );
                  },
                  strong: ({ node, children, ...props }) => {
                    return (
                      <strong
                        className="font-bold text-white tracking-[0.01em]"
                        {...props}
                      >
                        {children}
                      </strong>
                    );
                  },
                  b: ({ node, children, ...props }) => {
                    return (
                      <b
                        className="font-bold text-white tracking-[0.01em]"
                        {...props}
                      >
                        {children}
                      </b>
                    );
                  },
                  blockquote: ({ node, children, ...props }) => {
                    return (
                      <blockquote
                        className="border-l-4 border-cyan-500 bg-[#222424]/80 pl-5 py-4 my-6 rounded-r-2xl text-zinc-200 italic text-[15.5px] md:text-[16.5px] leading-relaxed shadow-sm"
                        {...props}
                      >
                        {children}
                      </blockquote>
                    );
                  },
                  table: ({ node, children, ...props }) => {
                    return (
                      <div className="overflow-x-auto my-6 rounded-2xl border border-zinc-700/80 shadow-xl">
                        <table
                          className="w-full text-left border-collapse bg-[#1c1e1e]"
                          {...props}
                        >
                          {children}
                        </table>
                      </div>
                    );
                  },
                  th: ({ node, children, ...props }) => {
                    return (
                      <th
                        className="bg-[#262828] text-white font-bold px-4 py-3.5 border-b border-zinc-700 text-xs md:text-sm tracking-wider uppercase"
                        {...props}
                      >
                        {children}
                      </th>
                    );
                  },
                  td: ({ node, children, ...props }) => {
                    return (
                      <td
                        className="px-4 py-3.5 border-b border-zinc-800 text-zinc-200 text-[14.5px] md:text-[15.5px] leading-relaxed"
                        {...props}
                      >
                        {children}
                      </td>
                    );
                  },
                }}
              >
                {transformCitationsInMarkdown(
                  stripLeadingQueryTitle(turn.report.markdown_content),
                  turnSources
                )}
              </ReactMarkdown>

              {/* ChatGPT-style Glowing Streaming Pulse Indicator */}
              {isTurnLoading && !turn.report && (
                <div className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 text-xs font-mono shadow-lg shadow-cyan-950/50 backdrop-blur-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_8px_#22d3ee]"></span>
                  </span>
                  <span className="tracking-wide">Synthesizing intelligence...</span>
                </div>
              )}
            </div>
          ) : isTurnLoading && !turn.status?.includes("cancel") && !liveStatus?.toLowerCase().includes("cancel") ? (
            <div className="flex items-center gap-3 text-sm text-cyan-400 font-mono py-4">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              <span>
                {liveStatus || "Formulating response with intelligence context..."}
              </span>
            </div>
          ) : turn.status === "cancelled" || liveStatus?.toLowerCase().includes("cancel") ? (
            <div className="text-amber-400 bg-amber-950/40 p-4 rounded-xl border border-amber-900/50 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span>Chat execution was stopped.</span>
            </div>
          ) : turn.report?.error ? (
            <div className="text-red-400 bg-red-950/40 p-4 rounded-xl border border-red-900/50 text-sm">
              Error: {turn.report.error}
            </div>
          ) : (
            <p className="text-zinc-500 italic">Response completed.</p>
          )}
        </article>
      </div>
    </div>
  );
}
