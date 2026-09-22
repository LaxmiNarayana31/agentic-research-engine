"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, BrainCircuit, ChevronDown } from "lucide-react";

interface ThinkingDepthPickerProps {
  effortLevel: string;
  setEffortLevel: (effort: string) => void;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  direction?: "up" | "down";
  align?: "left" | "right";
}

export default function ThinkingDepthPicker({
  effortLevel,
  setEffortLevel,
  isOpen,
  setIsOpen,
  direction = "down",
  align = "left",
}: ThinkingDepthPickerProps) {
  const isUp = direction === "up";
  const alignClass = align === "right" ? "right-0" : "left-0";

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#242626] hover:bg-[#2b2d2d] border border-zinc-700/80 hover:border-zinc-600 text-zinc-200 text-xs font-medium transition-all shadow-sm cursor-pointer"
      >
        {effortLevel === "chat" ? (
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
        ) : (
          <BrainCircuit className="w-3.5 h-3.5 text-zinc-400" />
        )}
        <span>
          {effortLevel === "chat" && "Chat Mode"}
          {effortLevel === "low" && "Thinking: Quick"}
          {effortLevel === "medium" && "Thinking: Deep"}
          {effortLevel === "high" && "Thinking: Exhaustive"}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: isUp ? 6 : -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: isUp ? 6 : -6, scale: 0.99 }}
            className={`absolute ${
              isUp ? "bottom-full mb-2" : "top-full mt-2"
            } ${alignClass} w-80 max-w-[calc(100vw-32px)] bg-[#1e2020] border border-zinc-700/80 rounded-2xl shadow-2xl p-1.5 z-50 text-left max-h-[45vh] overflow-y-auto custom-scrollbar`}
          >
            <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between border-b border-zinc-800 pb-2 mb-1">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <BrainCircuit className="w-3.5 h-3.5 text-zinc-400" />
                <span>Thinking Effort Depth</span>
              </span>
            </div>

            <div className="space-y-0.5">
              {/* Quick Scan */}
              <button
                type="button"
                onClick={() => {
                  setEffortLevel("low");
                  setIsOpen(false);
                }}
                className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                  effortLevel === "low"
                    ? "bg-[#2c2f2f] text-white"
                    : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Quick Scan</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">
                      Quick
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                    Rapid preliminary overview & multi-source scan
                  </p>
                </div>
              </button>

              {/* Deep Research */}
              <button
                type="button"
                onClick={() => {
                  setEffortLevel("medium");
                  setIsOpen(false);
                }}
                className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                  effortLevel === "medium"
                    ? "bg-[#2c2f2f] text-white"
                    : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Deep Research</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">
                      Standard
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                    Comprehensive multi-step analysis & citation verification
                  </p>
                </div>
              </button>

              {/* Exhaustive Dossier */}
              <button
                type="button"
                onClick={() => {
                  setEffortLevel("high");
                  setIsOpen(false);
                }}
                className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                  effortLevel === "high"
                    ? "bg-[#2c2f2f] text-white"
                    : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      Exhaustive Dossier
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">
                      Exhaustive
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                    Deep recursive search & multi-perspective verification
                  </p>
                </div>
              </button>

              <div className="my-1 border-t border-zinc-800" />

              {/* Fast Chat Mode */}
              <button
                type="button"
                onClick={() => {
                  setEffortLevel("chat");
                  setIsOpen(false);
                }}
                className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                  effortLevel === "chat"
                    ? "bg-[#2c2f2f] text-white"
                    : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Fast Chat Mode</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">
                      Chat
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                    Conversational answers grounded in research dossiers
                  </p>
                </div>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
