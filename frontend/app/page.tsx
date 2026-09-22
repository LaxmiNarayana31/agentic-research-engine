"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useAuth } from "./context/AuthContext";
import AuthModal from "./components/AuthModal";
import Sidebar from "./components/Sidebar";
import SearchModal from "./components/SearchModal";
import LogoutModal from "./components/modals/LogoutModal";
import DeleteChatModal from "./components/modals/DeleteChatModal";
import LimitReachedModal from "./components/modals/LimitReachedModal";
import LandingInput from "./components/dock/LandingInput";
import StickyDock from "./components/dock/StickyDock";
import ChatTurnView from "./components/research/ChatTurnView";
import DossierView from "./components/research/DossierView";
import { DEFAULT_SUGGESTIONS } from "./utils/suggestions";
import {
  handleCopyTurnMarkdown,
  handleDownloadTurnMarkdown,
  handleDownloadTurnPDF,
} from "./utils/export";
import {
  PipelineData,
  Turn,
  ActivityLog,
  SlashCommand,
  HistoryItem,
  DynamicSuggestion,
} from "./types";

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "quick",
    command: "/quick",
    aliases: ["/low", "/fast", "/q"],
    name: "Quick Scan",
    badge: "Quick",
    desc: "Rapid preliminary overview & multi-source scan",
    effort: "low",
    mode: "research",
  },
  {
    id: "deep",
    command: "/deep",
    aliases: ["/medium", "/think", "/d"],
    name: "Deep Research",
    badge: "Standard",
    desc: "Comprehensive multi-step analysis & citation verification",
    effort: "medium",
    mode: "research",
  },
  {
    id: "pro",
    command: "/pro",
    aliases: ["/high", "/exhaustive", "/p"],
    name: "Exhaustive Dossier",
    badge: "Exhaustive",
    desc: "Deep recursive search & multi-perspective verification",
    effort: "high",
    mode: "research",
  },
  {
    id: "chat",
    command: "/chat",
    aliases: ["/ask", "/c"],
    name: "Fast Chat",
    badge: "Conversational",
    desc: "Converse directly with research dossier context",
    effort: "chat",
    mode: "chat",
  },
];

