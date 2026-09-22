"use client";

import React from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { SlashCommand } from "../../types";

interface SlashCommandsMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  setSelectedIndex: (idx: number) => void;
  direction?: "up" | "down";
  maxWidthClass?: string;
}

export default function SlashCommandsMenu({
  commands,
  selectedIndex,
  onSelect,
  setSelectedIndex,
  direction = "down",
  maxWidthClass = "w-full",
}: SlashCommandsMenuProps) {
  const isUp = direction === "up";

  if (!commands || commands.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: isUp ? 6 : -6, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: isUp ? 6 : -6, scale: 0.99 }}
      className={`absolute ${
        isUp ? "bottom-full mb-2.5" : "top-full mt-2.5"
      } left-0 ${maxWidthClass} bg-[#1e2020] border border-zinc-700/80 rounded-2xl shadow-2xl p-1.5 z-50 text-left max-h-[45vh] overflow-y-auto custom-scrollbar`}
    >
      <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between border-b border-zinc-800 pb-2 mb-1">
        <span className="flex items-center gap-1.5 text-zinc-300">
          <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
          <span>Commands & Thinking Depth</span>
        </span>
        <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
          Navigate with arrows • Press Enter
        </span>
      </div>

      <div className="space-y-0.5">
        {commands.map((cmd, idx) => {
          const isSelected = (selectedIndex % commands.length) === idx;
          return (
            <button
              key={cmd.id}
              type="button"
              onClick={() => onSelect(cmd)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full text-left p-2 rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                isSelected
                  ? "bg-[#2c2f2f] text-white"
                  : "hover:bg-[#262828] text-zinc-300 hover:text-white"
              }`}
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-100 font-semibold">
                      {cmd.command}
                    </span>
                    <span className="text-xs font-medium text-zinc-200">
                      {cmd.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">{cmd.desc}</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 border border-zinc-700/60 shrink-0">
                {cmd.badge}
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
