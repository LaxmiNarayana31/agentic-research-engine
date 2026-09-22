"use client";

import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ChevronRight, Square } from "lucide-react";
import { SlashCommand, PipelineData } from "../../types";
import ThinkingDepthPicker from "./ThinkingDepthPicker";
import SlashCommandsMenu from "./SlashCommandsMenu";
import FollowUpQuestions from "../research/FollowUpQuestions";

interface StickyDockProps {
  query: string;
  setQuery: (q: string) => void;
  loading: boolean;
  effortLevel: string;
  setEffortLevel: (effort: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onExecuteSearch: (query: string, effort: string) => void;
  onCancel?: () => void;
  filteredSlashCommands: SlashCommand[];
  slashSelectedIndex: number;
  setSlashSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  stickyThinkingMenuOpen: boolean;
  setStickyThinkingMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pipelineData: PipelineData;
}

export default function StickyDock({
  query,
  setQuery,
  loading,
  effortLevel,
  setEffortLevel,
  onSubmit,
  onExecuteSearch,
  onCancel,
  filteredSlashCommands,
  slashSelectedIndex,
  setSlashSelectedIndex,
  stickyThinkingMenuOpen,
  setStickyThinkingMenuOpen,
  pipelineData,
}: StickyDockProps) {
  const [stickyInputFocused, setStickyInputFocused] = useState(false);

  return (
    <div className="shrink-0 w-full bg-[#1a1c1c]/95 backdrop-blur-md border-t border-zinc-800/80 py-2.5 px-4 sm:px-6 lg:px-8 xl:px-10 z-20 shadow-2xl">
      <div className="mx-auto w-full max-w-[1600px] 2xl:max-w-[1720px]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8">
          <div className="lg:col-span-8 xl:col-span-9 space-y-2.5">
            {/* Suggested Follow-up Inquiries attached directly above the input query box */}
            <FollowUpQuestions
              pipelineData={pipelineData}
              loading={loading}
              effortLevel={effortLevel}
              onExecuteSearch={onExecuteSearch}
            />

            <form
              onSubmit={onSubmit}
              className={`bg-[#242626] rounded-2xl p-2 md:p-2.5 shadow-2xl border transition-all duration-300 relative ${
                stickyInputFocused
                  ? "border-cyan-500/70 shadow-cyan-500/10 ring-1 ring-cyan-500/30"
                  : "border-zinc-700/80 hover:border-zinc-600"
              }`}
            >
              {/* Floating Slash Command Menu for Sticky Follow-up Input */}
              <AnimatePresence>
                {query.startsWith("/") &&
                  !query.includes(" ") &&
                  filteredSlashCommands.length > 0 && (
                    <SlashCommandsMenu
                      commands={filteredSlashCommands}
                      selectedIndex={slashSelectedIndex}
                      direction="up"
                      maxWidthClass="max-w-lg"
                      onSelect={(cmd) => {
                        setEffortLevel(cmd.effort);
                        setQuery("");
                      }}
                      setSelectedIndex={setSlashSelectedIndex}
                    />
                  )}
              </AnimatePresence>

              <div className="flex items-center gap-3 px-2">
                <textarea
                  rows={1}
                  value={query}
                  disabled={loading}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQuery(val);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(
                      Math.max(e.target.scrollHeight, 38),
                      160
                    )}px`;
                  }}
                  onFocus={() => setStickyInputFocused(true)}
                  onBlur={() => setStickyInputFocused(false)}
                  onKeyDown={(e) => {
                    const isSlashActive =
                      query.startsWith("/") &&
                      !query.includes(" ") &&
                      filteredSlashCommands.length > 0;
                    if (isSlashActive) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSlashSelectedIndex(
                          (prev) => (prev + 1) % filteredSlashCommands.length
                        );
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSlashSelectedIndex(
                          (prev) =>
                            (prev - 1 + filteredSlashCommands.length) %
                            filteredSlashCommands.length
                        );
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        const effectiveIdx = Math.min(
                          Math.max(0, slashSelectedIndex),
                          filteredSlashCommands.length - 1
                        );
                        const selectedCmd =
                          filteredSlashCommands[effectiveIdx] ||
                          filteredSlashCommands[0];
                        if (selectedCmd) {
                          setEffortLevel(selectedCmd.effort);
                          setQuery("");
                        }
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setQuery("");
                        return;
                      }
                    }

                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (query.trim() && !loading) {
                        onExecuteSearch(query, effortLevel);
                      }
                    }
                  }}
                  placeholder={
                    effortLevel === "chat"
                      ? "Ask a follow-up in Fast Chat..."
                      : "Ask a follow-up inquiry (or type / for options)..."
                  }
                  className="font-manrope w-full bg-transparent text-sm md:text-base text-zinc-100 placeholder-zinc-500 focus:outline-none py-1.5 resize-none min-h-[38px] max-h-40 leading-relaxed overflow-y-auto custom-scrollbar"
                />

                <div className="flex items-center gap-2 shrink-0 self-center">
                  {/* Custom Thinking Depth Pill for Follow-up Dock */}
                  <ThinkingDepthPicker
                    effortLevel={effortLevel}
                    setEffortLevel={setEffortLevel}
                    isOpen={stickyThinkingMenuOpen}
                    setIsOpen={setStickyThinkingMenuOpen}
                    direction="up"
                    align="right"
                  />

                  {loading ? (
                    <button
                      type="button"
                      onClick={onCancel}
                      title="Stop generating"
                      className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-full transition-all duration-200 shadow-md hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer ring-2 ring-red-500/40"
                    >
                      <Square className="w-4 h-4 fill-white" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!query.trim()}
                      title="Send query"
                      className="bg-white hover:bg-zinc-200 text-black p-2 rounded-full transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed shadow-md hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer disabled:hover:scale-100"
                    >
                      <ChevronRight className="w-4.5 h-4.5" />
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
