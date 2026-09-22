export interface SourceItem {
  url: string;
  title?: string;
  image?: string;
}

export interface ResearchFinding {
  task_id?: string;
  subtask_id?: string;
  query?: string;
  summary?: string;
  key_learnings?: string[];
  sources?: (string | { url: string; title?: string; image?: string })[];
  rich_sources?: { url: string; title?: string; image?: string }[];
  content?: string;
  [key: string]: any;
}

export interface VerificationItem {
  claim?: string;
  status?: "verified" | "contradicted" | "unverified" | string;
  confidence?: number;
  reasoning?: string;
  source?: string;
  entailment_score?: number;
  [key: string]: any;
}

export interface ReportData {
  title?: string;
  markdown_content?: string;
  bibliography?: (string | { url: string; title?: string; image?: string })[];
  sources?: (string | { url: string; title?: string; image?: string })[];
  summary?: string;
  related_questions?: string[];
  duration_seconds?: number;
  error?: string;
  is_chat?: boolean;
  [key: string]: any;
}

export interface Turn {
  query: string;
  effort_level?: string;
  plan?: any;
  findings?: ResearchFinding[];
  verifications?: VerificationItem[];
  report?: ReportData | null;
  is_chat?: boolean;
  isLive?: boolean;
  duration_seconds?: number | null;
  [key: string]: any;
}

export interface PipelineData {
  id: string;
  query: string;
  effort_level?: string;
  status?: "running" | "completed" | "error" | string;
  duration_seconds?: number | null;
  turns?: Turn[];
  plan?: any;
  findings?: ResearchFinding[];
  searchProgress?: any[];
  verifications?: VerificationItem[];
  report?: ReportData | null;
  is_chat?: boolean;
  [key: string]: any;
}

export interface ActivityLog {
  id: string;
  time: string;
  text: string;
  action?: "search" | "analyze" | "verify" | "write" | "complete" | string;
  subtask?: string;
}

export interface SlashCommand {
  id: string;
  command: string;
  aliases: string[];
  name: string;
  badge: string;
  desc: string;
  effort: string;
  mode: "research" | "chat";
}

export interface HistoryItem {
  id: string;
  query: string;
  effort_level?: string;
  status?: string;
  created_at?: string;
  turns?: Turn[];
  [key: string]: any;
}

export interface DynamicSuggestion {
  label: string;
  q: string;
  effort: string;
}
