"use client";

import React, { useMemo } from "react";
import { BrainCircuit, CheckCircle2, Loader2 } from "lucide-react";

interface AutonomousExecutionGraphProps {
  status?: string;
  plan?: any;
  findings?: any[];
  verifications?: any[];
  isComplete: boolean;
  isCancelled?: boolean;
  effortLevel?: string;
}

export default function AutonomousExecutionGraph({
  status,
  plan,
  findings,
  verifications,
  isComplete,
  isCancelled,
  effortLevel = "medium"
}: AutonomousExecutionGraphProps) {
  const isTerminatedOrCancelled = Boolean(
    isCancelled ||
    status?.toLowerCase().includes("cancel") ||
    status?.toLowerCase().includes("stopped")
  );

  // Dynamically select steps and agents according to the chosen reasoning depth
  const steps = useMemo(() => {
    const level = effortLevel?.toLowerCase();
    if (level === "low") {
      return [
        { id: "plan", name: "Planner", label: "Fast Decomposition" },
        { id: "research", name: "Researchers", label: "Targeted Web Search" },
        { id: "writer", name: "Dossier Writer", label: "Executive Synthesis" },
      ];
    }
    if (level === "high") {
      return [
        { id: "plan", name: "Planner", label: "Cognitive Breakdown" },
        { id: "research", name: "Researchers", label: "Multi-Source Crawling" },
        { id: "auditor", name: "Gap Auditor", label: "Recursive Depth-2" },
        { id: "verify", name: "Fact Verifier", label: "NLI Entailment Audit" },
        { id: "critic", name: "Critic Agent", label: "Quality Assurance" },
        { id: "writer", name: "Dossier Writer", label: "Deep Dossier Synthesis" },
      ];
    }
    // Default: Medium
    return [
      { id: "plan", name: "Planner", label: "Task Decomposition" },
      { id: "research", name: "Researchers", label: "Multi-Source Crawling" },
      { id: "verify", name: "Fact Verifier", label: "Cross-Citation Audit" },
      { id: "writer", name: "Dossier Writer", label: "Synthesis & Citations" },
    ];
  }, [effortLevel]);

  const activeStep = useMemo(() => {
    if (isComplete) return steps.length;
    const s = status?.toLowerCase() || "";
    const level = effortLevel?.toLowerCase();
    const hasPlan = Boolean(plan && plan.sub_tasks && plan.sub_tasks.length > 0);
    const hasFindings = Boolean(findings && findings.length > 0);
    const hasVerifications = Boolean(verifications && verifications.length > 0);
    const isSynthesizing =
      s.includes("synthesiz") ||
      s.includes("writing") ||
      s.includes("dossier") ||
      s.includes("generating report");

    if (level === "low") {
      // 0: Planner, 1: Researchers, 2: Dossier Writer
      if (isSynthesizing || (hasFindings && s.includes("report"))) return 2;
      if (hasPlan || s.includes("crawling") || s.includes("scraping") || s.includes("reading source"))
        return 1;
      return 0;
    }

    if (level === "high") {
      // 0: Planner, 1: Researchers, 2: Gap Auditor, 3: Fact Verifier, 4: Critic Agent, 5: Dossier Writer
      if (isSynthesizing || s.includes("dossier synthesis")) return 5;
      if (s.includes("critic") || s.includes("quality assurance") || s.includes("evaluating")) return 4;
      if (hasVerifications || s.includes("verif") || s.includes("entailment")) return 3;
      if (s.includes("gap") || s.includes("depth-2") || s.includes("auditing")) return 2;
      if (hasPlan || s.includes("crawling") || s.includes("scraping") || s.includes("reading source"))
        return 1;
      return 0;
    }

    // Medium (Default): 0: Planner, 1: Researchers, 2: Fact Verifier, 3: Dossier Writer
    if (
      isSynthesizing ||
      (hasFindings && hasVerifications && (s.includes("report") || s.includes("synthesiz")))
    )
      return 3;
    if (hasVerifications || (hasFindings && (s.includes("verif") || s.includes("audit")))) return 2;
    if (hasPlan || s.includes("crawling") || s.includes("scraping") || s.includes("reading source"))
      return 1;
    return 0;
  }, [isComplete, status, plan, findings, verifications, effortLevel, steps.length]);

  const gridColsClass = useMemo(() => {
    const count = steps.length;
    if (count === 3) return "grid-cols-1 sm:grid-cols-3";
    if (count === 6) return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6";
    return "grid-cols-2 md:grid-cols-4";
  }, [steps.length]);

  return (
    <div className="w-full bg-[#1e2020]/90 border border-zinc-800/80 rounded-2xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
          <BrainCircuit className={`w-3.5 h-3.5 ${isTerminatedOrCancelled ? "text-amber-400" : "text-cyan-400 animate-pulse"}`} />
          Autonomous Agent Execution Graph
        </span>
        {isTerminatedOrCancelled && (
          <span className="text-[11px] font-medium font-mono text-amber-400 bg-amber-950/50 border border-amber-800/50 px-2 py-0.5 rounded">
            Stopped
          </span>
        )}
      </div>
      <div className={`grid ${gridColsClass} gap-2 relative`}>
        {steps.map((step, idx) => {
          const isDone = isComplete || idx < activeStep;
          const isCurrent = !isComplete && !isTerminatedOrCancelled && idx === activeStep;
          const isStoppedHere = isTerminatedOrCancelled && idx === activeStep;

          return (
            <div
              key={step.id}
              className={`flex flex-col items-center text-center p-2.5 rounded-xl border transition-all ${
                isCurrent
                  ? "bg-cyan-950/40 border-cyan-500/50 text-cyan-300 shadow-md shadow-cyan-500/10 scale-102"
                  : isStoppedHere
                  ? "bg-amber-950/20 border-amber-800/50 text-amber-300"
                  : isDone
                  ? "bg-[#252828] border-emerald-500/30 text-emerald-400"
                  : "bg-[#1a1c1c] border-zinc-800/60 text-zinc-500"
              }`}
            >
              <div className="flex items-center justify-center w-6 h-6 rounded-lg mb-1.5 bg-zinc-900/80 border border-zinc-700/40">
                {isDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : isCurrent ? (
                  <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                ) : isStoppedHere ? (
                  <span className="w-2 h-2 rounded-full bg-amber-400/80" />
                ) : (
                  <span className="text-[10px] font-mono text-zinc-500">{idx + 1}</span>
                )}
              </div>
              <span className="text-[11px] font-semibold leading-tight">{step.name}</span>
              <span className="text-[9px] text-zinc-400 line-clamp-1 mt-0.5">{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
