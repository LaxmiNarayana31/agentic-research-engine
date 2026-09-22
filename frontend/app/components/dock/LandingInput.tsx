"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, Square } from "lucide-react";
import { SlashCommand, DynamicSuggestion } from "../../types";
import ThinkingDepthPicker from "./ThinkingDepthPicker";
import SlashCommandsMenu from "./SlashCommandsMenu";

interface LandingInputProps {
  query: string;
  setQuery: (q: string) => void;
  loading: boolean;
  effortLevel: string;
  setEffortLevel: (effort: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onExecuteSearch: (query: string, effort: string) => void;
  onCancel?: () => void;
  suggestions: DynamicSuggestion[];
  filteredSlashCommands: SlashCommand[];
  slashSelectedIndex: number;
  setSlashSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  thinkingMenuOpen: boolean;
  setThinkingMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function LandingInput({
  query,
  setQuery,
  loading,
  effortLevel,
  setEffortLevel,
  onSubmit,
  onExecuteSearch,
  onCancel,
  suggestions,
  filteredSlashCommands,
  slashSelectedIndex,
  setSlashSelectedIndex,
  thinkingMenuOpen,
  setThinkingMenuOpen,
}: LandingInputProps) {
  const [mainInputFocused, setMainInputFocused] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
      <div className="flex-1 flex flex-col justify-center items-center -mt-12 text-center max-w-3xl xl:max-w-4xl w-full">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2a2c2c] border border-zinc-700/50 text-xs text-zinc-300 mb-6 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Autonomous Multi-Agent Deep Research Engine</span>
        </div>

        <h1 className="font-manrope text-2xl sm:text-4xl md:text-[42px] font-bold text-white tracking-tight mb-3.5 max-w-xl transition-all">
          {effortLevel === "chat" ? (
            <>
              What would you like to{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                chat
              </span>{" "}
              about?
            </>
          ) : (
            <>
              What would you like to{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                research
              </span>
              ?
            </>
          )}
        </h1>
        <p className="font-manrope text-zinc-400 text-sm md:text-base max-w-lg mb-8 leading-relaxed">
          {effortLevel === "chat"
            ? "Fast conversational AI with instant token-by-token streaming and zero multi-agent delay."
            : "Autonomous planning, multi-source web crawling, dense vector synthesis, and citation verification."}
        </p>

        {/* Main Input Form - Generous Width and Height */}
        <form onSubmit={onSubmit} className="w-full max-w-3xl relative">
          {/* Floating Slash Command Autocomplete Menu (Opens Downwards on Landing Page) */}
          <AnimatePresence>
            {query.startsWith("/") &&
              !query.includes(" ") &&
              filteredSlashCommands.length > 0 && (
                <SlashCommandsMenu
                  commands={filteredSlashCommands}
                  selectedIndex={slashSelectedIndex}
                  direction="down"
                  onSelect={(cmd) => {
                    setEffortLevel(cmd.effort);
                    setQuery("");
                  }}
                  setSelectedIndex={setSlashSelectedIndex}
                />
              )}
          </AnimatePresence>

          <div
            className={`bg-[#2a2c2c] rounded-3xl p-4 md:p-4.5 shadow-2xl border transition-all duration-300 ${
              mainInputFocused
                ? "border-cyan-500/70 shadow-cyan-500/10 ring-1 ring-cyan-500/30"
                : "border-zinc-700/60 hover:border-zinc-600"
            }`}
          >
            <textarea
              rows={3}
              value={query}
              onChange={(e) => {
                const val = e.target.value;
                setQuery(val);
              }}
              onFocus={() => setMainInputFocused(true)}
              onBlur={() => setMainInputFocused(false)}
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
                  ? "Ask anything in Chat Mode..."
                  : "Ask any complex research question (or type / for options)..."
              }
              className="font-manrope w-full bg-transparent text-zinc-100 placeholder-zinc-500 resize-none px-3 py-2 text-sm sm:text-base focus:outline-none min-h-[88px] leading-relaxed"
            />

            <div className="flex items-center justify-between pt-2 px-2">
              {/* Custom Thinking Depth / Mode Selector Pill */}
              <ThinkingDepthPicker
                effortLevel={effortLevel}
                setEffortLevel={setEffortLevel}
                isOpen={thinkingMenuOpen}
                setIsOpen={setThinkingMenuOpen}
                direction="down"
                align="left"
              />

              {loading ? (
                <button
                  type="button"
                  onClick={onCancel}
                  title="Stop generating"
                  className="bg-red-500 hover:bg-red-600 text-white p-2.5 rounded-full transition-all duration-200 shadow-md hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer ring-2 ring-red-500/40"
                >
                  <Square className="w-4.5 h-4.5 fill-white" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!query.trim()}
                  title="Execute inquiry"
                  className="bg-white hover:bg-zinc-200 text-black p-2.5 rounded-full transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed shadow-md hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer disabled:hover:scale-100"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Suggested Research Inquiries */}
        {suggestions && suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-8 w-full max-w-3xl space-y-2.5"
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400 uppercase tracking-wider px-1 text-left">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Suggested Research Inquiries</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {suggestions.map((item, idx) => (
                <motion.button
                  key={idx}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.04 }}
                  onClick={() =>
                    onExecuteSearch(item.q, item.effort || "medium")
                  }
                  className="w-full text-left bg-[#242626] hover:bg-[#2c2f2f] border border-zinc-700/70 hover:border-cyan-500/60 text-zinc-200 hover:text-white p-3 rounded-2xl transition-all duration-200 flex items-start gap-3 shadow-md hover:shadow-cyan-950/20 active:scale-[0.99] group cursor-pointer"
                >
                  <span className="text-cyan-400 font-mono text-base shrink-0 mt-0.5 group-hover:translate-x-1 transition-transform">
                    ↳
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5 mb-0.5">
                      <span className="text-[11px] font-semibold text-cyan-400/90 truncate">
                        {item.label}
                      </span>
                      {item.effort && (
                        <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50 uppercase shrink-0">
                          {item.effort}
                        </span>
                      )}
                    </div>
                    <p className="text-xs md:text-[13px] leading-snug font-medium text-zinc-200 group-hover:text-white line-clamp-2">
                      {item.q}
                    </p>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
