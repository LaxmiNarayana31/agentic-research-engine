"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, XCircle, MessageSquare } from "lucide-react";
import { HistoryItem } from "../types";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  currentSessionId?: string | null;
  activeTab: string;
  onSelectSession: (session: HistoryItem) => void;
  isAuthenticated: boolean;
}

export default function SearchModal({
  isOpen,
  onClose,
  history,
  currentSessionId,
  activeTab,
  onSelectSession,
  isAuthenticated
}: SearchModalProps) {
  const [modalSearchQuery, setModalSearchQuery] = useState("");
  const modalInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => modalInputRef.current?.focus(), 80);
    } else {
      setModalSearchQuery("");
    }
  }, [isOpen]);

  const modalFilteredHistory = useMemo(() => {
    if (!isAuthenticated) return [];
    if (!modalSearchQuery.trim()) return history;
    const q = modalSearchQuery.toLowerCase().trim();
    const searchWords = q.split(/\s+/).filter(Boolean);

    return history.filter((item) => {
      const mainQuery = (item.query || "").toLowerCase();
      const hasWordMatch = searchWords.every((w) => mainQuery.includes(w));
      if (hasWordMatch) return true;

      if (item.turns && Array.isArray(item.turns)) {
        return item.turns.some((t) => {
          const tq = (t.query || "").toLowerCase();
          const tr = (t.report?.markdown_content || "").toLowerCase();
          return searchWords.every((w) => tq.includes(w) || tr.includes(w));
        });
      }
      return false;
    });
  }, [isAuthenticated, modalSearchQuery, history]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          />

          {/* Modal Window */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -12 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="relative w-full max-w-xl bg-[#202222] border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh] z-10"
          >
            {/* Top Search Input Bar */}
            <div className="flex items-center px-4 py-3.5 border-b border-zinc-800 gap-3">
              <Search className="w-4 h-4 text-zinc-400 shrink-0" />
              <input
                ref={modalInputRef}
                type="text"
                value={modalSearchQuery}
                onChange={(e) => setModalSearchQuery(e.target.value)}
                placeholder="Search researches and chat history..."
                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
              />
              {modalSearchQuery && (
                <button
                  type="button"
                  onClick={() => setModalSearchQuery("")}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body with Sections */}
            <div className="p-3 overflow-y-auto custom-scrollbar flex flex-col gap-4 max-h-[calc(75vh-58px)]">
              {!modalSearchQuery.trim() ? (
                <>
                  {/* Last Opened Section */}
                  {history.length > 0 && (
                    <div className="space-y-1">
                      <div className="px-3 py-1 text-xs font-semibold text-zinc-400">
                        Last opened
                      </div>
                      {history.slice(0, 3).map((s) => {
                        const isCurrent = currentSessionId === s.id && activeTab === "current";
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              onSelectSession(s);
                              onClose();
                            }}
                            className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors group cursor-pointer ${
                              isCurrent
                                ? "bg-[#282b2b] text-white"
                                : "hover:bg-[#282b2b] text-zinc-200 hover:text-white"
                            }`}
                          >
                            <MessageSquare className="w-4 h-4 text-zinc-400 group-hover:text-cyan-400 shrink-0" />
                            <span className="truncate text-sm font-medium flex-1">{s.query}</span>
                            {isCurrent && (
                              <span className="text-[10px] text-cyan-400 font-mono bg-cyan-950/60 border border-cyan-800/40 px-1.5 py-0.5 rounded">
                                Active
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Recent Chats Section */}
                  {history.length > 3 && (
                    <div className="space-y-1">
                      <div className="px-3 py-1 text-xs font-semibold text-zinc-400">
                        Recent chats
                      </div>
                      {history.slice(3).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            onSelectSession(s);
                            onClose();
                          }}
                          className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#282b2b] text-zinc-200 hover:text-white transition-colors group cursor-pointer"
                        >
                          <MessageSquare className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
                          <span className="truncate text-sm font-medium flex-1">{s.query}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {history.length === 0 && (
                    <div className="py-12 text-center text-xs text-zinc-500 italic">
                      No previous chats recorded yet.
                    </div>
                  )}
                </>
              ) : (
                /* Filtered Search Results */
                <div className="space-y-1">
                  <div className="px-3 py-1 text-xs font-semibold text-zinc-400 flex items-center justify-between">
                    <span>Search results</span>
                    <span className="text-zinc-400 font-mono text-[11px]">
                      {modalFilteredHistory.length} found
                    </span>
                  </div>

                  {modalFilteredHistory.length === 0 ? (
                    <div className="py-12 text-center text-xs text-zinc-500 italic">
                      No matching researches found for &quot;{modalSearchQuery}&quot;
                    </div>
                  ) : (
                    modalFilteredHistory.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          onSelectSession(s);
                          onClose();
                        }}
                        className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#282b2b] text-zinc-200 hover:text-white transition-colors group cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
                        <span className="truncate text-sm font-medium flex-1">{s.query}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
