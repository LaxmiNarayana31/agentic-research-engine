"use client";

import React, { useState } from "react";
import {
  BrainCircuit,
  Search,
  Plus,
  Trash2,
  Building2,
  ChevronDown,
  LogOut,
  Sparkles,
  User as UserIcon
} from "lucide-react";
import { HistoryItem } from "../types";

export function SidebarToggleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function SquarePenIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  );
}

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  workspaces: any[];
  activeTenant: any;
  switchWorkspace: (id: string) => void;
  user: any;
  isAuthenticated: boolean;
  history: HistoryItem[];
  activeSessionId?: string | null;
  activeTab: string;
  onSelectSession: (s: HistoryItem) => void;
  onDeleteSessionPrompt: (id: string) => void;
  onStartNewSession: () => void;
  onOpenSearchModal: () => void;
  onOpenAuthModal: (mode: "signin" | "signup") => void;
  onOpenLogoutModal: () => void;
  fetchHistory: () => void;
}

export default function Sidebar({
  sidebarOpen,
  setSidebarOpen,
  workspaces,
  activeTenant,
  switchWorkspace,
  user,
  isAuthenticated,
  history,
  activeSessionId,
  activeTab,
  onSelectSession,
  onDeleteSessionPrompt,
  onStartNewSession,
  onOpenSearchModal,
  onOpenAuthModal,
  onOpenLogoutModal,
  fetchHistory
}: SidebarProps) {
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  return (
    <aside
      className={`h-screen flex flex-col justify-between shrink-0 transition-all duration-300 ease-in-out relative border-r border-zinc-800/80 bg-[#1a1c1c] select-none ${
        sidebarOpen ? "w-64" : "w-12"
      }`}
    >
      {/* Expanded Full Sidebar */}
      <div
        className={`flex flex-col h-full w-full justify-between transition-opacity duration-200 ${
          sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex flex-col w-full min-h-0 flex-1">
          {/* Header with Branding, Search Icon, and Sidebar Close Button */}
          <div className="h-14 px-3 border-b border-zinc-800/80 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={onStartNewSession}
              className="flex items-center gap-2 hover:opacity-85 transition-opacity text-left cursor-pointer group min-w-0"
            >
              <div className="w-7 h-7 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(6,182,212,0.18)] group-hover:border-cyan-400/60 transition-colors">
                <BrainCircuit className="w-4 h-4 text-cyan-400 shrink-0" />
              </div>
              <span className="font-bold text-[13.5px] tracking-tight text-white leading-none whitespace-nowrap">
                Deep Research AI
              </span>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onOpenSearchModal}
                title="Search chats (Ctrl+K)"
                className="w-7.5 h-7.5 rounded-lg text-zinc-300 hover:text-white bg-[#252828] hover:bg-[#2e3131] border border-zinc-700/80 hover:border-zinc-600 shadow-sm transition-all cursor-pointer flex items-center justify-center group"
              >
                <Search className="w-3.5 h-3.5 text-zinc-300 group-hover:text-white transition-colors" />
              </button>

              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                title="Close sidebar"
                className="w-7.5 h-7.5 rounded-lg text-zinc-300 hover:text-white bg-[#252828] hover:bg-[#2e3131] border border-zinc-700/80 hover:border-zinc-600 shadow-sm transition-all cursor-pointer flex items-center justify-center group"
              >
                <SidebarToggleIcon className="w-3.5 h-3.5 text-zinc-300 group-hover:text-white transition-colors" />
              </button>
            </div>
          </div>

          {/* Action Buttons: New Research Session */}
          <div className="p-2.5 shrink-0">
            <button
              type="button"
              onClick={onStartNewSession}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-[#242626] hover:bg-[#2e3030] border border-zinc-700/70 hover:border-zinc-600 text-zinc-100 hover:text-white transition-all text-xs font-medium shadow-sm active:scale-[0.99] cursor-pointer group"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400 shrink-0 group-hover:rotate-90 transition-transform duration-200" />
              <span className="leading-none whitespace-nowrap">New Research Session</span>
            </button>
          </div>

          {/* History List */}
          <div className="px-3 py-1 flex flex-col gap-0.5 overflow-y-auto flex-1 custom-scrollbar">
            <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wider text-zinc-400 uppercase">
              Recent
            </div>

            {!isAuthenticated ? (
              <div className="px-3 py-6 text-xs text-zinc-500 text-center italic leading-relaxed">
                Sign in to save research history
              </div>
            ) : history.length === 0 ? (
              <div className="px-3 py-6 text-xs text-zinc-500 text-center italic">
                No past sessions
              </div>
            ) : (
              history.map((s) => {
                const isSelected = activeSessionId === s.id && activeTab === "current";
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectSession(s)}
                    className={`w-full text-left group relative flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors cursor-pointer select-none ${
                      isSelected
                        ? "bg-[#252828] text-white font-medium"
                        : "text-zinc-200 hover:bg-[#252828] hover:text-white"
                    }`}
                  >
                    <div className="truncate flex-1 pr-6">
                      <span className="truncate text-[13.5px] leading-snug">{s.query}</span>
                    </div>
                    <button
                      type="button"
                      title="Delete session"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSessionPrompt(s.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity absolute right-2 p-1 rounded-md hover:bg-zinc-800 text-zinc-400 cursor-pointer z-10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* User Account / Multi-Tenancy Footer */}
        <div className="p-3 border-t border-zinc-800/80 bg-[#161818] shrink-0 relative">
          {user ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2.5 text-left min-w-0 flex-1 p-1 rounded-lg hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase shrink-0 shadow-sm">
                    {user.full_name ? user.full_name[0] : user.email[0]}
                  </div>
                  <div className="truncate flex-1">
                    <div className="text-xs font-medium text-zinc-200 truncate">
                      {user.full_name || user.email}
                    </div>
                    <div className="text-[10px] text-cyan-400 font-medium truncate flex items-center gap-1">
                      <Building2 className="w-2.5 h-2.5" />
                      <span>{activeTenant?.name || "Personal Workspace"}</span>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
                      userDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={onOpenLogoutModal}
                  title="Sign Out"
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800/70 transition-colors shrink-0 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Workspace Switcher & User Details Dropdown */}
              {userDropdownOpen && (
                <div className="p-2 bg-[#202222] border border-zinc-700/80 rounded-xl shadow-xl space-y-2">
                  <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider px-1">
                    Workspaces
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                    {workspaces.map((ws) => (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => {
                          switchWorkspace(ws.id);
                          setUserDropdownOpen(false);
                          fetchHistory();
                        }}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors ${
                          activeTenant?.id === ws.id
                            ? "bg-cyan-950/60 text-cyan-300 border border-cyan-700/40 font-semibold"
                            : "text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        <span className="truncate">{ws.name}</span>
                        <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                          {ws.tier}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => onOpenAuthModal("signin")}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-900/30 transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-200" />
                <span>Sign In / Workspace</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Collapsed Mini-Rail (Smooth overlay when collapsed) */}
      <div
        className={`w-12 h-full absolute left-0 top-0 flex flex-col justify-between items-center transition-opacity duration-200 z-10 ${
          !sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex flex-col items-center py-4 gap-4 w-full px-1.5">
          {/* Top: Open Sidebar Toggle Button */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
            className="w-8.5 h-8.5 rounded-lg bg-[#242626] hover:bg-[#2e3131] border border-zinc-700/60 hover:border-zinc-500 flex items-center justify-center transition-all cursor-pointer shadow-sm group"
          >
            <SidebarToggleIcon className="w-4 h-4 text-zinc-300 group-hover:text-white transition-colors" />
          </button>

          {/* New Research Session Icon Button */}
          <button
            type="button"
            onClick={onStartNewSession}
            title="New research session"
            className="w-8.5 h-8.5 rounded-lg bg-[#242626] hover:bg-[#2e3131] border border-zinc-700/60 hover:border-zinc-500 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer shadow-sm group"
          >
            <SquarePenIcon className="w-4 h-4 text-zinc-300 group-hover:text-white transition-colors" />
          </button>

          {/* Search Modal Icon Button */}
          <button
            type="button"
            onClick={onOpenSearchModal}
            title="Search chats (Ctrl+K)"
            className="w-8.5 h-8.5 rounded-lg bg-[#242626] hover:bg-[#2e3131] border border-zinc-700/60 hover:border-zinc-500 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer shadow-sm group"
          >
            <Search className="w-4 h-4 text-zinc-300 group-hover:text-white transition-colors" />
          </button>
        </div>

        <div className="p-2 border-t border-zinc-800/80 flex flex-col items-center gap-2">
          {user ? (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              title={`${user.full_name || user.email} (${activeTenant?.name || "Workspace"})`}
              className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase cursor-pointer"
            >
              {user.full_name ? user.full_name[0] : user.email[0]}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenAuthModal("signin")}
              title="Sign In to Save Researches"
              className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-cyan-950 border border-zinc-700 hover:border-cyan-500/50 flex items-center justify-center text-cyan-400 cursor-pointer"
            >
              <UserIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