export default function Home() {
  const {
    user,
    token,
    activeTenant,
    workspaces,
    logout,
    switchWorkspace,
  } = useAuth();

  const getAuthToken = (): string | null => {
    if (token) return token;
    if (typeof window !== "undefined") {
      return (
        localStorage.getItem("dr_access_token") ||
        localStorage.getItem("token") ||
        null
      );
    }
    return null;
  };

  // Modals & Navigation state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"signin" | "signup">("signin");
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  // Search & Input state
  const [query, setQuery] = useState("");
  const [effortLevel, setEffortLevel] = useState("chat");
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState("new");
  const [taskStatuses, setTaskStatuses] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [stickyThinkingMenuOpen, setStickyThinkingMenuOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  // Real-time execution timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  // Hydration & logs
  const [mounted, setMounted] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);

  // Dynamic LLM-generated suggestions
  const [suggestions, setSuggestions] = useState<DynamicSuggestion[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = sessionStorage.getItem("dr_suggestions");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (_) {}
    }
    return DEFAULT_SUGGESTIONS;
  });

  const openAuthModal = (mode: "signin" | "signup" = "signin") => {
    if (token || getAuthToken()) return;
    setAuthModalMode(mode);
    setAuthModalOpen(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("auth", mode);
      window.history.pushState(null, "", url.toString());
    } catch (_) {}
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("auth")) {
        url.searchParams.delete("auth");
        window.history.replaceState(null, "", url.toString());
      }
    } catch (_) {}
  };

  // Ensure auth modal is immediately dismissed when authenticated
  useEffect(() => {
    if (token || getAuthToken()) {
      setAuthModalOpen(false);
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has("auth")) {
          url.searchParams.delete("auth");
          window.history.replaceState(null, "", url.toString());
        }
      } catch (_) {}
    }
  }, [token]);

  // Slash commands filtering with prefix-priority sorting
  const filteredSlashCommands = useMemo(() => {
    if (!query.startsWith("/") || query.includes(" ")) return [];
    const search = query.trim().toLowerCase();
    if (search === "/") return SLASH_COMMANDS;
    const searchClean = search.slice(1);
    if (!searchClean) return SLASH_COMMANDS;

    const matched = SLASH_COMMANDS.filter((cmd) => {
      if (cmd.command.toLowerCase().startsWith(search)) return true;
      if (
        cmd.aliases.some(
          (a) =>
            a.toLowerCase().startsWith(search) ||
            a.replace("/", "").toLowerCase().startsWith(searchClean)
        )
      )
        return true;
      if (cmd.id.toLowerCase().startsWith(searchClean)) return true;
      if (cmd.name.toLowerCase().startsWith(searchClean)) return true;
      if (cmd.command.toLowerCase().includes(searchClean)) return true;
      if (cmd.name.toLowerCase().includes(searchClean)) return true;
      return false;
    });

    return matched.sort((a, b) => {
      const aStartsCmd = a.command.toLowerCase().startsWith(search);
      const bStartsCmd = b.command.toLowerCase().startsWith(search);
      if (aStartsCmd && !bStartsCmd) return -1;
      if (!aStartsCmd && bStartsCmd) return 1;

      const aStartsAlias = a.aliases.some(
        (al) =>
          al.toLowerCase().startsWith(search) ||
          al.replace("/", "").toLowerCase().startsWith(searchClean)
      );
      const bStartsAlias = b.aliases.some(
        (al) =>
          al.toLowerCase().startsWith(search) ||
          al.replace("/", "").toLowerCase().startsWith(searchClean)
      );
      if (aStartsAlias && !bStartsAlias) return -1;
      if (!aStartsAlias && bStartsAlias) return 1;

      const aStartsName =
        a.name.toLowerCase().startsWith(searchClean) ||
        a.id.toLowerCase().startsWith(searchClean);
      const bStartsName =
        b.name.toLowerCase().startsWith(searchClean) ||
        b.id.toLowerCase().startsWith(searchClean);
      if (aStartsName && !bStartsName) return -1;
      if (!aStartsName && bStartsName) return 1;

      return 0;
    });
  }, [query]);

  // Reset highlighted slash command index when query changes
  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [query]);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = () => {
      setThinkingMenuOpen(false);
      setStickyThinkingMenuOpen(false);
    };
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  // Global shortcut (Ctrl+K / Cmd+K) and Escape listener for Search Modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setSearchModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Auto-dismiss transient error notifications after 6s
  useEffect(() => {
    if (error) {
      const isLimit =
        error.toLowerCase().includes("guest") ||
        error.toLowerCase().includes("limit reached");
      if (isLimit) return;
      const timer = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Timer counter when loading
  useEffect(() => {
    let interval: any = null;
    if (loading) {
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [loading]);

  // Compute full chronological list of conversation turns
  const turnsToRender = useMemo(() => {
    if (!pipelineData) return [];
    let turns: Turn[] = [];
    if (
      pipelineData.turns &&
      Array.isArray(pipelineData.turns) &&
      pipelineData.turns.length > 0
    ) {
      const lastIdx = pipelineData.turns.length - 1;
      const lastTurn = pipelineData.turns[lastIdx];
      const lastTurnQuery = lastTurn?.query;
      const lastTurnHasReport = Boolean(
        lastTurn?.report?.markdown_content || lastTurn?.report?.title
      );

      // If loading and executing a new query
      if (
        loading &&
        pipelineData.query &&
        (pipelineData.query !== lastTurnQuery || !lastTurnHasReport)
      ) {
        if (pipelineData.query !== lastTurnQuery) {
          // All previous turns are finished
          turns = pipelineData.turns.map((t) => ({ ...t, isLive: false }));
          // Append the active follow-up query as the only live turn
          turns.push({
            query: pipelineData.query,
            effort_level: pipelineData.effort_level || effortLevel,
            plan: pipelineData.plan,
            findings: pipelineData.findings || [],
            verifications: pipelineData.verifications || [],
            report: pipelineData.report,
            groundedness_score: pipelineData.groundedness_score || pipelineData.report?.groundedness_score,
            total_tokens: pipelineData.total_tokens || pipelineData.report?.total_tokens,
            estimated_cost_usd: pipelineData.estimated_cost_usd || pipelineData.report?.estimated_cost_usd,
            is_chat: Boolean(
              pipelineData.is_chat ||
                pipelineData.effort_level === "chat" ||
                pipelineData.query?.toLowerCase()?.startsWith("/chat")
            ),
            isLive: true,
          });
        } else {
          // The last turn is currently streaming
          turns = pipelineData.turns.map((t, idx) => {
            if (idx === lastIdx) {
              return {
                ...t,
                query: pipelineData.query || t.query,
                effort_level:
                  pipelineData.effort_level || t.effort_level || effortLevel,
                plan: pipelineData.plan || t.plan,
                findings:
                  pipelineData.findings && pipelineData.findings.length > 0
                    ? pipelineData.findings
                    : t.findings || [],
                verifications:
                  pipelineData.verifications &&
                  pipelineData.verifications.length > 0
                    ? pipelineData.verifications
                    : t.verifications || [],
                report: pipelineData.report || t.report,
                groundedness_score: pipelineData.groundedness_score || pipelineData.report?.groundedness_score || t.groundedness_score,
                total_tokens: pipelineData.total_tokens || pipelineData.report?.total_tokens || t.total_tokens,
                estimated_cost_usd: pipelineData.estimated_cost_usd || pipelineData.report?.estimated_cost_usd || t.estimated_cost_usd,
                is_chat: Boolean(
                  t.is_chat ||
                    pipelineData.is_chat ||
                    pipelineData.effort_level === "chat"
                ),
                isLive: true,
              };
            }
            return { ...t, isLive: false };
          });
        }
      } else {
        // Completed session: all turns finished
        turns = pipelineData.turns.map((t) => ({ ...t, isLive: false }));
      }
    } else {
      turns = [
        {
          query: pipelineData.query,
          effort_level: pipelineData.effort_level || effortLevel,
          plan: pipelineData.plan,
          findings: pipelineData.findings || [],
          verifications: pipelineData.verifications || [],
          report: pipelineData.report,
          groundedness_score: pipelineData.groundedness_score || pipelineData.report?.groundedness_score,
          total_tokens: pipelineData.total_tokens || pipelineData.report?.total_tokens,
          estimated_cost_usd: pipelineData.estimated_cost_usd || pipelineData.report?.estimated_cost_usd,
          is_chat: Boolean(
            pipelineData.is_chat ||
              pipelineData.effort_level === "chat" ||
              pipelineData.query?.toLowerCase()?.startsWith("/chat")
          ),
          isLive: loading,
        },
      ];
    }

    return turns.filter((t) => Boolean(t && (t.query || t.report)));
  }, [pipelineData, loading, effortLevel]);

  // Core SSE stream consumer with automatic Last-Event-ID reconnection
  const consumeSSEStream = async (
    url: string,
    method: "POST" | "GET",
    body?: any,
    targetSessionId?: string,
    retryCount: number = 0,
    lastKnownEventId?: number
  ) => {
    let currentAbortController: AbortController;
    if (retryCount === 0) {
      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch (_) {}
      }
      currentAbortController = new AbortController();
      abortControllerRef.current = currentAbortController;
      setLoading(true);
      setError(null);
      setLiveStatus("Connecting to autonomous agent cluster...");
    } else {
      currentAbortController =
        abortControllerRef.current || new AbortController();
    }

    const startTime = Date.now();
    let highestEventId = lastKnownEventId;

    try {
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const effectiveToken = getAuthToken() || token;
      if (effectiveToken) {
        authHeaders["Authorization"] = `Bearer ${effectiveToken}`;
      }
      if (highestEventId !== undefined) {
        authHeaders["Last-Event-ID"] = String(highestEventId);
      }

      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: currentAbortController.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg =
          errorData.error?.message ||
          errorData.message ||
          errorData.detail ||
          `Request failed (${res.status})`;
        throw new Error(msg);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      if (!reader) throw new Error("No stream reader available");

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const block of parts) {
          const trimmed = block.trim();
          if (!trimmed || trimmed.startsWith(":")) continue; // ignore keep-alive heartbeats

          let blockDataStr: string | null = null;
          for (const subLine of block.split("\n")) {
            if (subLine.startsWith("id: ")) {
              const eid = parseInt(subLine.replace("id: ", "").trim(), 10);
              if (!isNaN(eid)) {
                highestEventId = eid;
              }
            } else if (subLine.startsWith("data: ")) {
              blockDataStr = subLine.replace("data: ", "").trim();
            }
          }

          if (!blockDataStr) continue;

          try {
            const parsed = JSON.parse(blockDataStr);
            if (parsed.event_id && typeof parsed.event_id === "number") {
              highestEventId = parsed.event_id;
            }

            if (parsed.type === "reconnected") {
              setLiveStatus("⚡ Stream reconnected! Resuming intelligence collection...");
              continue;
            }

            if (parsed.type === "session_created") {
                const sId = parsed.id;
                setPipelineData((prev) => {
                  const existingTurns =
                    parsed.turns &&
                    Array.isArray(parsed.turns) &&
                    parsed.turns.length > 0
                      ? parsed.turns
                      : prev?.turns && prev?.id === sId
                      ? prev.turns
                      : prev?.turns || [];
                  return {
                    ...prev,
                    id: sId,
                    query: parsed.query || prev?.query || "",
                    effort_level:
                      parsed.effort_level || prev?.effort_level || "medium",
                    status: "running",
                    turns: existingTurns,
                    plan: null,
                    findings: [],
                    verifications: [],
                    report: null,
                  };
                });
                window.history.replaceState(null, "", `/?id=${sId}`);
                setHistory((prev) => {
                  const filtered = prev.filter((item) => item.id !== sId);
                  const prevItem = prev.find((item) => item.id === sId);
                  const sessionTitle =
                    prevItem && prevItem.query
                      ? prevItem.query
                      : parsed.turns && parsed.turns[0]?.query
                      ? parsed.turns[0].query
                      : parsed.query || "Research Session";
                  return [
                    {
                      id: sId,
                      query: sessionTitle,
                      effort_level: parsed.effort_level || "medium",
                      status: "running",
                      turns:
                        parsed.turns && parsed.turns.length > 0
                          ? parsed.turns
                          : prevItem?.turns || [],
                      created_at:
                        prevItem?.created_at || new Date().toISOString(),
                    },
                    ...filtered,
                  ];
                });
              } else if (parsed.type === "status") {
                const rawMsg = parsed.message || "";
                const lowerMsg = rawMsg.toLowerCase();
                if (
                  !lowerMsg.includes("redis") &&
                  !lowerMsg.includes("vector store") &&
                  !lowerMsg.includes("semantic vector") &&
                  !lowerMsg.includes("cache check") &&
                  !lowerMsg.includes("cluster in action")
                ) {
                  setLiveStatus(rawMsg);
                  setActivityLogs((prev) => [
                    ...prev.slice(-25),
                    {
                      id: Math.random().toString(),
                      time: new Date().toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }),
                      text: rawMsg,
                      action: "update",
                    },
                  ]);
                }
              } else if (parsed.type === "search_progress") {
                if (parsed.task_id && parsed.status) {
                  setTaskStatuses((prev) => ({
                    ...prev,
                    [parsed.task_id]: parsed.status,
                  }));
                  setActivityLogs((prev) => [
                    ...prev.slice(-25),
                    {
                      id: Math.random().toString(),
                      time: new Date().toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }),
                      text: parsed.status,
                      action: parsed.action || "search",
                      subtask: parsed.task_id,
                    },
                  ]);
                }
              } else if (parsed.type === "plan") {
                setPipelineData((prev) =>
                  prev ? { ...prev, plan: parsed.data } : prev
                );
                const numTasks = parsed.data?.sub_tasks?.length || 0;
                setActivityLogs((prev) => [
                  ...prev.slice(-25),
                  {
                    id: Math.random().toString(),
                    time: new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    }),
                    text: `Identified ${numTasks} research topics to investigate`,
                    action: "plan",
                  },
                ]);
              } else if (parsed.type === "finding") {
                setPipelineData((prev) => {
                  if (!prev) return prev;
                  const currentFindings = prev.findings || [];
                  const exists = currentFindings.some(
                    (f: any) => f.task_id === parsed.data.task_id
                  );
                  return {
                    ...prev,
                    findings: exists
                      ? currentFindings.map((f: any) =>
                          f.task_id === parsed.data.task_id ? parsed.data : f
                        )
                      : [...currentFindings, parsed.data],
                  };
                });
                const srcCount = parsed.data?.sources?.length || 0;
                setActivityLogs((prev) => [
                  ...prev.slice(-25),
                  {
                    id: Math.random().toString(),
                    time: new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    }),
                    text: `Extracted facts from ${srcCount} primary web sources`,
                    action: "finding",
                  },
                ]);
              } else if (parsed.type === "verifications") {
                setPipelineData((prev) =>
                  prev ? { ...prev, verifications: parsed.data } : prev
                );
                setActivityLogs((prev) => [
                  ...prev.slice(-25),
                  {
                    id: Math.random().toString(),
                    time: new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    }),
                    text: `Verified facts and source citations`,
                    action: "verify",
                  },
                ]);
              } else if (parsed.type === "chat_token") {
                setPipelineData((prev) =>
                  prev
                    ? {
                        ...prev,
                        report: {
                          ...prev.report,
                          markdown_content:
                            (prev.report?.markdown_content || "") +
                            parsed.token,
                          title:
                            prev.report?.title || "Conversational Response",
                          is_chat: true,
                        },
                      }
                    : prev
                );
              } else if (parsed.type === "chat_done") {
                const totalSecs = Math.max(
                  1,
                  Math.round((Date.now() - startTime) / 1000)
                );
                setDurationSeconds(totalSecs);
                const doneId = parsed.id || targetSessionId;
                if (parsed.turns) {
                  setPipelineData((prev) =>
                    prev
                      ? {
                          ...prev,
                          id: doneId || prev.id,
                          status: "completed",
                          duration_seconds: totalSecs,
                          turns: parsed.turns,
                          report: null,
                        }
                      : prev
                  );
                }
              } else if (parsed.type === "report_token") {
                setPipelineData((prev) =>
                  prev
                    ? {
                        ...prev,
                        report: {
                          ...prev.report,
                          markdown_content:
                            (prev.report?.markdown_content || "") +
                            parsed.token,
                          title:
                            prev.report?.title || "Synthesizing Report...",
                        },
                      }
                    : prev
                );
              } else if (parsed.type === "groundedness_score") {
                const score = parsed.score;
                setPipelineData((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    groundedness_score: score,
                    report: prev.report ? { ...prev.report, groundedness_score: score } : prev.report,
                  };
                });
                setActivityLogs((prev) => [
                  ...prev.slice(-25),
                  {
                    id: Math.random().toString(),
                    time: new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    }),
                    text: `Groundedness score verified at ${score}% (${parsed.supported_claims || 0}/${parsed.total_claims || 0} claims)`,
                    action: "verify",
                  },
                ]);
              } else if (parsed.type === "metrics") {
                const mdata = parsed.data || {};
                setPipelineData((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    total_tokens: mdata.total_tokens || prev.total_tokens,
                    prompt_tokens: mdata.prompt_tokens || prev.prompt_tokens,
                    completion_tokens: mdata.completion_tokens || prev.completion_tokens,
                    estimated_cost_usd: mdata.estimated_cost_usd || prev.estimated_cost_usd,
                    groundedness_score: mdata.groundedness_score || prev.groundedness_score,
                    report: prev.report ? {
                      ...prev.report,
                      total_tokens: mdata.total_tokens || prev.report.total_tokens,
                      prompt_tokens: mdata.prompt_tokens || prev.report.prompt_tokens,
                      completion_tokens: mdata.completion_tokens || prev.report.completion_tokens,
                      estimated_cost_usd: mdata.estimated_cost_usd || prev.report.estimated_cost_usd,
                      groundedness_score: mdata.groundedness_score || prev.report.groundedness_score,
                    } : prev.report,
                  };
                });
              } else if (parsed.type === "report") {
                setPipelineData((prev) =>
                  prev
                    ? {
                        ...prev,
                        report: { ...(prev.report || {}), ...parsed.data },
                        groundedness_score: parsed.data?.groundedness_score || prev.groundedness_score,
                        total_tokens: parsed.data?.total_tokens || prev.total_tokens,
                        estimated_cost_usd: parsed.data?.estimated_cost_usd || prev.estimated_cost_usd,
                      }
                    : prev
                );
              } else if (parsed.type === "related_questions") {
                setPipelineData((prev) =>
                  prev
                    ? {
                        ...prev,
                        report: {
                          ...(prev.report || {}),
                          related_questions: parsed.questions,
                        },
                      }
                    : prev
                );
              } else if (parsed.type === "clear_report") {
                setPipelineData((prev) =>
                  prev ? { ...prev, report: null } : prev
                );
              } else if (parsed.type === "cancelled") {
                setLiveStatus("Research was cancelled.");
                setLoading(false);
                setPipelineData((prev) =>
                  prev ? { ...prev, status: "cancelled" } : prev
                );
                return;
              } else if (parsed.type === "error") {
                const serverErrMsg =
                  parsed.message || "An unknown server error occurred.";
                console.error("SSE server error:", serverErrMsg);
                setError(serverErrMsg);
                setPipelineData((prev) =>
                  prev
                    ? {
                        ...prev,
                        status: "completed",
                        report: {
                          ...prev.report,
                          markdown_content:
                            prev.report?.markdown_content ||
                            `⚠️ **Research engine encountered an error:**\n\n> ${serverErrMsg}\n\nPlease try again in a moment.`,
                          title: prev.report?.title || "Error",
                          is_chat: true,
                        },
                      }
                    : prev
                );
                setLoading(false);
                return;
              } else if (parsed.type === "done") {
                const totalSecs = Math.max(
                  1,
                  Math.round((Date.now() - startTime) / 1000)
                );
                setDurationSeconds(totalSecs);
                const doneId = parsed.id || targetSessionId;
                setPipelineData((prev) => {
                  if (!prev) return prev;
                  const finalTurns =
                    parsed.turns &&
                    Array.isArray(parsed.turns) &&
                    parsed.turns.length > 0
                      ? parsed.turns
                      : prev.turns && prev.turns.length > 0
                      ? prev.turns
                      : [];
                  return {
                    ...prev,
                    id: doneId || prev.id,
                    status: "completed",
                    duration_seconds: totalSecs,
                    turns: finalTurns,
                    plan: null,
                    findings: [],
                    verifications: [],
                    report: null,
                  };
                });
                setHistory((prev) =>
                  prev.map((item) =>
                    item.id === doneId
                      ? { ...item, status: "completed" }
                      : item
                  )
                );
                if (parsed.id) {
                  window.history.replaceState(null, "", `/?id=${parsed.id}`);
                }
                setLoading(false);
                fetchHistory();
              }
            } catch (e) {
              console.error("Error parsing SSE chunk:", e);
            }
          }
        }
      } catch (err: any) {
      if (err.name === "AbortError" || currentAbortController.signal.aborted) {
        console.log("Research stream aborted.");
        return;
      }
      console.warn("Stream execution interrupted:", err);

      // Auto-reconnect with exponential backoff if session is running and within max retries
      const maxRetries = 3;
      const effectiveSessionId = targetSessionId || pipelineData?.id;
      if (effectiveSessionId && retryCount < maxRetries) {
        const nextRetry = retryCount + 1;
        const delayMs = Math.min(1200 * Math.pow(2, retryCount), 5000);
        setLiveStatus(
          `⚡ Connection interrupted. Reconnecting (attempt ${nextRetry}/${maxRetries})...`
        );

        await new Promise((res) => setTimeout(res, delayMs));

        if (currentAbortController.signal.aborted) return;

        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
        return consumeSSEStream(
          `${apiUrl}/api/research/stream/${effectiveSessionId}/subscribe`,
          "GET",
          undefined,
          effectiveSessionId,
          nextRetry,
          highestEventId
        );
      }

      const errMsg = (err.message || "Failed to start research.")
        .replace(/please sign in.*$/i, "")
        .trim();
      setError(errMsg);
    } finally {
      if (abortControllerRef.current === currentAbortController && !loading) {
        setLoading(false);
      }
    }
  };

  const handleCancelResearch = async () => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (_) {}
    }
    const currentSessionId = pipelineData?.id;
    if (currentSessionId) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      const effectiveToken = getAuthToken() || token;
      const headers: Record<string, string> = {};
      if (effectiveToken) headers["Authorization"] = `Bearer ${effectiveToken}`;
      try {
        fetch(`${apiUrl}/api/research/${currentSessionId}/cancel`, {
          method: "POST",
          headers,
        }).catch(() => {});
      } catch (_) {}
    }
    setLoading(false);
    setLiveStatus("Research stopped.");
    setPipelineData((prev) => {
      if (!prev) return prev;
      const currentTurns = prev.turns;
      const updatedTurns = Array.isArray(currentTurns)
        ? currentTurns.map((t, i) => {
            if (i === currentTurns.length - 1) {
              return { ...t, status: "cancelled", isLive: false };
            }
            return t;
          })
        : [];
      return {
        ...prev,
        status: "cancelled",
        turns: updatedTurns,
      };
    });
  };

  const handleStartNewSession = () => {
    const effectiveToken = getAuthToken();
    const oldSessionId = pipelineData?.id;
    if (!effectiveToken && oldSessionId) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      try {
        fetch(`${apiUrl}/api/research/history/${oldSessionId}`, {
          method: "DELETE",
        }).catch(() => {});
      } catch (_) {}
    }

    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (_) {}
    }
    setLoading(false);
    window.history.pushState(null, "", "/");
    setActiveTab("new");
    setPipelineData(null);
    setQuery("");
    setError(null);
    setEffortLevel("chat");
    fetchLLMSuggestions();
  };

  const handleSelectSession = (sessionItem: HistoryItem) => {
    if (!sessionItem || !sessionItem.id) return;

    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (_) {}
    }

    window.history.pushState(null, "", `/?id=${sessionItem.id}`);
    setPipelineData(sessionItem as any);
    setActiveTab("current");
    setQuery("");
    setError(null);
    setLoading(sessionItem.status === "running");

    fetchSessionById(sessionItem.id);
  };

  const fetchSessionById = async (id: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      const effectiveToken = getAuthToken();
      const headers: Record<string, string> = {};
      if (effectiveToken) headers["Authorization"] = `Bearer ${effectiveToken}`;
      const res = await fetch(`${apiUrl}/api/research/history/${id}`, {
        cache: "no-store",
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          const session = data.session;
          setPipelineData(session);
          setActiveTab("current");

          if (session.status === "running") {
            setLoading(true);
            consumeSSEStream(
              `${apiUrl}/api/research/stream/${id}/subscribe`,
              "GET",
              undefined,
              id
            );
          } else {
            setLoading(false);
          }
          return true;
        }
      }
    } catch (err) {
      console.error("Failed to fetch session by id:", err);
    }
    return false;
  };

  const fetchHistory = async () => {
    try {
      const effectiveToken = getAuthToken();
      if (!effectiveToken) {
        setHistory([]);
        return [];
      }
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${effectiveToken}`,
      };
      const res = await fetch(`${apiUrl}/api/research/history`, {
        cache: "no-store",
        headers,
      });
      const data = await res.json();
      const list = data.history || [];
      setHistory(list);
      return list;
    } catch (err) {
      console.error("Failed to fetch history", err);
      return [];
    }
  };

  const fetchLLMSuggestions = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      const res = await fetch(`${apiUrl}/api/research/suggestions`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (
          data.suggestions &&
          Array.isArray(data.suggestions) &&
          data.suggestions.length > 0
        ) {
          setSuggestions(data.suggestions);
          try {
            sessionStorage.setItem(
              "dr_suggestions",
              JSON.stringify(data.suggestions)
            );
          } catch (_) {}
        }
      }
    } catch (err) {
      console.debug("Dynamic suggestions fetch notice:", err);
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(false);

    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (_) {}
    }

    window.history.pushState(null, "", "/");
    setActiveTab("new");
    setPipelineData(null);
    setHistory([]);
    setQuery("");
    setError(null);
    setLoading(false);
    setDurationSeconds(null);
    setElapsedSeconds(0);

    logout();
    fetchLLMSuggestions();
  };

  // Cache session in sessionStorage for fast recovery
  useEffect(() => {
    if (pipelineData && pipelineData.id && typeof window !== "undefined") {
      try {
        sessionStorage.setItem(
          `dr_session_${pipelineData.id}`,
          JSON.stringify(pipelineData)
        );
      } catch (_) {}
    }
  }, [pipelineData]);

  useEffect(() => {
    fetchHistory();
  }, [token]);

  useEffect(() => {
    const initApp = async () => {
      setMounted(true);
      const params = new URLSearchParams(window.location.search);
      const targetId = params.get("id") || params.get("session_id");

      let hasInstantCache = false;

      if (targetId && typeof window !== "undefined") {
        try {
          const cached = sessionStorage.getItem(`dr_session_${targetId}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.id === targetId) {
              setPipelineData(parsed);
              setActiveTab("current");
              setLoading(parsed.status === "running");
              hasInstantCache = true;
            }
          }
        } catch (_) {}
      }

      const effectiveToken = getAuthToken();

      if (effectiveToken) {
        fetchHistory().catch(() => {});
      }
      fetchLLMSuggestions().catch(() => {});

      if (targetId) {
        if (!hasInstantCache) {
          setIsRestoringSession(true);
        }
        try {
          const success = await fetchSessionById(targetId);
          if (!success && !hasInstantCache) {
            const hist = await fetchHistory();
            const found = hist.find((item: any) => item.id === targetId);
            if (found) {
              setPipelineData(found as any);
              setActiveTab("current");
              if (found.status === "running") {
                const apiUrl =
                  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
                consumeSSEStream(
                  `${apiUrl}/api/research/stream/${targetId}/subscribe`,
                  "GET",
                  undefined,
                  targetId
                );
              }
            }
          }
        } finally {
          setIsRestoringSession(false);
        }
      } else {
        setIsRestoringSession(false);
      }

      if (!effectiveToken && !token) {
        const authParam = params.get("auth");
        if (authParam === "signup") {
          setAuthModalMode("signup");
          setAuthModalOpen(true);
        } else if (authParam === "signin" || authParam === "login") {
          setAuthModalMode("signin");
          setAuthModalOpen(true);
        }
      } else {
        setAuthModalOpen(false);
        if (params.has("auth")) {
          params.delete("auth");
          const newUrl = `${window.location.pathname}${
            params.toString() ? `?${params.toString()}` : ""
          }`;
          window.history.replaceState(null, "", newUrl);
        }
      }
    };

    initApp();

    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const targetId = params.get("id") || params.get("session_id");
      if (targetId) {
        fetchSessionById(targetId);
      } else {
        setPipelineData(null);
        setActiveTab("new");
      }

      const currentToken = getAuthToken();
      if (!currentToken && !token) {
        const authParam = params.get("auth");
        if (authParam === "signup") {
          setAuthModalMode("signup");
          setAuthModalOpen(true);
        } else if (authParam === "signin" || authParam === "login") {
          setAuthModalMode("signin");
          setAuthModalOpen(true);
        } else {
          setAuthModalOpen(false);
        }
      } else {
        setAuthModalOpen(false);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [token]);

  const handleDeleteSession = async (id: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      const effectiveToken = getAuthToken();
      const headers: Record<string, string> = {};
      if (effectiveToken) headers["Authorization"] = `Bearer ${effectiveToken}`;
      await fetch(`${apiUrl}/api/research/history/${id}`, {
        method: "DELETE",
        headers,
      });
      fetchHistory();
      if (pipelineData?.id === id) {
        window.history.pushState(null, "", "/");
        setPipelineData(null);
        setQuery("");
        setActiveTab("new");
      }
    } catch (err) {
      console.error("Failed to delete", err);
    }
  };

  const executeSearch = async (targetQuery: string, targetEffort: string) => {
    const rawTrimmed = targetQuery.trim();
    if (!rawTrimmed || loading) return;

    let finalEffort = targetEffort;
    let isChatMode = targetEffort === "chat";
    let cleanQuery = rawTrimmed;

    const lower = rawTrimmed.toLowerCase();

    // Check slash commands without a question
    if (lower === "/chat" || lower === "/ask" || lower === "/c") {
      setEffortLevel("chat");
      setQuery("");
      return;
    } else if (
      lower === "/quick" ||
      lower === "/low" ||
      lower === "/fast" ||
      lower === "/q"
    ) {
      setEffortLevel("low");
      setQuery("");
      return;
    } else if (
      lower === "/deep" ||
      lower === "/medium" ||
      lower === "/think" ||
      lower === "/d"
    ) {
      setEffortLevel("medium");
      setQuery("");
      return;
    } else if (
      lower === "/pro" ||
      lower === "/high" ||
      lower === "/exhaustive" ||
      lower === "/p"
    ) {
      setEffortLevel("high");
      setQuery("");
      return;
    }

    // Check inline slash commands with questions
    if (
      lower.startsWith("/quick ") ||
      lower.startsWith("/low ") ||
      lower.startsWith("/fast ") ||
      lower.startsWith("/q ")
    ) {
      finalEffort = "low";
      isChatMode = false;
      cleanQuery = rawTrimmed.replace(/^\/(quick|low|fast|q)\s+/i, "").trim();
    } else if (
      lower.startsWith("/deep ") ||
      lower.startsWith("/medium ") ||
      lower.startsWith("/think ") ||
      lower.startsWith("/d ")
    ) {
      finalEffort = "medium";
      isChatMode = false;
      cleanQuery = rawTrimmed.replace(/^\/(deep|medium|think|d)\s+/i, "").trim();
    } else if (
      lower.startsWith("/pro ") ||
      lower.startsWith("/high ") ||
      lower.startsWith("/exhaustive ") ||
      lower.startsWith("/p ")
    ) {
      finalEffort = "high";
      isChatMode = false;
      cleanQuery = rawTrimmed.replace(/^\/(pro|high|exhaustive|p)\s+/i, "").trim();
    } else if (
      lower.startsWith("/chat ") ||
      lower.startsWith("/ask ") ||
      lower.startsWith("/c ")
    ) {
      finalEffort = "chat";
      isChatMode = true;
      cleanQuery = rawTrimmed.replace(/^\/(chat|ask|c)\s+/i, "").trim();
    }

    if (!cleanQuery) {
      if (isChatMode) setEffortLevel("chat");
      else setEffortLevel(finalEffort);
      setQuery("");
      return;
    }

    setLoading(true);
    setError(null);
    setTaskStatuses({});
    setShowAllSources(false);
    setElapsedSeconds(0);
    setDurationSeconds(null);
    setActivityLogs([
      {
        id: "init",
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        text: isChatMode
          ? "Connecting to chat engine..."
          : "Starting web research...",
        action: "search",
      },
    ]);

    const activeSessionId = pipelineData?.id || null;
    const provisionalId =
      activeSessionId ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `sess_${Date.now()}`);

    let existingTurns: Turn[] = [];
    if (
      pipelineData?.turns &&
      Array.isArray(pipelineData.turns) &&
      pipelineData.turns.length > 0
    ) {
      existingTurns = [...pipelineData.turns];
    } else if (pipelineData?.report && pipelineData?.query) {
      existingTurns = [
        {
          query: pipelineData.query,
          effort_level: pipelineData.effort_level || "medium",
          plan: pipelineData.plan,
          findings: pipelineData.findings,
          verifications: pipelineData.verifications,
          report: pipelineData.report,
          is_chat: pipelineData.is_chat || false,
        },
      ];
    }

    setPipelineData({
      id: provisionalId,
      query: cleanQuery,
      findings: [],
      searchProgress: [],
      report: null,
      status: "running",
      turns: existingTurns,
      is_chat: isChatMode,
      effort_level: isChatMode ? "chat" : finalEffort,
    });

    window.history.pushState(null, "", `/?id=${provisionalId}`);

    setHistory((prev) => {
      const filtered = prev.filter((item) => item.id !== provisionalId);
      const existingSession = prev.find((item) => item.id === provisionalId);
      const sessionTitle =
        existingSession?.query ||
        (existingTurns.length > 0
          ? existingTurns[0]?.query || cleanQuery
          : cleanQuery);
      return [
        {
          id: provisionalId,
          query: sessionTitle,
          effort_level: isChatMode ? "chat" : finalEffort,
          status: "running",
          turns: existingTurns,
          created_at: existingSession?.created_at || new Date().toISOString(),
        },
        ...filtered,
      ];
    });

    setQuery("");
    setActiveTab("current");
    setLiveStatus(
      isChatMode
        ? "⚡ Connecting to Fast Chat Engine..."
        : "Initializing autonomous agent cluster..."
    );

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
    await consumeSSEStream(
      `${apiUrl}/api/research/stream`,
      "POST",
      {
        query: cleanQuery,
        effort_level: isChatMode ? "chat" : finalEffort,
        mode: isChatMode ? "chat" : "research",
        previous_session_id: activeSessionId,
        session_id: provisionalId,
      },
      provisionalId
    );
  };

  const handleRunPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;
    executeSearch(query, effortLevel);
  };

  if (!mounted) {
    return (
      <div className="flex h-screen bg-[#1e2020] text-zinc-200 overflow-hidden font-sans">
        <aside className="w-64 bg-[#1a1c1c] border-r border-zinc-800/80 flex flex-col justify-between hidden md:flex shrink-0" />
        <main className="flex-1 flex flex-col h-screen overflow-y-auto relative items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#1e2020] text-zinc-200 overflow-hidden font-sans">
      {/* Extracted Modular Sidebar */}
      <Sidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        workspaces={workspaces}
        activeTenant={activeTenant}
        switchWorkspace={switchWorkspace}
        user={user}
        isAuthenticated={Boolean(token || getAuthToken())}
        history={history}
        activeSessionId={pipelineData?.id}
        activeTab={activeTab}
        onSelectSession={handleSelectSession}
        onDeleteSessionPrompt={(id) => setSessionToDelete(id)}
        onStartNewSession={handleStartNewSession}
        onOpenSearchModal={() => setSearchModalOpen(true)}
        onOpenAuthModal={(mode) => openAuthModal(mode)}
        onOpenLogoutModal={() => setShowLogoutModal(true)}
        fetchHistory={fetchHistory}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Guest Research Limit Reached Modal */}
        <LimitReachedModal
          isOpen={Boolean(
            error &&
              (error.toLowerCase().includes("guest") ||
                error.toLowerCase().includes("limit reached"))
          )}
          onClose={() => setError(null)}
          onOpenAuthModal={(mode) => openAuthModal(mode)}
        />

        {/* Floating Notification Toast (Bottom Right for non-guest errors) */}
        <AnimatePresence>
          {error &&
            !(
              error.toLowerCase().includes("guest") ||
              error.toLowerCase().includes("limit reached")
            ) && (
              <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="fixed bottom-6 right-6 z-50 max-w-sm sm:max-w-md pointer-events-auto"
              >
                <div className="bg-[#1c1e1e]/95 border border-zinc-700/90 text-zinc-200 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)] shrink-0" />
                    <span className="text-xs sm:text-[13px] font-medium text-zinc-200 leading-snug">
                      {error.replace(/please sign in.*$/i, "").trim()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
        </AnimatePresence>

        {/* Restoring session loader */}
        {isRestoringSession && !pipelineData && (
          <div className="flex-1 flex flex-col justify-center items-center py-28 space-y-4 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <div className="text-zinc-300 font-medium text-sm">
              Restoring research session...
            </div>
            <p className="text-xs text-zinc-500">
              Retrieving intelligence dossier and citations from storage.
            </p>
          </div>
        )}

        {/* Extracted Landing Hero Input View */}
        {!isRestoringSession && !pipelineData && (
          <LandingInput
            query={query}
            setQuery={setQuery}
            loading={loading}
            effortLevel={effortLevel}
            setEffortLevel={setEffortLevel}
            onSubmit={handleRunPipeline}
            onExecuteSearch={executeSearch}
            onCancel={handleCancelResearch}
            suggestions={suggestions}
            filteredSlashCommands={filteredSlashCommands}
            slashSelectedIndex={slashSelectedIndex}
            setSlashSelectedIndex={setSlashSelectedIndex}
            thinkingMenuOpen={thinkingMenuOpen}
            setThinkingMenuOpen={setThinkingMenuOpen}
          />
        )}

        {/* Live Multi-Turn Research / Chat Dossier View */}
        {pipelineData && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div
              ref={contentScrollRef}
              className="flex-1 overflow-y-auto custom-scrollbar"
            >
              <div className="mx-auto w-full max-w-[1600px] 2xl:max-w-[1720px] px-4 sm:px-6 lg:px-8 xl:px-10 pt-4 pb-12 space-y-12">
                {turnsToRender.map((turn, turnIdx) => {
                  const isLatest = turnIdx === turnsToRender.length - 1;
                  const isTurnLoading = Boolean(turn.isLive && loading);

                  return (
                    <div
                      key={turnIdx}
                      className="space-y-4 pt-6 border-t border-zinc-800/80 first:border-t-0 first:pt-0"
                    >
                      {/* Header Title */}
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 pb-0.5">
                        <div className="flex items-start gap-3 flex-1 min-w-0 max-w-4xl">
                          <h1 className="font-manrope text-lg sm:text-xl md:text-2xl font-bold text-white leading-snug tracking-tight break-words">
                            {turn.query}
                          </h1>
                        </div>
                      </div>

                      {/* Render Chat Turn vs Deep Dossier Turn */}
                      {Boolean(turn.is_chat || turn.effort_level === "chat") ? (
                        <ChatTurnView
                          turn={turn}
                          turnIdx={turnIdx}
                          isTurnLoading={isTurnLoading}
                          liveStatus={liveStatus}
                          copied={copied}
                          isExportingPDF={isExportingPDF}
                          onCopyMarkdown={(t) =>
                            handleCopyTurnMarkdown(t, setCopied)
                          }
                          onDownloadMarkdown={handleDownloadTurnMarkdown}
                          onDownloadPDF={(t, idx) =>
                            handleDownloadTurnPDF(t, idx, setIsExportingPDF, pipelineData?.id)
                          }
                        />
                      ) : (
                        <DossierView
                          turn={turn}
                          turnIdx={turnIdx}
                          isTurnLoading={isTurnLoading}
                          isLatest={isLatest}
                          liveStatus={liveStatus}
                          copied={copied}
                          isExportingPDF={isExportingPDF}
                          showAllSources={showAllSources}
                          setShowAllSources={setShowAllSources}
                          taskStatuses={taskStatuses}
                          activityLogs={activityLogs}
                          durationSeconds={durationSeconds || undefined}
                          effortLevel={turn.effort_level || effortLevel}
                          onCopyMarkdown={(t) =>
                            handleCopyTurnMarkdown(t, setCopied)
                          }
                          onDownloadMarkdown={handleDownloadTurnMarkdown}
                          onDownloadPDF={(t, idx) =>
                            handleDownloadTurnPDF(t, idx, setIsExportingPDF, pipelineData?.id)
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Extracted Sticky Bottom Follow-up Dock */}
            <StickyDock
              query={query}
              setQuery={setQuery}
              loading={loading}
              effortLevel={effortLevel}
              setEffortLevel={setEffortLevel}
              onSubmit={handleRunPipeline}
              onExecuteSearch={executeSearch}
              onCancel={handleCancelResearch}
              filteredSlashCommands={filteredSlashCommands}
              slashSelectedIndex={slashSelectedIndex}
              setSlashSelectedIndex={setSlashSelectedIndex}
              stickyThinkingMenuOpen={stickyThinkingMenuOpen}
              setStickyThinkingMenuOpen={setStickyThinkingMenuOpen}
              pipelineData={pipelineData}
            />
          </div>
        )}
      </main>

      {/* Extracted Confirmation Modals */}
      <LogoutModal
        isOpen={showLogoutModal}
        user={user}
        onClose={() => setShowLogoutModal(false)}
        onLogout={handleLogout}
      />

      <DeleteChatModal
        sessionId={sessionToDelete}
        onClose={() => setSessionToDelete(null)}
        onConfirmDelete={(id) => {
          handleDeleteSession(id);
          setSessionToDelete(null);
        }}
      />

      <SearchModal
        isOpen={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        history={history}
        currentSessionId={pipelineData?.id}
        activeTab={activeTab}
        onSelectSession={handleSelectSession}
        isAuthenticated={Boolean(token || getAuthToken())}
      />

      {/* Enterprise Authentication Modal */}
      <AuthModal
        isOpen={authModalOpen && !token && !getAuthToken()}
        initialMode={authModalMode}
        onClose={closeAuthModal}
      />
    </div>
  );
}
