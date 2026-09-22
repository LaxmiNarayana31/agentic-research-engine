"use client";

import React from "react";
import {
  Cpu,
  ChevronDown,
  Loader2,
  CheckCircle2,
  Globe,
  ShieldCheck,
  Search,
} from "lucide-react";
import { Turn, ActivityLog } from "../../types";

interface ResearchStreamProps {
  turn: Turn;
  isTurnLoading: boolean;
  isLatest: boolean;
  taskStatuses: Record<string, string>;
  activityLogs: ActivityLog[];
}

export default function ResearchStream({
  turn,
  isTurnLoading,
  isLatest,
  taskStatuses,
  activityLogs,
}: ResearchStreamProps) {
  return (
    <div>
      <details className="group" open={isTurnLoading}>
        <summary className="flex items-center justify-between text-zinc-200 hover:text-white cursor-pointer font-medium text-[13.5px] select-none list-none bg-[#1e2020] hover:bg-[#232525] px-4 py-3 rounded-2xl border border-zinc-800/90 hover:border-zinc-700/80 transition-all shadow-sm group">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6.5 h-6.5 rounded-lg bg-[#262828] border border-zinc-700/60 flex items-center justify-center shrink-0">
              <Cpu
                className={`w-3.5 h-3.5 ${
                  isTurnLoading ? "text-cyan-400 animate-pulse" : "text-zinc-300"
                }`}
              />
            </div>
            <span className="font-semibold text-zinc-200 group-hover:text-white transition-colors">
              Multi-Agent Execution Log
            </span>
          </div>

          <div className="w-6 h-6 rounded-md bg-[#262828] group-hover:bg-[#2c2f2f] flex items-center justify-center text-zinc-400 group-hover:text-zinc-200 transition-colors">
            <ChevronDown className="w-3.5 h-3.5 transition-transform duration-200 group-open:rotate-180" />
          </div>
        </summary>

        <div className="mt-2.5 space-y-2.5 p-4 bg-[#181a1a] border border-zinc-800/80 rounded-2xl shadow-inner">
          {!turn.plan && isTurnLoading && (
            <div className="flex items-center gap-3 text-sm text-cyan-400 p-2 font-mono">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
              <span>Formulating targeted research decomposition...</span>
            </div>
          )}

          {turn.plan?.sub_tasks?.map((st: any, idx: number) => {
            const isDone = turn.findings && turn.findings.length > idx;
            const isRunning =
              isTurnLoading &&
              !isDone &&
              (turn.findings?.length === idx || taskStatuses[st.task_id]);
            const currentStatus = taskStatuses[st.task_id];
            const finding = turn.findings?.[idx];
            return (
              <div
                key={st.task_id || idx}
                className="text-sm bg-[#222424] p-3 rounded-xl border border-zinc-800/90 transition-all space-y-2"
              >
                <div
                  className={`font-medium flex items-center justify-between gap-2 ${
                    isDone
                      ? "text-zinc-200"
                      : isRunning
                      ? "text-cyan-300"
                      : "text-zinc-500"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : isRunning ? (
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-zinc-700 shrink-0" />
                    )}
                    <span>
                      Step {idx + 1}: {st.description}
                    </span>
                  </div>
                  {isRunning && currentStatus && (
                    <span className="text-xs font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/50 animate-pulse">
                      {currentStatus}
                    </span>
                  )}
                </div>

                {/* Subtask Findings & Crawled Sources */}
                {isDone && finding && (
                  <div className="ml-6 space-y-2 pt-1">
                    {finding.summary && (
                      <p className="text-xs text-zinc-300 leading-relaxed bg-[#1a1c1c] p-2.5 rounded-lg border border-zinc-800/80">
                        {finding.summary}
                      </p>
                    )}
                    {finding.sources && finding.sources.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] text-zinc-400 font-medium">
                          Crawled Sites:
                        </span>
                        {finding.sources.slice(0, 4).map((src: any, sIdx: number) => {
                          const urlStr = typeof src === "string" ? src : src.url;
                          try {
                            const domain = new URL(urlStr).hostname.replace(
                              "www.",
                              ""
                            );
                            return (
                              <a
                                key={sIdx}
                                href={urlStr}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 px-2 py-0.5 rounded border border-cyan-800/40 transition-colors"
                              >
                                <Globe className="w-3 h-3" />
                                <span>{domain}</span>
                              </a>
                            );
                          } catch (_) {
                            return null;
                          }
                        })}
                        {finding.sources.length > 4 && (
                          <span className="text-[10.5px] font-mono text-zinc-400">
                            +{finding.sources.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Entailment Verification Bar */}
                {isDone && turn.verifications?.[idx] && (
                  <div className="ml-6 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-xs text-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 font-medium">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Source Entailment:{" "}
                        {(
                          (turn.verifications[idx]?.entailment_score ?? 1) * 100
                        ).toFixed(0)}
                        % Verified
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-400">
                      Claims cross-checked against retrieved citations
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Search & Crawler Activity Stream (Always Preserved in Execution Log) */}
          {isLatest && activityLogs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-800/80">
              <div className="text-[11.5px] font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>
                  Web Search & Crawler Activity ({activityLogs.length} events)
                </span>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar font-mono text-xs pr-1">
                {activityLogs.map((log, idx) => {
                  let badgeColor = "bg-zinc-800 text-zinc-300 border-zinc-700/60";
                  let badgeText = "SEARCH";
                  if (log.action === "search") {
                    badgeColor = "bg-amber-950/60 text-amber-300 border-amber-800/40";
                    badgeText = "SEARCH";
                  } else if (log.action === "crawl") {
                    badgeColor = "bg-cyan-950/60 text-cyan-300 border-cyan-800/40";
                    badgeText = "READ";
                  } else if (log.action === "plan") {
                    badgeColor = "bg-blue-950/60 text-blue-300 border-blue-800/40";
                    badgeText = "TOPICS";
                  } else if (log.action === "finding") {
                    badgeColor = "bg-emerald-950/60 text-emerald-300 border-emerald-800/40";
                    badgeText = "FACTS";
                  } else if (log.action === "verify") {
                    badgeColor = "bg-purple-950/60 text-purple-300 border-purple-800/40";
                    badgeText = "VERIFY";
                  } else if (log.action === "update") {
                    badgeColor = "bg-zinc-800 text-zinc-300 border-zinc-700/60";
                    badgeText = "UPDATE";
                  }

                  return (
                    <div
                      key={log.id || idx}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#222424]/60 text-zinc-400 border border-zinc-800/60"
                    >
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${badgeColor}`}
                      >
                        {badgeText}
                      </span>
                      <span className="flex-1 leading-snug truncate text-zinc-300">
                        {log.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
