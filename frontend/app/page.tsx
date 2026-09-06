"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, History, Loader2, CheckCircle2, ChevronRight, FileText,
  Globe, Sparkles, ShieldCheck, BrainCircuit, ExternalLink, Trash2,
  XCircle, Copy, Check, Download, Printer, Clock, ArrowUpRight, HelpCircle, Compass, Zap, Square, Plus,
  MessageSquare, X, User as UserIcon, LogOut, ChevronDown, Building2, Shield, UserCheck, Layers, Cpu
} from "lucide-react";
import { useAuth } from "./context/AuthContext";
import AuthModal from "./components/AuthModal";

function SidebarToggleIcon({ className = "w-5 h-5" }: { className?: string }) {
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

function SquarePenIcon({ className = "w-5 h-5" }: { className?: string }) {
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

const DEFAULT_SUGGESTIONS = [
  {
    label: "LLM Reasoning Architectures",
    q: "Compare test-time compute scaling vs post-training RL in frontier reasoning models like DeepSeek R1 and OpenAI o3",
    effort: "high"
  },
  {
    label: "Fusion Energy Commercialization",
    q: "Assess net energy gain milestones and magnet breakthroughs in commercial tokamak fusion startups",
    effort: "medium"
  },
  {
    label: "Quantum Error Correction",
    q: "Analyze recent neutral-atom and superconducting qubit error correction thresholds for fault-tolerant quantum computing",
    effort: "high"
  },
  {
    label: "Solid-State Battery Economics",
    q: "Evaluate silicon-anode and sulfide solid-state battery energy density, manufacturing yield, and EV cost parity",
    effort: "medium"
  }
];

function transformCitationsInMarkdown(content: string, sources: any[] = []): string {
  if (!content) return "";

  // Step 1: Expand grouped brackets like [1, 2], [1, 2, 3], or [1,3,5] into tightly clustered [1][2][3]
  let transformed = content.replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (match, group) => {
    const numbers = group.split(",").map((s: string) => s.trim()).filter(Boolean);
    return numbers.map((n: string) => `[${n}]`).join("");
  });

  // Step 2: Expand range citations like [1-3] or [1–3] into [1][2][3]
  transformed = transformed.replace(/\[(\d+)\s*[-–—]\s*(\d+)\]/g, (match, startStr, endStr) => {
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!isNaN(start) && !isNaN(end) && end > start && end - start <= 10) {
      const items = [];
      for (let i = start; i <= end; i++) {
        items.push(`[${i}]`);
      }
      return items.join("");
    }
    return match;
  });

  // Step 3: Collapse comma-separated citations like [1], [2] or [1], [3] into tight consecutive [1][2] / [1][3]
  transformed = transformed.replace(/(\[\d+\])\s*,\s*(?=\[\d+\])/g, "$1");

  // Step 4: Convert any standalone [N] into a markdown link [N](url)
  transformed = transformed.replace(/(?<![!\[])\[(\d+)\](?!\()/g, (match, numStr) => {
    const idx = parseInt(numStr, 10);
    const matchedSource = sources && sources[idx - 1];
    const targetUrl = matchedSource?.url || (sources && sources.length >= idx ? sources[idx - 1]?.url : "") || `#citation-${idx}`;
    return `[${numStr}](${targetUrl})`;
  });

  return transformed;
}

function CitationBadge({ index, href, source }: { index: number; href?: string; source?: any }) {
  const [hovered, setHovered] = useState(false);
  let domain = "";
  let favicon = "";
  const targetUrl = href && href.startsWith("http") ? href : (source?.url || "");
  if (targetUrl) {
    try {
      domain = new URL(targetUrl).hostname.replace("www.", "");
      favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch (e) { }
  }

  const handleClick = (e: React.MouseEvent) => {
    if (targetUrl) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <span
      className="relative inline-block mx-[1px] align-baseline select-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={handleClick}
        title={source?.title || domain || `Source [${index}]`}
        className="inline-flex items-center justify-center text-[10.5px] font-mono font-semibold text-zinc-300 hover:text-white bg-[#252828] hover:bg-[#323636] border border-zinc-700/80 hover:border-zinc-500 px-1 py-0.2 rounded transition-all hover:scale-105 active:scale-95 no-underline shadow-sm cursor-pointer"
      >
        [{index}]
      </button>
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-[#1e2020] border border-zinc-700/90 rounded-xl shadow-2xl z-50 text-left pointer-events-auto backdrop-blur-md"
          >
            <div className="flex items-center gap-2 mb-1.5">
              {favicon ? (
                <img src={favicon} alt="" className="w-3.5 h-3.5 object-contain rounded" />
              ) : (
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
              )}
              <span className="text-[11px] font-semibold text-zinc-300 truncate">{domain || `Source [${index}]`}</span>
              <span className="ml-auto text-[9px] font-mono text-cyan-400 bg-cyan-950/60 px-1 py-0.5 rounded border border-cyan-800/40">Verified</span>
            </div>
            <div className="text-xs font-medium text-zinc-100 line-clamp-2 leading-snug mb-2">
              {source?.title || domain || `Verified Research Reference [${index}]`}
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800 text-[10px] text-cyan-400">
              <span className="truncate max-w-[170px] text-zinc-400">{targetUrl || `Source [${index}]`}</span>
              <ArrowUpRight className="w-3 h-3 shrink-0" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

function stripLeadingQueryTitle(markdown: string): string {
  if (!markdown) return "";
  const trimmed = markdown.trim();
  // Strip redundant leading # Question heading from on-screen display
  if (trimmed.startsWith("# ")) {
    const firstLineEnd = trimmed.indexOf("\n");
    if (firstLineEnd !== -1) {
      return trimmed.slice(firstLineEnd).trim();
    }
    return "";
  }
  return trimmed;
}

function TableOfContents({ markdown }: { markdown: string }) {
  if (!markdown) return null;
  const lines = markdown.split("\n");
  const headings: { id: string; text: string; level: number }[] = [];

  lines.forEach((line) => {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim().replace(/[*_`]/g, "");
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      headings.push({ id, text, level });
    }
  });

  if (headings.length < 2) return null;

  return (
    <div className="mb-6 p-3.5 rounded-xl bg-[#161818] border border-zinc-800/80 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-1.5">
        <Compass className="w-3.5 h-3.5 text-cyan-400" />
        <span>Table of Contents</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {headings.map((h, i) => (
          <a
            key={i}
            href={`#${h.id}`}
            className="text-xs font-normal px-2.5 py-1 rounded-lg bg-[#222525] hover:bg-[#2c2f2f] border border-zinc-700/60 hover:border-zinc-600 text-zinc-300 hover:text-white transition-all shadow-sm flex items-center gap-1.5"
          >
            {h.level === 3 && <span className="text-[9px] text-zinc-500">•</span>}
            <span>{h.text}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function AgentPipelineStepper({ status, plan, findings, verifications, isComplete, effortLevel = "medium" }: any) {
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
    const isSynthesizing = s.includes("synthesiz") || s.includes("writing") || s.includes("dossier") || s.includes("generating report");

    if (level === "low") {
      // 0: Planner, 1: Researchers, 2: Dossier Writer
      if (isSynthesizing || (hasFindings && s.includes("report"))) return 2;
      if (hasPlan || s.includes("crawling") || s.includes("scraping") || s.includes("reading source")) return 1;
      return 0;
    }

    if (level === "high") {
      // 0: Planner, 1: Researchers, 2: Gap Auditor, 3: Fact Verifier, 4: Critic Agent, 5: Dossier Writer
      if (isSynthesizing || s.includes("dossier synthesis")) return 5;
      if (s.includes("critic") || s.includes("quality assurance") || s.includes("evaluating")) return 4;
      if (hasVerifications || s.includes("verif") || s.includes("entailment")) return 3;
      if (s.includes("gap") || s.includes("depth-2") || s.includes("auditing")) return 2;
      if (hasPlan || s.includes("crawling") || s.includes("scraping") || s.includes("reading source")) return 1;
      return 0;
    }

    // Medium (Default): 0: Planner, 1: Researchers, 2: Fact Verifier, 3: Dossier Writer
    if (isSynthesizing || (hasFindings && hasVerifications && (s.includes("report") || s.includes("synthesiz")))) return 3;
    if (hasVerifications || (hasFindings && (s.includes("verif") || s.includes("audit")))) return 2;
    if (hasPlan || s.includes("crawling") || s.includes("scraping") || s.includes("reading source")) return 1;
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
          <BrainCircuit className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          Autonomous Agent Execution Graph
        </span>
      </div>
      <div className={`grid ${gridColsClass} gap-2 relative`}>
        {steps.map((step, idx) => {
          const isDone = isComplete || idx < activeStep;
          const isCurrent = !isComplete && idx === activeStep;

          return (
            <div
              key={step.id}
              className={`flex flex-col items-center text-center p-2.5 rounded-xl border transition-all ${isCurrent
                  ? "bg-cyan-950/40 border-cyan-500/50 text-cyan-300 shadow-md shadow-cyan-500/10 scale-102"
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

export default function Home() {
  const { user, token, activeTenant, workspaces, usage, logout, switchWorkspace, refreshUsage } = useAuth();

  const getAuthToken = () => {
    if (token) return token;
    if (typeof window !== "undefined") {
      return localStorage.getItem("dr_access_token") || localStorage.getItem("token") || null;
    }
    return null;
  };
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signin');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [modalSearchQuery, setModalSearchQuery] = useState("");
  const modalInputRef = useRef<HTMLInputElement | null>(null);

  const openAuthModal = (mode: 'signin' | 'signup' = 'signin') => {
    if (token || getAuthToken()) return;
    setAuthModalMode(mode);
    setAuthModalOpen(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('auth', mode);
      window.history.pushState(null, '', url.toString());
    } catch {
      // Ignore URL manipulation error
    }
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('auth')) {
        url.searchParams.delete('auth');
        window.history.replaceState(null, '', url.toString());
      }
    } catch {
      // Ignore URL manipulation error
    }
  };

  // Ensure auth modal is immediately dismissed and ?auth URL param is cleared when authenticated
  useEffect(() => {
    if (token || getAuthToken()) {
      setAuthModalOpen(false);
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('auth')) {
          url.searchParams.delete('auth');
          window.history.replaceState(null, '', url.toString());
        }
      } catch (_) {}
    }
  }, [token]);

  const [query, setQuery] = useState("");
  const [effortLevel, setEffortLevel] = useState("chat");
  const [pipelineData, setPipelineData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [activeTab, setActiveTab] = useState("new");
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [taskStatuses, setTaskStatuses] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [mainInputFocused, setMainInputFocused] = useState(false);
  const [stickyInputFocused, setStickyInputFocused] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [stickyThinkingMenuOpen, setStickyThinkingMenuOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const SLASH_COMMANDS = [
    {
      id: "quick",
      command: "/quick",
      aliases: ["/low", "/fast", "/q"],
      name: "Quick Scan",
      badge: "Quick",
      desc: "Rapid preliminary overview & multi-source scan",
      effort: "low",
      mode: "research"
    },
    {
      id: "deep",
      command: "/deep",
      aliases: ["/medium", "/think", "/d"],
      name: "Deep Research",
      badge: "Standard",
      desc: "Comprehensive multi-step analysis & citation verification",
      effort: "medium",
      mode: "research"
    },
    {
      id: "pro",
      command: "/pro",
      aliases: ["/high", "/exhaustive", "/p"],
      name: "Exhaustive Dossier",
      badge: "Exhaustive",
      desc: "Deep recursive search & multi-perspective verification",
      effort: "high",
      mode: "research"
    },
    {
      id: "chat",
      command: "/chat",
      aliases: ["/ask", "/c"],
      name: "Fast Chat",
      badge: "Conversational",
      desc: "Converse directly with research dossier context",
      effort: "chat",
      mode: "chat"
    }
  ];

  const filteredSlashCommands = useMemo(() => {
    if (!query.startsWith("/") || query.includes(" ")) return [];
    const search = query.trim().toLowerCase();
    if (search === "/") return SLASH_COMMANDS;
    const searchClean = search.slice(1);
    if (!searchClean) return SLASH_COMMANDS;

    const matched = SLASH_COMMANDS.filter((cmd) => {
      if (cmd.command.toLowerCase().startsWith(search)) return true;
      if (cmd.aliases.some((a) => a.toLowerCase().startsWith(search) || a.replace("/", "").toLowerCase().startsWith(searchClean))) return true;
      if (cmd.id.toLowerCase().startsWith(searchClean)) return true;
      if (cmd.name.toLowerCase().startsWith(searchClean)) return true;
      if (cmd.command.toLowerCase().includes(searchClean)) return true;
      if (cmd.name.toLowerCase().includes(searchClean)) return true;
      return false;
    });

    // Sort so exact command/alias prefix matches always rank first (e.g. /c ranks /chat first, not /quick)
    return matched.sort((a, b) => {
      const aStartsCmd = a.command.toLowerCase().startsWith(search);
      const bStartsCmd = b.command.toLowerCase().startsWith(search);
      if (aStartsCmd && !bStartsCmd) return -1;
      if (!aStartsCmd && bStartsCmd) return 1;

      const aStartsAlias = a.aliases.some((al) => al.toLowerCase().startsWith(search) || al.replace("/", "").toLowerCase().startsWith(searchClean));
      const bStartsAlias = b.aliases.some((al) => al.toLowerCase().startsWith(search) || al.replace("/", "").toLowerCase().startsWith(searchClean));
      if (aStartsAlias && !bStartsAlias) return -1;
      if (!aStartsAlias && bStartsAlias) return 1;

      const aStartsName = a.name.toLowerCase().startsWith(searchClean) || a.id.toLowerCase().startsWith(searchClean);
      const bStartsName = b.name.toLowerCase().startsWith(searchClean) || b.id.toLowerCase().startsWith(searchClean);
      if (aStartsName && !bStartsName) return -1;
      if (!aStartsName && bStartsName) return 1;

      return 0;
    });
  }, [query]);

  // Always reset highlighted slash command index when typing changes
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

  // Auto-focus search input when modal opens
  useEffect(() => {
    if (searchModalOpen) {
      setTimeout(() => modalInputRef.current?.focus(), 60);
    } else {
      setModalSearchQuery("");
    }
  }, [searchModalOpen]);

  // Auto-dismiss transient error notifications after 6 seconds (keep guest limit modal visible until user acts)
  useEffect(() => {
    if (error) {
      const isLimit = error.toLowerCase().includes("guest") || error.toLowerCase().includes("limit reached");
      if (isLimit) return;
      const timer = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const modalFilteredHistory = useMemo(() => {
    if (!token && !getAuthToken()) return [];
    if (!modalSearchQuery.trim()) return history;
    const q = modalSearchQuery.toLowerCase().trim();
    const searchWords = q.split(/\s+/).filter(Boolean);

    return history.filter((item: any) => {
      const mainQuery = (item.query || "").toLowerCase();
      if (searchWords.every((w) => mainQuery.includes(w))) return true;

      if (item.turns && Array.isArray(item.turns)) {
        for (const turn of item.turns) {
          const turnQuery = (turn.query || "").toLowerCase();
          if (searchWords.every((w) => turnQuery.includes(w))) return true;

          const reportContent = (
            turn.report?.markdown_content ||
            turn.report?.summary ||
            ""
          ).toLowerCase();
          if (searchWords.every((w) => reportContent.includes(w))) return true;
        }
      }

      const topReport = (
        item.report?.markdown_content ||
        item.report?.summary ||
        ""
      ).toLowerCase();
      if (searchWords.every((w) => topReport.includes(w))) return true;

      return false;
    });
  }, [history, modalSearchQuery]);

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const q = historySearch.toLowerCase().trim();
    const searchWords = q.split(/\s+/).filter(Boolean);

    return history.filter((item: any) => {
      // Match against main session query
      const mainQuery = (item.query || "").toLowerCase();
      if (searchWords.every((w) => mainQuery.includes(w))) return true;

      // Match against all turns, follow-up questions, and generated reports
      if (item.turns && Array.isArray(item.turns)) {
        for (const turn of item.turns) {
          const turnQuery = (turn.query || "").toLowerCase();
          if (searchWords.every((w) => turnQuery.includes(w))) return true;

          const reportContent = (
            turn.report?.markdown_content ||
            turn.report?.summary ||
            ""
          ).toLowerCase();
          if (searchWords.every((w) => reportContent.includes(w))) return true;
        }
      }

      // Match against top-level report if any
      const topReport = (
        item.report?.markdown_content ||
        item.report?.summary ||
        ""
      ).toLowerCase();
      if (searchWords.every((w) => topReport.includes(w))) return true;

      return false;
    });
  }, [history, historySearch]);

  // Extract sources for a specific turn/question
  const getTurnSources = (turn: any) => {
    if (!turn) return [];
    const sources: any[] = [];
    const seenUrls = new Set<string>();

    const addSource = (rawUrl: string, title?: string, image?: string) => {
      if (!rawUrl || typeof rawUrl !== "string") return;
      const cleanUrl = rawUrl.trim();
      if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) return;
      if (seenUrls.has(cleanUrl)) return;
      seenUrls.add(cleanUrl);
      sources.push({
        url: cleanUrl,
        title: title && title !== cleanUrl ? title : cleanUrl,
        image: image || ""
      });
    };

    turn.findings?.forEach((f: any) => {
      if (f.rich_sources?.length) {
        f.rich_sources.forEach((rs: any) => {
          addSource(rs.url, rs.title, rs.image);
        });
      }
      if (f.sources?.length) {
        f.sources.forEach((src: any) => {
          if (typeof src === "string") {
            addSource(src);
          } else if (src && src.url) {
            addSource(src.url, src.title, src.image);
          }
        });
      }
    });

    if (turn.report?.bibliography?.length) {
      turn.report.bibliography.forEach((b: any) => {
        if (typeof b === "string") {
          addSource(b);
        } else if (b && b.url) {
          addSource(b.url, b.title, b.image);
        }
      });
    }

    if (turn.report?.sources?.length) {
      turn.report.sources.forEach((s: any) => {
        if (typeof s === "string") {
          addSource(s);
        } else if (s && s.url) {
          addSource(s.url, s.title, s.image);
        }
      });
    }

    // Extract any markdown citation links [N](https://...)
    if (turn.report?.markdown_content) {
      const linkRegex = /\[(?:[^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(turn.report.markdown_content)) !== null) {
        addSource(match[1]);
      }
    }

    return sources;
  };

  // Compute full chronological list of conversation turns
  const turnsToRender = useMemo(() => {
    if (!pipelineData) return [];
    let turns: any[] = [];
    if (pipelineData.turns && Array.isArray(pipelineData.turns) && pipelineData.turns.length > 0) {
      const lastIdx = pipelineData.turns.length - 1;
      const lastTurn = pipelineData.turns[lastIdx];
      const lastTurnQuery = lastTurn?.query;
      const lastTurnHasReport = Boolean(lastTurn?.report?.markdown_content || lastTurn?.report?.title);

      // If loading and executing a new query
      if (loading && pipelineData.query && (pipelineData.query !== lastTurnQuery || !lastTurnHasReport)) {
        if (pipelineData.query !== lastTurnQuery) {
          // All previous turns in pipelineData.turns are finished
          turns = pipelineData.turns.map((t: any) => ({ ...t, isLive: false }));
          // Append the active follow-up query as the only live turn
          turns.push({
            query: pipelineData.query,
            effort_level: pipelineData.effort_level || effortLevel,
            plan: pipelineData.plan,
            findings: pipelineData.findings || [],
            verifications: pipelineData.verifications || [],
            report: pipelineData.report,
            is_chat: Boolean(pipelineData.is_chat || pipelineData.effort_level === "chat" || pipelineData.query?.toLowerCase()?.startsWith("/chat")),
            isLive: true
          });
        } else {
          // The last turn is currently streaming
          turns = pipelineData.turns.map((t: any, idx: number) => {
            if (idx === lastIdx) {
              return {
                ...t,
                query: pipelineData.query || t.query,
                effort_level: pipelineData.effort_level || t.effort_level || effortLevel,
                plan: pipelineData.plan || t.plan,
                findings: (pipelineData.findings && pipelineData.findings.length > 0) ? pipelineData.findings : (t.findings || []),
                verifications: (pipelineData.verifications && pipelineData.verifications.length > 0) ? pipelineData.verifications : (t.verifications || []),
                report: pipelineData.report || t.report,
                is_chat: Boolean(t.is_chat || pipelineData.is_chat || pipelineData.effort_level === "chat"),
                isLive: true
              };
            }
            return { ...t, isLive: false };
          });
        }
      } else {
        // Completed session: all turns are permanently finished (isLive = false)
        turns = pipelineData.turns.map((t: any) => ({ ...t, isLive: false }));
      }
    } else {
      turns = [{
        query: pipelineData.query,
        effort_level: pipelineData.effort_level || effortLevel,
        plan: pipelineData.plan,
        findings: pipelineData.findings || [],
        verifications: pipelineData.verifications || [],
        report: pipelineData.report,
        is_chat: Boolean(pipelineData.is_chat || pipelineData.effort_level === "chat" || pipelineData.query?.toLowerCase()?.startsWith("/chat")),
        isLive: loading
      }];
    }

    return turns.filter((t: any) => Boolean(t && (t.query || t.report)));
  }, [pipelineData, loading, effortLevel]);

  // Active turn index (auto-syncs on scroll to visible question)
  const [activeTurnIndex, setActiveTurnIndex] = useState<number>(0);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Update activeTurnIndex to latest when new turns are created
  useEffect(() => {
    if (turnsToRender.length > 0) {
      setActiveTurnIndex(turnsToRender.length - 1);
    }
  }, [turnsToRender.length]);

  const handleContentScroll = () => {
    if (!contentScrollRef.current) return;
    const containerTop = contentScrollRef.current.getBoundingClientRect().top;
    const containerMid = containerTop + contentScrollRef.current.clientHeight * 0.35;

    let currentIdx = 0;
    for (let i = 0; i < turnsToRender.length; i++) {
      const el = turnRefs.current[i];
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= containerMid) {
          currentIdx = i;
        }
      }
    }
    setActiveTurnIndex(currentIdx);
  };

  const scrollToTurn = (idx: number) => {
    setActiveTurnIndex(idx);
    const el = turnRefs.current[idx];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Active response web sources for the right rail (tracks in-view question)
  const activeSources = useMemo(() => {
    if (!turnsToRender || turnsToRender.length === 0) return [];
    const safeIdx = Math.min(Math.max(0, activeTurnIndex), turnsToRender.length - 1);
    const turn = turnsToRender[safeIdx] || turnsToRender[turnsToRender.length - 1];
    const s = getTurnSources(turn);
    if (s.length > 0) return s;

    for (let i = turnsToRender.length - 1; i >= 0; i--) {
      const prev = getTurnSources(turnsToRender[i]);
      if (prev.length > 0) return prev;
    }
    return [];
  }, [turnsToRender, activeTurnIndex]);

  // Real-time execution timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  // Client hydration & restoration state
  const [mounted, setMounted] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [activityLogs, setActivityLogs] = useState<{ id: string; time: string; text: string; action?: string; subtask?: string }[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Dynamic LLM-generated research topic suggestions (initialized with instant defaults)
  const [suggestions, setSuggestions] = useState<any[]>(() => {
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

  useEffect(() => {
    let interval: any = null;
    if (loading) {
      interval = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    if (mins === 0) return `${remainingSecs}s`;
    return `${mins}m ${remainingSecs < 10 ? '0' : ''}${remainingSecs}s`;
  };

  const getFollowUpTopics = (queryText: string, reportMarkdown?: string, relatedQs?: string[]) => {
    if (relatedQs && relatedQs.length > 0) {
      return relatedQs.slice(0, 4);
    }
    if (!queryText) return [];

    const qClean = queryText.replace(/[?.,!]/g, "").trim();
    const lower = queryText.toLowerCase();

    if (lower.includes("semiconductor") || lower.includes("chip") || lower.includes("asml") || lower.includes("tsmc") || lower.includes("lithography")) {
      return [
        "What are the top technological alternatives to High-NA EUV lithography?",
        "How is China advancing domestic chip fabrication against export controls?",
        "What is the projected economic impact of TSMC fab delays in the US?",
        "What are the supply bottlenecks in advanced chip packaging (CoWoS)?"
      ];
    } else if (lower.includes("ai") || lower.includes("model") || lower.includes("llm") || lower.includes("agent") || lower.includes("deep learning")) {
      return [
        `What are the leading architectures and models competing with ${qClean}?`,
        "What are the primary compute, memory, and latency bottlenecks?",
        "How do enterprise security, privacy, and guardrails affect deployment?",
        "What are the projected ROI and cost efficiency benchmarks across industries?"
      ];
    } else if (lower.includes("quantum")) {
      return [
        "What are the leading error-correction architectures in quantum computing?",
        "How do superconducting qubits compare with neutral-atom systems?",
        "What are the primary post-quantum cryptography transition timelines?",
        "Which commercial industries are closest to achieving quantum advantage?"
      ];
    } else if (lower.includes("market") || lower.includes("economy") || lower.includes("stock") || lower.includes("crypto") || lower.includes("finance")) {
      return [
        `What are the macroeconomic headwinds most likely to impact ${qClean}?`,
        "What do top institutional analysts forecast for the next 3-5 years?",
        "What are the primary regulatory risks and compliance challenges?",
        "How are leading market players hedging against systemic risks?"
      ];
    }

    return [
      `What are the key technological and strategic bottlenecks in ${qClean}?`,
      `What are the top emerging trends and regulatory implications for ${qClean}?`,
      `How do leading global players compare in execution on ${qClean}?`,
      `What are the primary risk factors and mitigation strategies for ${qClean}?`
    ];
  };

  const handleCopyTurnMarkdown = (turn: any) => {
    if (!turn?.report?.markdown_content) return;
    let content = turn.report.markdown_content.trim();
    if (!content.startsWith("# ") && turn.query) {
      content = `# ${turn.query}\n\n${content}`;
    }
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTurnMarkdown = (turn: any) => {
    if (!turn?.report?.markdown_content) return;
    let content = turn.report.markdown_content.trim();
    // Ensure the downloaded markdown file always includes the full question as the top H1 header
    if (!content.startsWith("# ") && turn.query) {
      content = `# ${turn.query}\n\n${content}`;
    }
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `research_${(turn.query || "report").slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTurnPDF = async (turn: any, turnIdx: number) => {
    if (!turn?.report?.markdown_content) return;
    let wrapper: HTMLDivElement | null = null;
    try {
      setIsExportingPDF(true);
      const articleEl = document.getElementById(`turn-report-article-${turnIdx}`);
      if (!articleEl) {
        console.error("Article element not found for turn", turnIdx);
        setIsExportingPDF(false);
        return;
      }

      // Create a dedicated off-canvas container positioned at (0,0) with exact 720px width
      wrapper = document.createElement("div");
      wrapper.id = "pdf-temp-export-container";
      wrapper.style.position = "absolute";
      wrapper.style.top = "0px";
      wrapper.style.left = "0px";
      wrapper.style.width = "720px";
      wrapper.style.padding = "24px 32px";
      wrapper.style.boxSizing = "border-box";
      wrapper.style.backgroundColor = "#ffffff";
      wrapper.style.color = "#0f172a";
      wrapper.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
      wrapper.style.zIndex = "-9999";
      wrapper.style.opacity = "1";
      wrapper.style.pointerEvents = "none";

      const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      const turnSources = getTurnSources(turn);

      wrapper.innerHTML = `
        <div style="border-bottom: 2px solid #0891b2; padding-bottom: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end;">
          <div style="font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #0891b2;">Deep Research AI — Intelligence Dossier</div>
          <div style="font-size: 10px; color: #64748b; font-family: monospace;">${dateStr}</div>
        </div>
        <h1 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0; line-height: 1.35; word-wrap: break-word;">${turn.query || "Research Dossier"}</h1>
        <div class="pdf-rendered-body" style="color: #334155; line-height: 1.7; font-size: 12.5px;">
          ${articleEl.innerHTML}
        </div>
        ${turnSources && turnSources.length > 0 ? `
          <div class="pdf-sources-block" style="margin-top: 28px; padding-top: 14px; border-top: 1px solid #cbd5e1;">
            <div style="font-size: 12.5px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Sources & References Cited</div>
            ${turnSources.map((s: any, idx: number) => {
              let domain = "";
              try { domain = s.url ? new URL(s.url).hostname.replace("www.", "") : ""; } catch(e) {}
              return `
                <div style="font-size: 10.5px; color: #475569; margin-bottom: 4px; line-height: 1.4;">
                  <strong>[${idx + 1}]</strong> <a href="${s.url}" style="color: #0284c7; text-decoration: underline;" target="_blank">${s.title || s.url}</a> ${domain ? `(${domain})` : ""}
                </div>
              `;
            }).join("")}
          </div>
        ` : ""}
        <div style="margin-top: 32px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between;">
          <span>Autonomous Deep Research Engine</span>
          <span>Confidential Intelligence Dossier</span>
        </div>
      `;

      // Transform citation badge buttons into clean inline blue text [N]
      wrapper.querySelectorAll("button").forEach((btn: any) => {
        const text = btn.textContent ? btn.textContent.trim() : "";
        const match = text.match(/^\[?(\d+)\]?$/);
        if (match) {
          const num = match[1];
          const span = document.createElement("span");
          span.textContent = `[${num}]`;
          span.style.color = "#0284c7";
          span.style.fontWeight = "700";
          span.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
          span.style.fontSize = "11px";
          span.style.display = "inline";
          span.style.margin = "0 2px";
          span.style.verticalAlign = "baseline";
          span.style.textDecoration = "none";
          btn.parentNode?.replaceChild(span, btn);
        } else {
          btn.style.display = "none";
        }
      });

      // Style headings
      wrapper.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el: any) => {
        el.style.color = "#0f172a";
        el.style.fontWeight = "700";
        el.style.marginTop = "16px";
        el.style.marginBottom = "8px";
        el.style.lineHeight = "1.3";
      });

      // Style paragraphs and lists
      wrapper.querySelectorAll("p, li").forEach((el: any) => {
        el.style.color = "#334155";
        el.style.fontSize = "12px";
        el.style.lineHeight = "1.7";
        el.style.marginBottom = "8px";
      });

      wrapper.querySelectorAll("strong, b").forEach((el: any) => {
        el.style.color = "#0f172a";
        el.style.fontWeight = "700";
      });

      // Style tables
      wrapper.querySelectorAll("table").forEach((el: any) => {
        el.style.width = "100%";
        el.style.borderCollapse = "collapse";
        el.style.margin = "14px 0";
        el.style.fontSize = "11px";
        el.style.backgroundColor = "#ffffff";
        el.style.border = "1px solid #cbd5e1";
      });

      wrapper.querySelectorAll("th").forEach((el: any) => {
        el.style.background = "#f1f5f9";
        el.style.color = "#0f172a";
        el.style.fontWeight = "700";
        el.style.border = "1px solid #cbd5e1";
        el.style.padding = "7px 10px";
        el.style.textAlign = "left";
        el.style.fontSize = "11px";
      });

      wrapper.querySelectorAll("td").forEach((el: any) => {
        el.style.border = "1px solid #e2e8f0";
        el.style.padding = "7px 10px";
        el.style.color = "#334155";
        el.style.lineHeight = "1.5";
        el.style.fontSize = "10.5px";
        el.style.backgroundColor = "#ffffff";
      });

      wrapper.querySelectorAll("a").forEach((el: any) => {
        el.style.color = "#0284c7";
        el.style.textDecoration = "underline";
      });

      wrapper.querySelectorAll("blockquote").forEach((el: any) => {
        el.style.borderLeft = "3px solid #0891b2";
        el.style.paddingLeft = "12px";
        el.style.color = "#475569";
        el.style.fontStyle = "italic";
        el.style.margin = "12px 0";
      });

      document.body.appendChild(wrapper);

      // Brief delay to allow browser to calculate layout
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Measure block elements for intelligent page breaking
      const blockElements = Array.from(wrapper.querySelectorAll(
        "h1, h2, h3, h4, h5, h6, table, tr, p, li, blockquote, .pdf-sources-block"
      )) as HTMLElement[];

      const wrapperRect = wrapper.getBoundingClientRect();
      const elementsWithOffsets = blockElements.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          top: rect.top - wrapperRect.top,
          bottom: rect.bottom - wrapperRect.top,
          height: rect.height,
          isHeading: /^H[1-6]$/i.test(el.tagName),
          isTable: el.tagName.toLowerCase() === "table",
          isTableRow: el.tagName.toLowerCase() === "tr"
        };
      }).filter(item => item.height > 0);

      elementsWithOffsets.sort((a, b) => a.top - b.top);

      const totalHeightPx = wrapper.scrollHeight;
      // Printable A4 height at 720px width: (841.89 - 50) / (595.28 - 50) * 720 ≈ 1045px
      const pageHeightPx = 1000;

      const pageBreaks: number[] = [0];
      let currentTop = 0;

      while (currentTop < totalHeightPx) {
        const idealBottom = currentTop + pageHeightPx;
        if (idealBottom >= totalHeightPx) {
          pageBreaks.push(totalHeightPx);
          break;
        }

        let bestBreak = idealBottom;
        let foundCandidate = false;

        for (let i = 0; i < elementsWithOffsets.length; i++) {
          const item = elementsWithOffsets[i];
          // If element starts before idealBottom and ends after idealBottom
          if (item.top > currentTop + 100 && item.top < idealBottom && item.bottom > idealBottom) {
            bestBreak = item.top - 6;
            foundCandidate = true;
            break;
          }
          // Don't leave an orphan heading at the bottom of a page
          if (item.isHeading && item.top > currentTop + 100 && (idealBottom - item.top) < 80) {
            bestBreak = item.top - 6;
            foundCandidate = true;
            break;
          }
        }

        if (!foundCandidate || (bestBreak - currentTop) < 400) {
          bestBreak = idealBottom;
        }

        pageBreaks.push(bestBreak);
        currentTop = bestBreak;
      }

      // High-res canvas capture at 2x
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        windowWidth: 720,
        scrollX: 0,
        scrollY: 0
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4"
      });

      const pdfPageWidth = pdf.internal.pageSize.getWidth(); // 595.28 pt
      const margin = 25; // 25pt margin
      const printableWidth = pdfPageWidth - (margin * 2); // 545.28 pt
      const scaleFactor = canvas.width / 720; // 2

      for (let i = 0; i < pageBreaks.length - 1; i++) {
        const startPx = pageBreaks[i];
        const endPx = pageBreaks[i + 1];
        const sliceHeightPx = endPx - startPx;

        if (sliceHeightPx <= 0) continue;

        if (i > 0) {
          pdf.addPage();
        }

        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.round(sliceHeightPx * scaleFactor);

        const ctx = sliceCanvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0,
            Math.round(startPx * scaleFactor),
            canvas.width,
            Math.round(sliceHeightPx * scaleFactor),
            0,
            0,
            sliceCanvas.width,
            sliceCanvas.height
          );

          const sliceImgData = sliceCanvas.toDataURL("image/jpeg", 0.95);
          const renderHeightPt = (sliceHeightPx / 720) * printableWidth;

          pdf.addImage(
            sliceImgData,
            "JPEG",
            margin,
            margin,
            printableWidth,
            renderHeightPt,
            undefined,
            "FAST"
          );
        }
      }

      const cleanFilename = `research_${(turn.query || "report").slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      pdf.save(cleanFilename);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      if (wrapper && document.body.contains(wrapper)) {
        document.body.removeChild(wrapper);
      }
      setIsExportingPDF(false);
    }
  };

  const consumeSSEStream = async (url: string, method: "POST" | "GET", body?: any, targetSessionId?: string) => {
    // Abort previous running stream if any
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (e) { }
    }
    const currentAbortController = new AbortController();
    abortControllerRef.current = currentAbortController;

    setLoading(true);
    setError(null);
    setLiveStatus("Connecting to autonomous agent cluster...");
    const startTime = Date.now();

    try {
      const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        authHeaders["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: currentAbortController.signal
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.error?.message || errorData.message || errorData.detail || `Request failed (${res.status})`;
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

        for (const line of parts) {
          if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "");
            try {
              const parsed = JSON.parse(dataStr);

              if (parsed.type === "session_created") {
                const sId = parsed.id;
                setPipelineData((prev: any) => {
                  const existingTurns = (parsed.turns && Array.isArray(parsed.turns) && parsed.turns.length > 0)
                    ? parsed.turns
                    : (prev?.turns && prev?.id === sId ? prev.turns : (prev?.turns || []));
                  return {
                    ...prev,
                    id: sId,
                    query: parsed.query || prev?.query || "",
                    effort_level: parsed.effort_level || prev?.effort_level || "medium",
                    status: "running",
                    turns: existingTurns,
                    plan: null,
                    findings: [],
                    verifications: [],
                    report: null
                  };
                });
                // Update URL immediately so refresh or copy preserves the session
                window.history.replaceState(null, "", `/?id=${sId}`);
                // Update history sidebar immediately
                setHistory((prev: any[]) => {
                  const filtered = prev.filter((item: any) => item.id !== sId);
                  const prevItem = prev.find((item: any) => item.id === sId);
                  const sessionTitle = (prevItem && prevItem.query)
                    ? prevItem.query
                    : (parsed.turns && parsed.turns[0]?.query ? parsed.turns[0].query : (parsed.query || "Research Session"));
                  return [{
                    id: sId,
                    query: sessionTitle,
                    effort_level: parsed.effort_level || "medium",
                    status: "running",
                    turns: (parsed.turns && parsed.turns.length > 0) ? parsed.turns : (prevItem?.turns || []),
                    created_at: prevItem?.created_at || new Date().toISOString()
                  }, ...filtered];
                });
              } else if (parsed.type === "status") {
                const rawMsg = parsed.message || "";
                const lowerMsg = rawMsg.toLowerCase();
                // Filter out internal infrastructure and caching jargon from user view
                if (
                  lowerMsg.includes("redis") ||
                  lowerMsg.includes("vector store") ||
                  lowerMsg.includes("semantic vector") ||
                  lowerMsg.includes("cache check") ||
                  lowerMsg.includes("cluster in action")
                ) {
                  // Do not display internal cache/architecture notices
                } else {
                  setLiveStatus(rawMsg);
                  setActivityLogs(prev => [
                    ...prev.slice(-25),
                    {
                      id: Math.random().toString(),
                      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                      text: rawMsg,
                      action: "update"
                    }
                  ]);
                }
              } else if (parsed.type === "search_progress") {
                if (parsed.task_id && parsed.status) {
                  setTaskStatuses((prev: any) => ({ ...prev, [parsed.task_id]: parsed.status }));
                  setActivityLogs(prev => [
                    ...prev.slice(-25),
                    {
                      id: Math.random().toString(),
                      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                      text: parsed.status,
                      action: parsed.action || "search",
                      subtask: parsed.task_id
                    }
                  ]);
                }
              } else if (parsed.type === "plan") {
                setPipelineData((prev: any) => ({ ...prev, plan: parsed.data }));
                const numTasks = parsed.data?.sub_tasks?.length || 0;
                setActivityLogs(prev => [
                  ...prev.slice(-25),
                  {
                    id: Math.random().toString(),
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    text: `Identified ${numTasks} research topics to investigate`,
                    action: "plan"
                  }
                ]);
              } else if (parsed.type === "finding") {
                setPipelineData((prev: any) => {
                  const currentFindings = prev?.findings || [];
                  const exists = currentFindings.some((f: any) => f.task_id === parsed.data.task_id);
                  return {
                    ...prev,
                    findings: exists
                      ? currentFindings.map((f: any) => f.task_id === parsed.data.task_id ? parsed.data : f)
                      : [...currentFindings, parsed.data]
                  };
                });
                const srcCount = parsed.data?.sources?.length || 0;
                setActivityLogs(prev => [
                  ...prev.slice(-25),
                  {
                    id: Math.random().toString(),
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    text: `Extracted facts from ${srcCount} primary web sources`,
                    action: "finding"
                  }
                ]);
              } else if (parsed.type === "verifications") {
                setPipelineData((prev: any) => ({ ...prev, verifications: parsed.data }));
                setActivityLogs(prev => [
                  ...prev.slice(-25),
                  {
                    id: Math.random().toString(),
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    text: `Verified facts and source citations`,
                    action: "verify"
                  }
                ]);
              } else if (parsed.type === "chat_token") {
                setPipelineData((prev: any) => ({
                  ...prev,
                  report: {
                    ...prev?.report,
                    markdown_content: (prev?.report?.markdown_content || "") + parsed.token,
                    title: prev?.report?.title || "Conversational Response",
                    is_chat: true
                  }
                }));
              } else if (parsed.type === "chat_done") {
                const totalSecs = Math.max(1, Math.round((Date.now() - startTime) / 1000));
                setDurationSeconds(totalSecs);
                const doneId = parsed.id || targetSessionId;
                if (parsed.turns) {
                  setPipelineData((prev: any) => ({
                    ...prev,
                    id: doneId || prev?.id,
                    status: "completed",
                    duration_seconds: totalSecs,
                    turns: parsed.turns,
                    report: null
                  }));
                }
              } else if (parsed.type === "report_token") {
                setPipelineData((prev: any) => ({
                  ...prev,
                  report: {
                    ...prev?.report,
                    markdown_content: (prev?.report?.markdown_content || "") + parsed.token,
                    title: prev?.report?.title || "Synthesizing Report..."
                  }
                }));
              } else if (parsed.type === "report") {
                setPipelineData((prev: any) => ({
                  ...prev,
                  report: { ...(prev?.report || {}), ...parsed.data }
                }));
              } else if (parsed.type === "related_questions") {
                setPipelineData((prev: any) => ({
                  ...prev,
                  report: {
                    ...(prev?.report || {}),
                    related_questions: parsed.questions
                  }
                }));
              } else if (parsed.type === "clear_report") {
                setPipelineData((prev: any) => ({ ...prev, report: null }));
              } else if (parsed.type === "error") {
                const serverErrMsg = parsed.message || "An unknown server error occurred.";
                console.error("SSE server error:", serverErrMsg);
                setError(serverErrMsg);
                // Show the error as a chat response so the UI isn't empty
                setPipelineData((prev: any) => ({
                  ...prev,
                  status: "completed",
                  report: {
                    ...prev?.report,
                    markdown_content: (prev?.report?.markdown_content || "") ||
                      `⚠️ **Research engine encountered an error:**\n\n> ${serverErrMsg}\n\nPlease try again in a moment.`,
                    title: prev?.report?.title || "Error",
                    is_chat: true
                  }
                }));
                setLoading(false);
                return; // Stop processing the stream
              } else if (parsed.type === "done") {
                const totalSecs = Math.max(1, Math.round((Date.now() - startTime) / 1000));
                setDurationSeconds(totalSecs);
                const doneId = parsed.id || targetSessionId;
                setPipelineData((prev: any) => {
                  const finalTurns = (parsed.turns && Array.isArray(parsed.turns) && parsed.turns.length > 0)
                    ? parsed.turns
                    : (prev?.turns && prev.turns.length > 0 ? prev.turns : []);
                  return {
                    ...prev,
                    id: doneId || prev?.id,
                    status: "completed",
                    duration_seconds: totalSecs,
                    turns: finalTurns,
                    plan: null,
                    findings: [],
                    verifications: [],
                    report: null
                  };
                });
                // Immediately update local sidebar history item status to 'completed'
                setHistory((prev: any[]) =>
                  prev.map((item: any) =>
                    item.id === doneId ? { ...item, status: "completed" } : item
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
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Previous research stream aborted for new query.");
        return;
      }
      console.error("Stream execution error:", err);
      const errMsg = (err.message || "Failed to start research.").replace(/please sign in.*$/i, "").trim();
      setError(errMsg);
    } finally {
      if (abortControllerRef.current === currentAbortController) {
        setLoading(false);
      }
    }
  };


  const handleStartNewSession = () => {
    // If not logged in and there is an active guest session, clean it up from backend
    const effectiveToken = getAuthToken();
    const oldSessionId = pipelineData?.id;
    if (!effectiveToken && oldSessionId) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      try {
        fetch(`${apiUrl}/api/research/history/${oldSessionId}`, { method: "DELETE" }).catch(() => {});
      } catch (_) {}
    }

    // Abort any running research or chat stream immediately
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (e) {}
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

  const handleSelectSession = (sessionItem: any) => {
    if (!sessionItem || !sessionItem.id) return;

    // Abort any previous running stream
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (e) {}
    }

    // Instant synchronous UI switch using local session data
    window.history.pushState(null, "", `/?id=${sessionItem.id}`);
    setPipelineData(sessionItem);
    setActiveTab("current");
    setQuery("");
    setError(null);
    setLoading(sessionItem.status === "running");

    // Asynchronously fetch full/fresh state or reconnect to live background stream
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

          // If session is still running in background, seamlessly connect to its live stream!
          if (session.status === "running") {
            setLoading(true);
            consumeSSEStream(`${apiUrl}/api/research/stream/${id}/subscribe`, "GET", undefined, id);
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
        Authorization: `Bearer ${effectiveToken}`
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
      const res = await fetch(`${apiUrl}/api/research/suggestions`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.suggestions && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
          try {
            sessionStorage.setItem("dr_suggestions", JSON.stringify(data.suggestions));
          } catch (_) {}
        }
      }
    } catch (err) {
      console.debug("Dynamic suggestions fetch notice:", err);
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(false);
    setUserDropdownOpen(false);

    // Abort active stream if any
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (e) {}
    }

    // Reset URL cleanly to homepage root
    window.history.pushState(null, "", "/");

    // Clear all private session data and return to clean new research state
    setActiveTab("new");
    setPipelineData(null);
    setHistory([]);
    setQuery("");
    setError(null);
    setLoading(false);
    setDurationSeconds(null);
    setElapsedSeconds(0);

    // Clear authentication state and tokens
    logout();

    // Fetch fresh dynamic questions for the public homepage
    fetchLLMSuggestions();
  };

  // Auto-cache active session in sessionStorage for instantaneous 0ms reload upon refresh
  useEffect(() => {
    if (pipelineData && pipelineData.id && typeof window !== "undefined") {
      try {
        sessionStorage.setItem(`dr_session_${pipelineData.id}`, JSON.stringify(pipelineData));
      } catch (e) {}
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

      // 1. Instant 0ms Cache Hydration: Render immediately from sessionStorage without waiting for network!
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
        } catch (e) {}
      }

      // 2. Parallel Background Sync & Non-blocking Network Requests
      const effectiveToken = getAuthToken();

      // Launch history & dynamic suggestions in parallel without blocking session restore!
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
              setPipelineData(found);
              setActiveTab("current");
              if (found.status === "running") {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
                consumeSSEStream(`${apiUrl}/api/research/stream/${targetId}/subscribe`, "GET", undefined, targetId);
              }
            }
          }
        } finally {
          setIsRestoringSession(false);
        }
      } else {
        setIsRestoringSession(false);
      }

      // Check URL for auth modal trigger (?auth=signin or ?auth=signup) only if NOT logged in
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
          const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
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

    // Check if user submitted only a slash command without a question
    if (lower === "/chat" || lower === "/ask" || lower === "/c") {
      setEffortLevel("chat");
      setQuery("");
      return;
    } else if (lower === "/quick" || lower === "/low" || lower === "/fast" || lower === "/q") {
      setEffortLevel("low");
      setQuery("");
      return;
    } else if (lower === "/deep" || lower === "/medium" || lower === "/think" || lower === "/d") {
      setEffortLevel("medium");
      setQuery("");
      return;
    } else if (lower === "/pro" || lower === "/high" || lower === "/exhaustive" || lower === "/p") {
      setEffortLevel("high");
      setQuery("");
      return;
    }

    // Check inline slash command prefixes with questions
    if (lower.startsWith("/quick ") || lower.startsWith("/low ") || lower.startsWith("/fast ") || lower.startsWith("/q ")) {
      finalEffort = "low";
      isChatMode = false;
      cleanQuery = rawTrimmed.replace(/^\/(quick|low|fast|q)\s+/i, "").trim();
    } else if (lower.startsWith("/deep ") || lower.startsWith("/medium ") || lower.startsWith("/think ") || lower.startsWith("/d ")) {
      finalEffort = "medium";
      isChatMode = false;
      cleanQuery = rawTrimmed.replace(/^\/(deep|medium|think|d)\s+/i, "").trim();
    } else if (lower.startsWith("/pro ") || lower.startsWith("/high ") || lower.startsWith("/exhaustive ") || lower.startsWith("/p ")) {
      finalEffort = "high";
      isChatMode = false;
      cleanQuery = rawTrimmed.replace(/^\/(pro|high|exhaustive|p)\s+/i, "").trim();
    } else if (lower.startsWith("/chat ") || lower.startsWith("/ask ") || lower.startsWith("/c ")) {
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
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        text: isChatMode ? "Connecting to chat engine..." : "Starting web research...",
        action: "search"
      }
    ]);

    const activeSessionId = pipelineData?.id || null;
    const provisionalId = activeSessionId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}`);

    // Preserve past completed turns if continuing an active session
    let existingTurns: any[] = [];
    if (pipelineData?.turns && Array.isArray(pipelineData.turns) && pipelineData.turns.length > 0) {
      existingTurns = [...pipelineData.turns];
    } else if (pipelineData?.report && pipelineData?.query) {
      existingTurns = [{
        query: pipelineData.query,
        effort_level: pipelineData.effort_level || "medium",
        plan: pipelineData.plan,
        findings: pipelineData.findings,
        verifications: pipelineData.verifications,
        report: pipelineData.report,
        is_chat: pipelineData.is_chat || false
      }];
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
      effort_level: isChatMode ? "chat" : finalEffort
    });

    // Update URL immediately so refresh preserves session at t = 0s
    window.history.pushState(null, "", `/?id=${provisionalId}`);

    // Optimistically add session to history sidebar immediately
    setHistory((prev: any[]) => {
      const filtered = prev.filter((item: any) => item.id !== provisionalId);
      const existingSession = prev.find((item: any) => item.id === provisionalId);
      const sessionTitle = existingSession?.query || (existingTurns.length > 0 ? (existingTurns[0]?.query || cleanQuery) : cleanQuery);
      return [{
        id: provisionalId,
        query: sessionTitle,
        effort_level: isChatMode ? "chat" : finalEffort,
        status: "running",
        turns: existingTurns,
        created_at: existingSession?.created_at || new Date().toISOString()
      }, ...filtered];
    });

    setQuery("");
    setActiveTab("current");
    setLiveStatus(isChatMode ? "⚡ Connecting to Fast Chat Engine..." : "Initializing autonomous agent cluster...");

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
    await consumeSSEStream(
      `${apiUrl}/api/research/stream`,
      "POST",
      {
        query: cleanQuery,
        effort_level: isChatMode ? "chat" : finalEffort,
        mode: isChatMode ? "chat" : "research",
        previous_session_id: activeSessionId,
        session_id: provisionalId
      },
      provisionalId
    );
  };

  const handleRunPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;
    executeSearch(query, effortLevel);
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
      setLiveStatus("Generation stopped by user.");
    }
  };

  if (!mounted) {
    return (
      <div className="flex h-screen bg-[#1e2020] text-zinc-200 overflow-hidden font-sans">
        <aside className="w-64 bg-[#1a1c1c] border-r border-zinc-800/80 flex flex-col justify-between hidden md:flex shrink-0">
          <div>
            <div className="p-4 border-b border-zinc-800/80 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/30 flex items-center justify-center">
                <BrainCircuit className="w-5 h-5 text-cyan-400" />
              </div>
              <span className="font-semibold text-sm tracking-tight text-white">Deep Research AI</span>
            </div>
          </div>
        </aside>
        <main className="flex-1 flex flex-col h-screen overflow-y-auto relative items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#1e2020] text-zinc-200 overflow-hidden font-sans">
      {/* Sidebar - Clean History (ChatGPT Style Full & Mini-Rail Collapse) */}
      <aside
        className={`bg-[#1a1c1c] border-r border-zinc-800/80 h-screen flex flex-col justify-between shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] z-30 overflow-hidden relative ${
          sidebarOpen ? "w-64" : "w-12"
        }`}
      >
        {/* Full Expanded Sidebar (Fixed width container so text never re-wraps/squishes) */}
        <div
          className={`w-64 h-full flex flex-col justify-between shrink-0 transition-opacity duration-200 ${
            sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
        >
          <div className="flex flex-col w-full min-h-0 flex-1">
            {/* Header with Branding, Search Icon, and Sidebar Close Button */}
            <div className="h-14 px-3 border-b border-zinc-800/80 flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={handleStartNewSession}
                className="flex items-center gap-2 hover:opacity-85 transition-opacity text-left cursor-pointer group min-w-0"
              >
                <div className="w-7 h-7 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(6,182,212,0.18)] group-hover:border-cyan-400/60 transition-colors">
                  <BrainCircuit className="w-4 h-4 text-cyan-400 shrink-0" />
                </div>
                <span className="font-bold text-[13.5px] tracking-tight text-white leading-none whitespace-nowrap">Deep Research AI</span>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setSearchModalOpen(true)}
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
                onClick={handleStartNewSession}
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

              {(!token && !getAuthToken()) ? (
                <div className="px-3 py-6 text-xs text-zinc-500 text-center italic leading-relaxed">
                  Sign in to save research history
                </div>
              ) : history.length === 0 ? (
                <div className="px-3 py-6 text-xs text-zinc-500 text-center italic">
                  No past sessions
                </div>
              ) : (
                history.map((s) => {
                  const isSelected = pipelineData?.id === s.id && activeTab === "current";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSelectSession(s)}
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
                          setSessionToDelete(s.id);
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

          {/* User Account / Multi-Tenancy / Rate Limit Footer */}
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
                      <div className="text-xs font-medium text-zinc-200 truncate">{user.full_name || user.email}</div>
                      <div className="text-[10px] text-cyan-400 font-medium truncate flex items-center gap-1">
                        <Building2 className="w-2.5 h-2.5" />
                        <span>{activeTenant?.name || "Personal Workspace"}</span>
                      </div>
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLogoutModal(true)}
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
                              ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-700/40 font-semibold'
                              : 'text-zinc-300 hover:bg-zinc-800'
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
                  onClick={() => openAuthModal('signin')}
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
              onClick={handleStartNewSession}
              title="New research session"
              className="w-8.5 h-8.5 rounded-lg bg-[#242626] hover:bg-[#2e3131] border border-zinc-700/60 hover:border-zinc-500 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer shadow-sm group"
            >
              <SquarePenIcon className="w-4 h-4 text-zinc-300 group-hover:text-white transition-colors" />
            </button>

            {/* Search Modal Icon Button */}
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
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
                title={`${user.full_name || user.email} (${activeTenant?.name || 'Workspace'})`}
                className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase cursor-pointer"
              >
                {user.full_name ? user.full_name[0] : user.email[0]}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuthModal('signin')}
                title="Sign In to Save Researches"
                className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-cyan-950 border border-zinc-700 hover:border-cyan-500/50 flex items-center justify-center text-cyan-400 cursor-pointer"
              >
                <UserIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">

        {/* Prominent Guest Research Limit Reached Modal with Direct Sign Up / Log In Buttons */}
        <AnimatePresence>
          {error && (error.toLowerCase().includes("guest") || error.toLowerCase().includes("limit reached")) && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setError(null)}
                className="fixed inset-0 bg-black/80 backdrop-blur-md"
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative w-full max-w-md bg-[#1e2020] border border-cyan-500/40 rounded-3xl p-6 sm:p-8 shadow-[0_0_60px_rgba(6,182,212,0.18)] z-10 text-center overflow-hidden"
              >
                {/* Glowing cyan top accent */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_rgba(6,182,212,0.9)]" />

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="absolute top-4 right-4 p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Glowing Icon */}
                <div className="mx-auto w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-4 text-cyan-400 shadow-[0_0_24px_rgba(6,182,212,0.25)]">
                  <Sparkles className="w-7 h-7" />
                </div>

                {/* Heading */}
                <h3 className="text-xl font-bold text-white mb-2 tracking-tight">
                  Guest Research Limit Reached
                </h3>

                {/* Message */}
                <p className="text-sm text-zinc-300 leading-relaxed mb-6">
                  You’ve used all 5 free guest queries. Sign up or log in to continue researching with 50 queries per day, saved history, and full deep research access.
                </p>

                {/* Direct Sign Up & Log In Buttons */}
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      openAuthModal("signup");
                    }}
                    className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>Sign Up Free</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      openAuthModal("signin");
                    }}
                    className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-[#2a2c2c] hover:bg-[#323535] border border-zinc-700/80 text-zinc-200 hover:text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 rotate-180" />
                    <span>Log In</span>
                  </button>
                </div>

                <div className="mt-4 text-[11px] text-zinc-500">
                  Takes less than 30 seconds • No credit card required
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Sleek Floating Notification Toast (Bottom Right, Unobtrusive, for non-guest errors) */}
        <AnimatePresence>
          {error && !(error.toLowerCase().includes("guest") || error.toLowerCase().includes("limit reached")) && (
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

        {/* Loading state when restoring a chat directly from URL on hard refresh */}
        {isRestoringSession && !pipelineData && (
          <div className="flex-1 flex flex-col justify-center items-center py-28 space-y-4 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <div className="text-zinc-300 font-medium text-sm">Restoring research session...</div>
            <p className="text-xs text-zinc-500">Retrieving intelligence dossier and citations from storage.</p>
          </div>
        )}

        {/* New Search View (Landing) */}
        {!isRestoringSession && !pipelineData && (
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
            <div className="flex-1 flex flex-col justify-center items-center -mt-12 text-center max-w-3xl xl:max-w-4xl w-full">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2a2c2c] border border-zinc-700/50 text-xs text-zinc-300 mb-6 shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Autonomous Multi-Agent Deep Research Engine</span>
              </div>

              <h1 className="font-manrope text-2xl sm:text-4xl md:text-[42px] font-bold text-white tracking-tight mb-3.5 max-w-xl transition-all">
                {effortLevel === "chat" ? (
                  <>What would you like to <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">chat</span> about?</>
                ) : (
                  <>What would you like to <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">research</span>?</>
                )}
              </h1>
              <p className="font-manrope text-zinc-400 text-sm md:text-base max-w-lg mb-8 leading-relaxed">
                {effortLevel === "chat"
                  ? "Fast conversational AI with instant token-by-token streaming and zero multi-agent delay."
                  : "Autonomous planning, multi-source web crawling, dense vector synthesis, and citation verification."
                }
              </p>

              {/* Main Input Form - Generous Width and Height */}
              <form onSubmit={handleRunPipeline} className="w-full max-w-3xl relative">
                {/* Floating Slash Command Autocomplete Menu (Opens Downwards on Landing Page) */}
                <AnimatePresence>
                  {query.startsWith("/") && !query.includes(" ") && filteredSlashCommands.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.99 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.99 }}
                      className="absolute top-full mt-2.5 left-0 w-full bg-[#1e2020] border border-zinc-700/80 rounded-2xl shadow-2xl p-1.5 z-50 text-left max-h-[45vh] overflow-y-auto custom-scrollbar"
                    >
                      <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between border-b border-zinc-800 pb-2 mb-1">
                        <span className="flex items-center gap-1.5 text-zinc-300">
                          <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                          <span>Commands & Thinking Depth</span>
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">Navigate with arrows • Press Enter</span>
                      </div>

                      <div className="space-y-0.5">
                        {filteredSlashCommands.map((cmd, idx) => {
                          const isSelected = (slashSelectedIndex % filteredSlashCommands.length) === idx;
                          return (
                            <button
                              key={cmd.id}
                              type="button"
                              onClick={() => {
                                setEffortLevel(cmd.effort);
                                setQuery("");
                              }}
                              onMouseEnter={() => setSlashSelectedIndex(idx)}
                              className={`w-full text-left p-2 rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                                isSelected
                                  ? "bg-[#2c2f2f] text-white"
                                  : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-zinc-100 font-semibold">{cmd.command}</span>
                                    <span className="text-xs font-medium text-zinc-200">{cmd.name}</span>
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
                      const isSlashActive = query.startsWith("/") && !query.includes(" ") && filteredSlashCommands.length > 0;
                      if (isSlashActive) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashCommands.length);
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setSlashSelectedIndex((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
                          return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          const effectiveIdx = Math.min(Math.max(0, slashSelectedIndex), filteredSlashCommands.length - 1);
                          const selectedCmd = filteredSlashCommands[effectiveIdx] || filteredSlashCommands[0];
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
                          executeSearch(query, effortLevel);
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
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setThinkingMenuOpen((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#242626] hover:bg-[#2b2d2d] border border-zinc-700/80 hover:border-zinc-600 text-zinc-200 text-xs font-medium transition-all shadow-sm cursor-pointer"
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
                        <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${thinkingMenuOpen ? "rotate-180" : ""}`} />
                      </button>

                      {/* Glassmorphism Thinking Depth Popover (Opens Downwards on Landing Page) */}
                      <AnimatePresence>
                        {thinkingMenuOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.99 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.99 }}
                            className="absolute top-full mt-2 left-0 w-80 max-w-[calc(100vw-32px)] bg-[#1e2020] border border-zinc-700/80 rounded-2xl shadow-2xl p-1.5 z-50 max-h-[45vh] overflow-y-auto custom-scrollbar"
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
                                onClick={() => { setEffortLevel("low"); setThinkingMenuOpen(false); }}
                                className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                                  effortLevel === "low"
                                    ? "bg-[#2c2f2f] text-white"
                                    : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                }`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold">Quick Scan</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">Quick</span>
                                  </div>
                                  <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Rapid preliminary overview & multi-source scan</p>
                                </div>
                              </button>

                              {/* Deep Research */}
                              <button
                                type="button"
                                onClick={() => { setEffortLevel("medium"); setThinkingMenuOpen(false); }}
                                className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                                  effortLevel === "medium"
                                    ? "bg-[#2c2f2f] text-white"
                                    : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                }`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold">Deep Research</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">Standard</span>
                                  </div>
                                  <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Comprehensive multi-step analysis & citation verification</p>
                                </div>
                              </button>

                              {/* Exhaustive Dossier */}
                              <button
                                type="button"
                                onClick={() => { setEffortLevel("high"); setThinkingMenuOpen(false); }}
                                className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                                  effortLevel === "high"
                                    ? "bg-[#2c2f2f] text-white"
                                    : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                }`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold">Exhaustive Dossier</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">Exhaustive</span>
                                  </div>
                                  <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Deep recursive search & multi-perspective verification</p>
                                </div>
                              </button>

                              <div className="my-1 border-t border-zinc-800" />

                              {/* Fast Chat Mode */}
                              <button
                                type="button"
                                onClick={() => { setEffortLevel("chat"); setThinkingMenuOpen(false); }}
                                className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                                  effortLevel === "chat"
                                    ? "bg-[#2c2f2f] text-white"
                                    : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                }`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold">Fast Chat Mode</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">Chat</span>
                                  </div>
                                  <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Conversational answers grounded in research dossiers</p>
                                </div>
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <button
                      type="submit"
                      disabled={loading || !query.trim()}
                      title={loading ? "Processing..." : "Execute inquiry"}
                      className="bg-white hover:bg-zinc-200 text-black p-2.5 rounded-full transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed shadow-md hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer disabled:hover:scale-100"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </form>

              {/* Suggested Research Inquiries (Matching Follow-up Question Cards with Arrow Animation) */}
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
                        onClick={() => executeSearch(item.q, item.effort || "medium")}
                        className="w-full text-left bg-[#242626] hover:bg-[#2c2f2f] border border-zinc-700/70 hover:border-cyan-500/60 text-zinc-200 hover:text-white p-3 rounded-2xl transition-all duration-200 flex items-start gap-3 shadow-md hover:shadow-cyan-950/20 active:scale-[0.99] group cursor-pointer"
                      >
                        <span className="text-cyan-400 font-mono text-base shrink-0 mt-0.5 group-hover:translate-x-1 transition-transform">↳</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1.5 mb-0.5">
                            <span className="text-[11px] font-semibold text-cyan-400/90 truncate">{item.label}</span>
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
        )}

        {/* Live Multi-Turn Research View (Google AI Overview Layout) */}
        {pipelineData && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {/* Dedicated Scrollable Research Content */}
            <div
              ref={contentScrollRef}
              onScroll={handleContentScroll}
              className="flex-1 overflow-y-auto custom-scrollbar"
            >
              <div className="mx-auto w-full max-w-[1600px] 2xl:max-w-[1720px] px-4 sm:px-6 lg:px-8 xl:px-10 pt-4 pb-12 space-y-12">
              {turnsToRender.map((turn: any, turnIdx: number) => {
                const isLatest = turnIdx === turnsToRender.length - 1;
                const isTurnLoading = turn.isLive && loading;
                const turnSources = getTurnSources(turn);

                return (
                  <div key={turnIdx} className="space-y-4 pt-6 border-t border-zinc-800/80 first:border-t-0 first:pt-0">
                    {/* Header Title (Constrained width top header) */}
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 pb-0.5">
                      <div className="flex items-start gap-3 flex-1 min-w-0 max-w-4xl">
                        <h1 className="font-manrope text-lg sm:text-xl md:text-2xl font-bold text-white leading-snug tracking-tight break-words">
                          {turn.query}
                        </h1>
                      </div>
                    </div>

                    {/* Check if turn is a Fast Chat Turn */}
                    {Boolean(turn.is_chat || turn.effort_level === "chat") ? (
                      <div className="space-y-4 max-w-5xl">
                        <div className="bg-[#1e2020]/90 border border-zinc-800/80 rounded-2xl p-6 md:p-8 shadow-lg">
                          <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-700/50">
                            <div className="flex items-center gap-2.5 text-zinc-100 font-semibold text-xl">
                              <Sparkles className="w-5 h-5 text-cyan-400" />
                              <span>AI Overview</span>
                            </div>

                            {/* Action Toolbar (Targeting this exact turn's report) */}
                            <div className="flex items-center gap-2 relative">
                              <button
                                type="button"
                                onClick={() => handleCopyTurnMarkdown(turn)}
                                title={copied ? "Copied markdown!" : "Copy markdown"}
                                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm cursor-pointer"
                              >
                                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDownloadTurnMarkdown(turn)}
                                title="Download Markdown"
                                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm cursor-pointer"
                              >
                                <FileText className="w-4 h-4 text-cyan-400" />
                              </button>

                              <button
                                type="button"
                                disabled={isExportingPDF}
                                onClick={() => handleDownloadTurnPDF(turn, turnIdx)}
                                title="Download PDF"
                                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm disabled:opacity-50 cursor-pointer"
                              >
                                {isExportingPDF ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                                ) : (
                                  <Printer className="w-4 h-4 text-rose-400" />
                                )}
                              </button>
                            </div>
                          </div>

                          <article id={`turn-report-article-${turnIdx}`} className="w-full font-manrope text-zinc-100 antialiased tracking-normal">
                            {turn.report?.markdown_content ? (
                              <div>
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeRaw]}
                                  components={{
                                    a: ({ node, href, children, ...props }) => {
                                      const text = String(children);
                                      const citationMatch = text.match(/^\[?(\d+)\]?$/);
                                      if (citationMatch) {
                                        const idx = parseInt(citationMatch[1], 10);
                                        const matchedSource = turnSources[idx - 1];
                                        return (
                                          <CitationBadge
                                            index={idx}
                                            href={href || matchedSource?.url}
                                            source={matchedSource}
                                          />
                                        );
                                      }
                                      return (
                                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline font-medium text-[15.5px] md:text-[16.5px]" {...props}>
                                          {children}
                                        </a>
                                      );
                                    },
                                    h1: ({ node, children, ...props }) => {
                                      return <h1 className="text-xl md:text-2xl font-extrabold text-white tracking-tight mt-3 mb-5 pb-3 border-b border-zinc-700/60 leading-tight" {...props}>{children}</h1>;
                                    },
                                    h2: ({ node, children, ...props }) => {
                                      const text = String(children);
                                      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                                      return <h2 id={id} className="text-lg md:text-xl font-bold text-white tracking-tight mt-7 mb-3.5 scroll-mt-24 flex items-center gap-2 border-b border-zinc-800/80 pb-2.5 leading-snug" {...props}>{children}</h2>;
                                    },
                                    h3: ({ node, children, ...props }) => {
                                      const text = String(children);
                                      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                                      return <h3 id={id} className="text-base md:text-lg font-semibold text-cyan-200 tracking-tight mt-5 mb-2.5 scroll-mt-24 leading-snug" {...props}>{children}</h3>;
                                    },
                                    p: ({ node, children, ...props }) => {
                                      return <p className="text-[15.5px] md:text-[16.5px] leading-[1.8] my-4 text-zinc-200" {...props}>{children}</p>;
                                    },
                                    ul: ({ node, children, ...props }) => {
                                      return <ul className="space-y-2.5 my-5 list-disc pl-6 text-[15.5px] md:text-[16.5px] text-[#e4e4e7] leading-[1.8]" {...props}>{children}</ul>;
                                    },
                                    ol: ({ node, children, ...props }) => {
                                      return <ol className="space-y-2.5 my-5 list-decimal pl-6 text-[15.5px] md:text-[16.5px] text-[#e4e4e7] leading-[1.8]" {...props}>{children}</ol>;
                                    },
                                    li: ({ node, children, ...props }) => {
                                      return <li className="leading-[1.8] pl-1.5 text-[15.5px] md:text-[16.5px] text-[#e4e4e7]" {...props}>{children}</li>;
                                    },
                                    strong: ({ node, children, ...props }) => {
                                      return <strong className="font-bold text-white tracking-[0.01em]" {...props}>{children}</strong>;
                                    },
                                    b: ({ node, children, ...props }) => {
                                      return <b className="font-bold text-white tracking-[0.01em]" {...props}>{children}</b>;
                                    },
                                    blockquote: ({ node, children, ...props }) => {
                                      return <blockquote className="border-l-4 border-cyan-500 bg-[#222424]/80 pl-5 py-4 my-6 rounded-r-2xl text-zinc-200 italic text-[15.5px] md:text-[16.5px] leading-relaxed shadow-sm" {...props}>{children}</blockquote>;
                                    },
                                    table: ({ node, children, ...props }) => {
                                      return (
                                        <div className="overflow-x-auto my-6 rounded-2xl border border-zinc-700/80 shadow-xl">
                                          <table className="w-full text-left border-collapse bg-[#1c1e1e]" {...props}>{children}</table>
                                        </div>
                                      );
                                    },
                                    th: ({ node, children, ...props }) => {
                                      return <th className="bg-[#262828] text-white font-bold px-4 py-3.5 border-b border-zinc-700 text-xs md:text-sm tracking-wider uppercase" {...props}>{children}</th>;
                                    },
                                    td: ({ node, children, ...props }) => {
                                      return <td className="px-4 py-3.5 border-b border-zinc-800 text-zinc-200 text-[14.5px] md:text-[15.5px] leading-relaxed" {...props}>{children}</td>;
                                    }
                                  }}
                                >
                                  {transformCitationsInMarkdown(stripLeadingQueryTitle(turn.report.markdown_content), turnSources)}
                                </ReactMarkdown>

                                {/* ChatGPT-style Glowing Streaming Pulse Indicator */}
                                {isTurnLoading && (
                                  <div className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 text-xs font-mono shadow-lg shadow-cyan-950/50 backdrop-blur-sm">
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_8px_#22d3ee]"></span>
                                    </span>
                                    <span className="tracking-wide">Synthesizing intelligence...</span>
                                  </div>
                                )}
                              </div>
                            ) : isTurnLoading ? (
                              <div className="flex items-center gap-3 text-sm text-cyan-400 font-mono py-4">
                                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                                <span>{liveStatus || "Formulating response with intelligence context..."}</span>
                              </div>
                            ) : turn.report?.error ? (
                              <div className="text-red-400 bg-red-950/40 p-4 rounded-xl border border-red-900/50 text-sm">
                                Error: {turn.report.error}
                              </div>
                            ) : (
                              <p className="text-zinc-500 italic">Response completed.</p>
                            )}
                          </article>
                        </div>
                      </div>
                    ) : (
                    /* Google AI Overview Layout: Answer (Left 8/9 cols) + Sources Rail (Right 4/3 cols) Perfectly Aligned */
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8 items-start">
                      {/* Left Column: Multi-Agent Execution + Report (8/9 cols) */}
                      <div className="lg:col-span-8 xl:col-span-9 order-2 lg:order-1 space-y-4">
                        {/* Autonomous Multi-Agent Pipeline Stepper */}
                        <AgentPipelineStepper
                          status={liveStatus}
                          plan={turn.plan}
                          findings={turn.findings}
                          verifications={turn.verifications}
                          isComplete={!isTurnLoading && !!turn.report}
                          effortLevel={turn.effort_level || effortLevel}
                        />

                        {/* Multi-Agent Execution Visualizer */}
                        <div>
                          <details className="group" open={isTurnLoading}>
                            <summary className="flex items-center justify-between text-zinc-200 hover:text-white cursor-pointer font-medium text-[13.5px] select-none list-none bg-[#1e2020] hover:bg-[#232525] px-4 py-3 rounded-2xl border border-zinc-800/90 hover:border-zinc-700/80 transition-all shadow-sm group">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-6.5 h-6.5 rounded-lg bg-[#262828] border border-zinc-700/60 flex items-center justify-center shrink-0">
                                  <Cpu className={`w-3.5 h-3.5 ${isTurnLoading ? 'text-cyan-400 animate-pulse' : 'text-zinc-300'}`} />
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
                                const isRunning = isTurnLoading && !isDone && (turn.findings?.length === idx || taskStatuses[st.task_id]);
                                const currentStatus = taskStatuses[st.task_id];
                                const finding = turn.findings?.[idx];
                                return (
                                  <div key={st.task_id || idx} className="text-sm bg-[#222424] p-3 rounded-xl border border-zinc-800/90 transition-all space-y-2">
                                    <div className={`font-medium flex items-center justify-between gap-2 ${isDone ? 'text-zinc-200' : isRunning ? 'text-cyan-300' : 'text-zinc-500'}`}>
                                      <div className="flex items-center gap-2.5">
                                        {isDone ? (
                                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                        ) : isRunning ? (
                                          <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                                        ) : (
                                          <div className="w-4 h-4 rounded-full border border-zinc-700 shrink-0" />
                                        )}
                                        <span>Step {idx + 1}: {st.description}</span>
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
                                            <span className="text-[11px] text-zinc-400 font-medium">Crawled Sites:</span>
                                            {finding.sources.slice(0, 4).map((src: any, sIdx: number) => {
                                              const urlStr = typeof src === "string" ? src : src.url;
                                              try {
                                                const domain = new URL(urlStr).hostname.replace("www.", "");
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
                                          <span>Source Entailment: {(turn.verifications[idx].entailment_score * 100).toFixed(0)}% Verified</span>
                                        </div>
                                        <span className="text-[11px] text-zinc-400">Claims cross-checked against retrieved citations</span>
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
                                    <span>Web Search & Crawler Activity ({activityLogs.length} events)</span>
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
                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${badgeColor}`}>
                                            {badgeText}
                                          </span>
                                          <span className="flex-1 leading-snug truncate text-zinc-300">{log.text}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </details>
                        </div>

                        {/* Dossier Report Article */}
                        {turn.report ? (
                          <div className="bg-[#1e2020]/90 border border-zinc-800/80 rounded-2xl p-6 md:p-8 shadow-lg">
                            <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-700/50">
                              <div className="flex items-center gap-2.5 text-zinc-100 font-semibold text-xl">
                                <Sparkles className="w-5 h-5 text-cyan-400" />
                                <span>AI Overview</span>
                              </div>

                              {/* Action Toolbar (Targeting this exact turn's report) */}
                              <div className="flex items-center gap-2 relative">
                                <button
                                  type="button"
                                  onClick={() => handleCopyTurnMarkdown(turn)}
                                  title={copied ? "Copied markdown!" : "Copy markdown"}
                                  className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm cursor-pointer"
                                >
                                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDownloadTurnMarkdown(turn)}
                                  title="Download Markdown"
                                  className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm cursor-pointer"
                                >
                                  <FileText className="w-4 h-4 text-cyan-400" />
                                </button>

                                <button
                                  type="button"
                                  disabled={isExportingPDF}
                                  onClick={() => handleDownloadTurnPDF(turn, turnIdx)}
                                  title="Download PDF"
                                  className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-sm disabled:opacity-50 cursor-pointer"
                                >
                                  {isExportingPDF ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                                  ) : (
                                    <Printer className="w-4 h-4 text-rose-400" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Table of Contents Quick Navigator */}
                            {turn.report?.markdown_content && (
                              <TableOfContents markdown={stripLeadingQueryTitle(turn.report.markdown_content)} />
                            )}

                            {/* Rendered Pure Markdown with Interactive In-Text Citation Tooltips */}
                            <article id={`turn-report-article-${turnIdx}`} className="w-full font-manrope text-zinc-100 antialiased tracking-normal">
                              {turn.report.markdown_content ? (
                                <div>
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[rehypeRaw]}
                                    components={{
                                      a: ({ node, href, children, ...props }) => {
                                        const text = String(children);
                                        const citationMatch = text.match(/^\[?(\d+)\]?$/);
                                        if (citationMatch) {
                                          const idx = parseInt(citationMatch[1], 10);
                                          const matchedSource = turnSources[idx - 1];
                                          return (
                                            <CitationBadge
                                              index={idx}
                                              href={href || matchedSource?.url}
                                              source={matchedSource}
                                            />
                                          );
                                        }
                                        return (
                                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline font-medium text-[15.5px] md:text-[16.5px]" {...props}>
                                            {children}
                                          </a>
                                        );
                                      },
                                      h1: ({ node, children, ...props }) => {
                                        return <h1 className="text-xl md:text-2xl font-extrabold text-white tracking-tight mt-3 mb-5 pb-3 border-b border-zinc-700/60 leading-tight" {...props}>{children}</h1>;
                                      },
                                      h2: ({ node, children, ...props }) => {
                                        const text = String(children);
                                        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                                        return <h2 id={id} className="text-lg md:text-xl font-bold text-white tracking-tight mt-7 mb-3.5 scroll-mt-24 flex items-center gap-2 border-b border-zinc-800/80 pb-2.5 leading-snug" {...props}>{children}</h2>;
                                      },
                                      h3: ({ node, children, ...props }) => {
                                        const text = String(children);
                                        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                                        return <h3 id={id} className="text-base md:text-lg font-bold text-zinc-100 tracking-tight mt-6 mb-2.5 scroll-mt-24 leading-snug" {...props}>{children}</h3>;
                                      },
                                      h4: ({ node, children, ...props }) => {
                                        const text = String(children);
                                        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                                        return <h4 id={id} className="text-sm md:text-base font-semibold text-zinc-200 mt-5 mb-2 scroll-mt-24 leading-snug" {...props}>{children}</h4>;
                                      },
                                      p: ({ node, children, ...props }) => {
                                        return <p className="text-[15.5px] md:text-[16.5px] text-[#e4e4e7] leading-[1.8] md:leading-[1.85] mb-5 font-normal tracking-[0.01em] selection:bg-cyan-900 selection:text-white" {...props}>{children}</p>;
                                      },
                                      ul: ({ node, children, ...props }) => {
                                        return <ul className="space-y-2.5 my-5 list-disc pl-6 text-[15.5px] md:text-[16.5px] text-[#e4e4e7] leading-[1.8]" {...props}>{children}</ul>;
                                      },
                                      ol: ({ node, children, ...props }) => {
                                        return <ol className="space-y-2.5 my-5 list-decimal pl-6 text-[15.5px] md:text-[16.5px] text-[#e4e4e7] leading-[1.8]" {...props}>{children}</ol>;
                                      },
                                      li: ({ node, children, ...props }) => {
                                        return <li className="leading-[1.8] pl-1.5 text-[15.5px] md:text-[16.5px] text-[#e4e4e7]" {...props}>{children}</li>;
                                      },
                                      strong: ({ node, children, ...props }) => {
                                        return <strong className="font-bold text-white tracking-[0.01em]" {...props}>{children}</strong>;
                                      },
                                      b: ({ node, children, ...props }) => {
                                        return <b className="font-bold text-white tracking-[0.01em]" {...props}>{children}</b>;
                                      },
                                      blockquote: ({ node, children, ...props }) => {
                                        return <blockquote className="border-l-4 border-cyan-500 bg-[#222424]/80 pl-5 py-4 my-6 rounded-r-2xl text-zinc-200 italic text-[15.5px] md:text-[16.5px] leading-relaxed shadow-sm" {...props}>{children}</blockquote>;
                                      },
                                      table: ({ node, children, ...props }) => {
                                        return (
                                          <div className="overflow-x-auto my-6 rounded-2xl border border-zinc-700/80 shadow-xl">
                                            <table className="w-full text-left border-collapse bg-[#1c1e1e]" {...props}>{children}</table>
                                          </div>
                                        );
                                      },
                                      th: ({ node, children, ...props }) => {
                                        return <th className="bg-[#262828] text-white font-bold px-4 py-3.5 border-b border-zinc-700 text-xs md:text-sm tracking-wider uppercase" {...props}>{children}</th>;
                                      },
                                      td: ({ node, children, ...props }) => {
                                        return <td className="px-4 py-3.5 border-b border-zinc-800 text-zinc-200 text-[14.5px] md:text-[15.5px] leading-relaxed" {...props}>{children}</td>;
                                      }
                                    }}
                                  >
                                    {transformCitationsInMarkdown(stripLeadingQueryTitle(turn.report.markdown_content), turnSources)}
                                  </ReactMarkdown>

                                  {/* ChatGPT-style Glowing Streaming Pulse Indicator */}
                                  {isTurnLoading && (
                                    <div className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 text-xs font-mono shadow-lg shadow-cyan-950/50 backdrop-blur-sm">
                                      <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_8px_#22d3ee]"></span>
                                      </span>
                                      <span className="tracking-wide">Synthesizing intelligence...</span>
                                    </div>
                                  )}

                                  {/* Research Completion Metadata Footer */}
                                  {!isTurnLoading && turn.report && (
                                    <div className="mt-8 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400 font-medium">
                                      <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></span>
                                        <span className="text-zinc-300 font-medium">
                                          {turn.duration_seconds || turn.report?.duration_seconds
                                            ? `Completed in ${turn.duration_seconds || turn.report?.duration_seconds}s`
                                            : durationSeconds && isLatest
                                            ? `Completed in ${formatTime(durationSeconds)}`
                                            : "Completed"}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3 text-zinc-500 text-[11px] font-mono">
                                        {turn.plan?.sub_tasks && (
                                          <>
                                            <span>{turn.plan.sub_tasks.length} subtasks verified</span>
                                            <span>•</span>
                                          </>
                                        )}
                                        <span>{turnSources.length} sources synthesized</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : turn.report.error ? (
                                <div className="text-red-400 bg-red-950/40 p-4 rounded-xl border border-red-900/50 text-sm">
                                  Research Error: {turn.report.error}
                                </div>
                              ) : (
                                <p className="text-zinc-500 italic">Synthesizing report content...</p>
                              )}
                            </article>
                          </div>
                        ) : null}
                      </div>

                      {/* Right Column: Google AI Overview Style Sources Rail */}
                      <div className="lg:col-span-4 xl:col-span-3 order-1 lg:order-2 lg:sticky lg:top-4">
                        <div className="w-full bg-[#1e2020]/90 border border-zinc-800/80 rounded-2xl p-4 shadow-lg flex flex-col max-h-[calc(100vh-140px)]">
                          <div className="flex items-center justify-between mb-3 px-1 shrink-0">
                            <span className="text-sm md:text-[15px] font-semibold text-zinc-200">
                              Sources
                            </span>
                          </div>

                          {!turnSources.length && isTurnLoading ? (
                            <div className="flex flex-col items-center justify-center gap-3 text-zinc-300 text-sm py-8 bg-[#242626] rounded-2xl p-4 border border-zinc-800">
                              <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
                              <span>Discovering optimal sources...</span>
                            </div>
                          ) : (
                            <div
                              className="flex flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1 custom-scrollbar"
                              style={{ overscrollBehavior: 'contain' }}
                            >
                              {(showAllSources ? turnSources : turnSources.slice(0, 4)).map((s, i) => {
                                try {
                                  const urlObj = new URL(s.url);
                                  const domain = urlObj.hostname.replace('www.', '');
                                  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
                                  return (
                                    <a
                                      href={s.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      key={i}
                                      className="group flex items-start gap-3 bg-[#242626] hover:bg-[#2f3232] border border-zinc-700/70 hover:border-cyan-500/60 transition-all duration-200 rounded-2xl p-3 shadow-md hover:shadow-cyan-950/20"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-1.5 mb-1.5">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-4.5 h-4.5 rounded-md bg-[#181a1a] flex items-center justify-center shrink-0 overflow-hidden border border-zinc-700/80 p-0.5 shadow-sm">
                                              <img
                                                src={favicon}
                                                alt=""
                                                className="w-3.5 h-3.5 object-contain"
                                                onError={(e: any) => {
                                                  e.target.style.display = 'none';
                                                  if (e.target.nextElementSibling) e.target.nextElementSibling.style.display = 'block';
                                                }}
                                              />
                                              <Globe className="w-3.5 h-3.5 text-cyan-400 hidden" />
                                            </div>
                                            <span className="text-xs text-zinc-300 font-semibold truncate">
                                              {domain}
                                            </span>
                                          </div>
                                        </div>
                                        <h4 className="text-[13.5px] md:text-[14px] font-medium text-zinc-100 leading-snug line-clamp-2 group-hover:text-cyan-300 transition-colors">
                                          {s.title && s.title !== s.url ? s.title : domain}
                                        </h4>
                                      </div>

                                      <div className="w-6 h-6 min-w-[24px] shrink-0 rounded-lg bg-zinc-800/90 flex items-center justify-center border border-zinc-700/70 group-hover:border-cyan-500/50 group-hover:bg-cyan-950/40 transition-colors mt-0.5">
                                        <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-cyan-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                                      </div>
                                    </a>
                                  );
                                } catch (e) {
                                  return null;
                                }
                              })}

                              {turnSources.length > 4 && (
                                <button
                                  onClick={() => setShowAllSources(!showAllSources)}
                                  className="w-full mt-1 py-2 px-3 text-xs md:text-sm font-semibold text-zinc-200 hover:text-white bg-[#242626] hover:bg-[#2f3232] border border-zinc-700/80 hover:border-cyan-500/70 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-md hover:shadow-cyan-950/20 active:scale-98 cursor-pointer shrink-0"
                                >
                                  <span>
                                    {showAllSources
                                      ? "Show less"
                                      : "Show all sources"}
                                  </span>
                                  <ChevronRight
                                    className={`w-3.5 h-3.5 text-cyan-400 transition-transform duration-200 ${showAllSources ? "-rotate-90" : "rotate-90"
                                      }`}
                                  />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>

            {/* Pinned Bottom Follow-up Input Bar - Minimal Sleek Dock Outside Scrollable Area */}
            <div className="shrink-0 w-full bg-[#1a1c1c]/95 backdrop-blur-md border-t border-zinc-800/80 py-2.5 px-4 sm:px-6 lg:px-8 xl:px-10 z-20 shadow-2xl">
              <div className="mx-auto w-full max-w-[1600px] 2xl:max-w-[1720px]">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8">
                  <div className="lg:col-span-8 xl:col-span-9 space-y-2.5">
                    {/* Suggested Follow-up Inquiries attached directly above the input query box */}
                    {(() => {
                      if (loading) return null;
                      const activeTurn = (pipelineData.turns && pipelineData.turns.length > 0)
                        ? pipelineData.turns[pipelineData.turns.length - 1]
                        : pipelineData;

                      const queryText = activeTurn?.query || pipelineData.query || "";
                      const reportMd = activeTurn?.report?.markdown_content || pipelineData.report?.markdown_content || "";
                      const relatedQs = activeTurn?.report?.related_questions || pipelineData.report?.related_questions;

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
                                onClick={() => executeSearch(topic, effortLevel)}
                                className="w-full text-left bg-[#242626] hover:bg-[#2c2f2f] border border-zinc-700/70 hover:border-cyan-500/60 text-zinc-200 hover:text-white px-3.5 py-2 rounded-xl transition-all duration-200 flex items-start gap-2.5 shadow-sm hover:shadow-cyan-950/20 active:scale-[0.99] group cursor-pointer disabled:opacity-50"
                              >
                                <span className="text-cyan-400 font-mono text-sm shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform">↳</span>
                                <span className="flex-1 text-xs md:text-[13px] leading-snug font-medium text-zinc-200 group-hover:text-white line-clamp-2">{topic}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    <form
                      onSubmit={handleRunPipeline}
                      className={`bg-[#242626] rounded-2xl p-2 md:p-2.5 shadow-2xl border transition-all duration-300 relative ${stickyInputFocused
                          ? "border-cyan-500/70 shadow-cyan-500/10 ring-1 ring-cyan-500/30"
                          : "border-zinc-700/80 hover:border-zinc-600"
                        }`}
                    >
                      {/* Floating Slash Command Menu for Sticky Follow-up Input */}
                      <AnimatePresence>
                        {query.startsWith("/") && !query.includes(" ") && filteredSlashCommands.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, y: 6, scale: 0.99 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 6, scale: 0.99 }}
                            className="absolute bottom-full mb-2.5 left-0 w-full max-w-lg bg-[#1e2020] border border-zinc-700/80 rounded-2xl shadow-2xl p-1.5 z-50 text-left max-h-[45vh] overflow-y-auto custom-scrollbar"
                          >
                            <div className="px-3 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between border-b border-zinc-800 pb-2 mb-1">
                              <span className="flex items-center gap-1.5 text-zinc-300">
                                <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                                <span>Commands & Thinking Depth</span>
                              </span>
                              <span className="text-[10px] text-zinc-500 font-mono">Navigate with arrows • Press Enter</span>
                            </div>

                            <div className="space-y-0.5">
                              {filteredSlashCommands.map((cmd, idx) => {
                                const isSelected = (slashSelectedIndex % filteredSlashCommands.length) === idx;
                                return (
                                  <button
                                    key={cmd.id}
                                    type="button"
                                    onClick={() => {
                                      setEffortLevel(cmd.effort);
                                      setQuery("");
                                    }}
                                    onMouseEnter={() => setSlashSelectedIndex(idx)}
                                    className={`w-full text-left p-2 rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                                      isSelected
                                        ? "bg-[#2c2f2f] text-white"
                                        : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono text-xs text-zinc-100 font-semibold">{cmd.command}</span>
                                          <span className="text-xs font-semibold text-zinc-200">{cmd.name}</span>
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
                            e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 38), 160)}px`;
                          }}
                          onFocus={() => setStickyInputFocused(true)}
                          onBlur={() => setStickyInputFocused(false)}
                          onKeyDown={(e) => {
                            const isSlashActive = query.startsWith("/") && !query.includes(" ") && filteredSlashCommands.length > 0;
                            if (isSlashActive) {
                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashCommands.length);
                                return;
                              }
                              if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setSlashSelectedIndex((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
                                return;
                              }
                              if (e.key === "Enter" || e.key === "Tab") {
                                e.preventDefault();
                                const effectiveIdx = Math.min(Math.max(0, slashSelectedIndex), filteredSlashCommands.length - 1);
                                const selectedCmd = filteredSlashCommands[effectiveIdx] || filteredSlashCommands[0];
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
                                executeSearch(query, effortLevel);
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
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setStickyThinkingMenuOpen((prev) => !prev)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#242626] hover:bg-[#2b2d2d] border border-zinc-700 hover:border-zinc-600 text-zinc-200 text-xs font-medium transition-all shadow-sm cursor-pointer"
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
                              <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${stickyThinkingMenuOpen ? "rotate-180" : ""}`} />
                            </button>

                            {/* Dropdown Menu */}
                            <AnimatePresence>
                              {stickyThinkingMenuOpen && (
                                <motion.div
                                  initial={{ opacity: 0, y: 6, scale: 0.99 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: 6, scale: 0.99 }}
                                  className="absolute bottom-full mb-2 right-0 w-80 max-w-[calc(100vw-32px)] bg-[#1e2020] border border-zinc-700/80 rounded-2xl shadow-2xl p-1.5 z-50 text-left max-h-[45vh] overflow-y-auto custom-scrollbar"
                                >
                                  <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between border-b border-zinc-800 pb-2 mb-1">
                                    <span className="flex items-center gap-1.5 text-zinc-300">
                                      <BrainCircuit className="w-3.5 h-3.5 text-zinc-400" />
                                      <span>Thinking Effort Depth</span>
                                    </span>
                                  </div>

                                  <div className="space-y-0.5">
                                    <button
                                      type="button"
                                      onClick={() => { setEffortLevel("low"); setStickyThinkingMenuOpen(false); }}
                                      className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                                        effortLevel === "low"
                                          ? "bg-[#2c2f2f] text-white"
                                          : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                      }`}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-semibold">Quick Scan</span>
                                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">Quick</span>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Rapid preliminary overview & multi-source scan</p>
                                      </div>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => { setEffortLevel("medium"); setStickyThinkingMenuOpen(false); }}
                                      className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                                        effortLevel === "medium"
                                          ? "bg-[#2c2f2f] text-white"
                                          : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                      }`}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-semibold">Deep Research</span>
                                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">Standard</span>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Comprehensive multi-step analysis & citation verification</p>
                                      </div>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => { setEffortLevel("high"); setStickyThinkingMenuOpen(false); }}
                                      className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                                        effortLevel === "high"
                                          ? "bg-[#2c2f2f] text-white"
                                          : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                      }`}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-semibold">Exhaustive Dossier</span>
                                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">Exhaustive</span>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Deep recursive search & multi-perspective verification</p>
                                      </div>
                                    </button>

                                    <div className="my-1 border-t border-zinc-800" />

                                    <button
                                      type="button"
                                      onClick={() => { setEffortLevel("chat"); setStickyThinkingMenuOpen(false); }}
                                      className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                                        effortLevel === "chat"
                                          ? "bg-[#2c2f2f] text-white"
                                          : "hover:bg-[#262828] text-zinc-300 hover:text-white"
                                      }`}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-semibold">Fast Chat Mode</span>
                                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#262828] text-zinc-400 font-mono border border-zinc-700/60">Chat</span>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Conversational answers grounded in research dossiers</p>
                                      </div>
                                    </button>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          <button
                            type="submit"
                            disabled={loading || !query.trim()}
                            title={loading ? "Processing..." : "Send query"}
                            className="bg-white hover:bg-zinc-200 text-black p-2 rounded-full transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed shadow-md hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer disabled:hover:scale-100"
                          >
                            <ChevronRight className="w-4.5 h-4.5" />
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showLogoutModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLogoutModal(false)}
              className="fixed inset-0 bg-black/75 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#1e2022] p-6 shadow-2xl shadow-black/60 z-10"
            >
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                  <LogOut className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">Sign Out</h3>
                  <p className="text-xs text-zinc-400">Deep Research AI Platform</p>
                </div>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed mb-6">
                Are you sure you want to sign out of <span className="font-semibold text-cyan-400">{user?.full_name || user?.email}</span>? You can sign back in anytime to access your research history and workspaces.
              </p>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowLogoutModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 hover:bg-zinc-800/80 border border-zinc-700/80 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-500 shadow-md shadow-red-950/50 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      {sessionToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#2a2c2c] border border-zinc-700/50 rounded-xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-zinc-200 mb-2">Delete chat?</h3>
            <p className="text-sm text-zinc-400 mb-6">This will delete the chat history. This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setSessionToDelete(null)}
                className="px-4 py-2 rounded-md text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleDeleteSession(sessionToDelete);
                  setSessionToDelete(null);
                }}
                className="px-4 py-2 rounded-md text-sm font-medium bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ChatGPT Style Search Modal / Command Palette */}
      <AnimatePresence>
        {searchModalOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSearchModalOpen(false)}
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
                  placeholder="Search..."
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
                  onClick={() => setSearchModalOpen(false)}
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
                          const isCurrent = pipelineData?.id === s.id && activeTab === "current";
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                handleSelectSession(s);
                                setSearchModalOpen(false);
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
                              handleSelectSession(s);
                              setSearchModalOpen(false);
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
                        No matching researches found for "{modalSearchQuery}"
                      </div>
                    ) : (
                      modalFilteredHistory.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            handleSelectSession(s);
                            setSearchModalOpen(false);
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

      {/* Enterprise Authentication Modal */}
      <AuthModal isOpen={authModalOpen && !token && !getAuthToken()} initialMode={authModalMode} onClose={closeAuthModal} />

    </div>
  );
}
