"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { getFollowUpTopics } from "../../utils/suggestions";
import { PipelineData } from "../../types";

interface FollowUpQuestionsProps {
  pipelineData: PipelineData;
  loading: boolean;
  effortLevel: string;
  onExecuteSearch: (query: string, effort: string) => void;
}

export default function FollowUpQuestions({
  pipelineData,
  loading,
  effortLevel,
  onExecuteSearch,
}: FollowUpQuestionsProps) {
  if (loading) return null;

  const activeTurn =
    pipelineData.turns && pipelineData.turns.length > 0
      ? pipelineData.turns[pipelineData.turns.length - 1]
      : pipelineData;

  const queryText = activeTurn?.query || pipelineData.query || "";
  const reportMd =
    activeTurn?.report?.markdown_content ||
    pipelineData.report?.markdown_content ||
    "";
  const relatedQs =
    activeTurn?.report?.related_questions ||
    pipelineData.report?.related_questions;

  if (!reportMd) return null;

  const suggestedTopics = getFollowUpTopics(queryText, reportMd, relatedQs);
  if (!suggestedTopics || suggestedTopics.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400 uppercase tracking-wider px-1">
        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
        <span>Suggested Follow-up Inquiries</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-36 overflow-y-auto custom-scrollbar pr-0.5">
        {suggestedTopics.slice(0, 4).map((topic, sIdx) => (
          <button
            key={sIdx}
            type="button"
            disabled={loading}
            onClick={() => onExecuteSearch(topic, effortLevel)}
            className="w-full text-left bg-[#242626] hover:bg-[#2c2f2f] border border-zinc-700/70 hover:border-cyan-500/60 text-zinc-200 hover:text-white px-3.5 py-2 rounded-xl transition-all duration-200 flex items-start gap-2.5 shadow-sm hover:shadow-cyan-950/20 active:scale-[0.99] group cursor-pointer disabled:opacity-50"
          >
            <span className="text-cyan-400 font-mono text-sm shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform">
              ↳
            </span>
            <span className="flex-1 text-xs md:text-[13px] leading-snug font-medium text-zinc-200 group-hover:text-white line-clamp-2">
              {topic}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
