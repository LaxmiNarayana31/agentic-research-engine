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
  ChevronRight,
  Globe,
  ArrowUpRight,
} from "lucide-react";
import { Turn, ActivityLog } from "../../types";
import {
  CitationBadge,
  stripLeadingQueryTitle,
  transformCitationsInMarkdown,
  getTurnSources,
  TableOfContents,
} from "../../utils/citations";
import { formatDuration } from "../../utils/suggestions";
import AutonomousExecutionGraph from "./AutonomousExecutionGraph";
import ResearchStream from "./ResearchStream";

interface DossierViewProps {
  turn: Turn;
  turnIdx: number;
  isTurnLoading: boolean;
  isLatest: boolean;
  liveStatus?: string;
  copied: boolean;
  isExportingPDF: boolean;
  showAllSources: boolean;
  setShowAllSources: React.Dispatch<React.SetStateAction<boolean>>;
  taskStatuses: Record<string, string>;
  activityLogs: ActivityLog[];
  durationSeconds?: number;
  effortLevel?: string;
  onCopyMarkdown: (turn: Turn) => void;
  onDownloadMarkdown: (turn: Turn) => void;
  onDownloadPDF: (turn: Turn, idx: number) => void;
}

export default function DossierView({
  turn,
  turnIdx,
  isTurnLoading,
  isLatest,
  liveStatus,
  copied,
  isExportingPDF,
  showAllSources,
  setShowAllSources,
  taskStatuses,
  activityLogs,
  durationSeconds,
  effortLevel = "medium",
  onCopyMarkdown,
  onDownloadMarkdown,
  onDownloadPDF,
}: DossierViewProps) {
  const turnSources = getTurnSources(turn);
  const isCancelled = Boolean(
    turn.status === "cancelled" ||
    liveStatus?.toLowerCase().includes("cancel") ||
    liveStatus?.toLowerCase().includes("stopped")
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8 items-start">
      {/* Left Column: Multi-Agent Execution + Report (8/9 cols) */}
      <div className="lg:col-span-8 xl:col-span-9 order-2 lg:order-1 space-y-4">
        {/* Autonomous Multi-Agent Pipeline Stepper */}
        <AutonomousExecutionGraph
          status={liveStatus}
          plan={turn.plan}
          findings={turn.findings}
          verifications={turn.verifications}
          isComplete={!isTurnLoading && !!turn.report}
          isCancelled={isCancelled}
          effortLevel={turn.effort_level || effortLevel}
        />

        {/* Multi-Agent Execution Log Stream */}
        <ResearchStream
          turn={turn}
          isTurnLoading={isTurnLoading && !isCancelled}
          isLatest={isLatest}
          taskStatuses={taskStatuses}
          activityLogs={activityLogs}
        />

        {/* Stopped / Cancelled Banner if no report was finalized */}
        {!turn.report && isCancelled && (
          <div className="bg-[#1e2020]/90 border border-amber-800/60 rounded-2xl p-6 shadow-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center text-amber-400 font-bold">
                ⏹
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-100">
                  Research Execution Stopped
                </h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Pipeline execution was halted. Subtasks and retrieved findings gathered prior to cancellation are preserved above.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Dossier Report Article */}
        {turn.report ? (
          <div className="bg-[#1e2020]/90 border border-zinc-800/80 rounded-2xl p-6 md:p-8 shadow-lg">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-700/50">
              <div className="flex items-center gap-2.5 text-zinc-100 font-semibold text-xl">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <span>AI Overview</span>
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

            {/* Table of Contents Quick Navigator */}
            {turn.report?.markdown_content && (
              <TableOfContents
                markdown={stripLeadingQueryTitle(turn.report.markdown_content)}
              />
            )}

            {/* Rendered Pure Markdown with Interactive In-Text Citation Tooltips */}
            <article
              id={`turn-report-article-${turnIdx}`}
              className="w-full font-manrope text-zinc-100 antialiased tracking-normal"
            >
              {turn.report.markdown_content ? (
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
                            className="text-base md:text-lg font-bold text-zinc-100 tracking-tight mt-6 mb-2.5 scroll-mt-24 leading-snug"
                            {...props}
                          >
                            {children}
                          </h3>
                        );
                      },
                      h4: ({ node, children, ...props }) => {
                        const text = String(children);
                        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                        return (
                          <h4
                            id={id}
                            className="text-sm md:text-base font-semibold text-zinc-200 mt-5 mb-2 scroll-mt-24 leading-snug"
                            {...props}
                          >
                            {children}
                          </h4>
                        );
                      },
                      p: ({ node, children, ...props }) => {
                        return (
                          <p
                            className="text-[15.5px] md:text-[16.5px] text-[#e4e4e7] leading-[1.8] md:leading-[1.85] mb-5 font-normal tracking-[0.01em] selection:bg-cyan-900 selection:text-white"
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
                  {isTurnLoading && (
                    <div className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 text-xs font-mono shadow-lg shadow-cyan-950/50 backdrop-blur-sm">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_8px_#22d3ee]"></span>
                      </span>
                      <span className="tracking-wide">Synthesizing intelligence...</span>
                    </div>
                  )}

                  {/* Research Completion Metadata Footer */}
                  {!isTurnLoading && turn.report && (
                    <div className="mt-8 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></span>
                        <span className="text-zinc-300 font-medium">
                          {turn.duration_seconds || turn.report?.duration_seconds
                            ? `Completed in ${
                                turn.duration_seconds ||
                                turn.report?.duration_seconds
                              }s`
                            : durationSeconds && isLatest
                            ? `Completed in ${formatDuration(durationSeconds)}`
                            : "Completed"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-zinc-500 text-[11px] font-mono">
                        {turn.plan?.sub_tasks && (
                          <>
                            <span>
                              {turn.plan.sub_tasks.length} subtasks verified
                            </span>
                            <span>•</span>
                          </>
                        )}
                        <span>{turnSources.length} sources synthesized</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : turn.report.error ? (
                <div className="text-red-400 bg-red-950/40 p-4 rounded-xl border border-red-900/50 text-sm">
                  Research Error: {turn.report.error}
                </div>
              ) : (
                <p className="text-zinc-500 italic">Synthesizing report content...</p>
              )}
            </article>
          </div>
        ) : null}
      </div>

      {/* Right Column: Google AI Overview Style Sources Rail */}
      <div className="lg:col-span-4 xl:col-span-3 order-1 lg:order-2 lg:sticky lg:top-4">
        <div className="w-full bg-[#1e2020]/90 border border-zinc-800/80 rounded-2xl p-4 shadow-lg flex flex-col max-h-[calc(100vh-140px)]">
          <div className="flex items-center justify-between mb-3 px-1 shrink-0">
            <span className="text-sm md:text-[15px] font-semibold text-zinc-200">
              Sources
            </span>
          </div>

          {!turnSources.length && isTurnLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 text-zinc-300 text-sm py-8 bg-[#242626] rounded-2xl p-4 border border-zinc-800">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
              <span>Discovering optimal sources...</span>
            </div>
          ) : (
            <div
              className="flex flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1 custom-scrollbar"
              style={{ overscrollBehavior: "contain" }}
            >
              {(showAllSources ? turnSources : turnSources.slice(0, 4)).map(
                (s, i) => {
                  try {
                    const urlObj = new URL(s.url);
                    const domain = urlObj.hostname.replace("www.", "");
                    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
                    return (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        key={i}
                        className="group flex items-start gap-3 bg-[#242626] hover:bg-[#2f3232] border border-zinc-700/70 hover:border-cyan-500/60 transition-all duration-200 rounded-2xl p-3 shadow-md hover:shadow-cyan-950/20"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1.5 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-4.5 h-4.5 rounded-md bg-[#181a1a] flex items-center justify-center shrink-0 overflow-hidden border border-zinc-700/80 p-0.5 shadow-sm">
                                <img
                                  src={favicon}
                                  alt=""
                                  className="w-3.5 h-3.5 object-contain"
                                  onError={(e: any) => {
                                    e.target.style.display = "none";
                                    if (e.target.nextElementSibling)
                                      e.target.nextElementSibling.style.display =
                                        "block";
                                  }}
                                />
                                <Globe className="w-3.5 h-3.5 text-cyan-400 hidden" />
                              </div>
                              <span className="text-xs text-zinc-300 font-semibold truncate">
                                {domain}
                              </span>
                            </div>
                          </div>
                          <h4 className="text-[13.5px] md:text-[14px] font-medium text-zinc-100 leading-snug line-clamp-2 group-hover:text-cyan-300 transition-colors">
                            {s.title && s.title !== s.url ? s.title : domain}
                          </h4>
                        </div>

                        <div className="w-6 h-6 min-w-[24px] shrink-0 rounded-lg bg-zinc-800/90 flex items-center justify-center border border-zinc-700/70 group-hover:border-cyan-500/50 group-hover:bg-cyan-950/40 transition-colors mt-0.5">
                          <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-cyan-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                        </div>
                      </a>
                    );
                  } catch (e) {
                    return null;
                  }
                }
              )}

              {turnSources.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllSources(!showAllSources)}
                  className="w-full mt-1 py-2 px-3 text-xs md:text-sm font-semibold text-zinc-200 hover:text-white bg-[#242626] hover:bg-[#2f3232] border border-zinc-700/80 hover:border-cyan-500/70 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-md hover:shadow-cyan-950/20 active:scale-98 cursor-pointer shrink-0"
                >
                  <span>
                    {showAllSources ? "Show less" : "Show all sources"}
                  </span>
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-cyan-400 transition-transform duration-200 ${
                      showAllSources ? "-rotate-90" : "rotate-90"
                    }`}
                  />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
