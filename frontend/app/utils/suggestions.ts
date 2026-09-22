import { DynamicSuggestion } from "../types";

export const DEFAULT_SUGGESTIONS: DynamicSuggestion[] = [
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

export const formatDuration = (totalSecs?: number | null): string => {
  if (!totalSecs || totalSecs <= 0) return "0s";
  const mins = Math.floor(totalSecs / 60);
  const remainingSecs = totalSecs % 60;
  if (mins === 0) return `${remainingSecs}s`;
  return `${mins}m ${remainingSecs < 10 ? "0" : ""}${remainingSecs}s`;
};

export const getFollowUpTopics = (
  queryText: string,
  _reportMarkdown?: string,
  relatedQs?: string[]
): string[] => {
  if (relatedQs && relatedQs.length > 0) {
    return relatedQs.slice(0, 4);
  }
  if (!queryText) return [];

  const qClean = queryText.replace(/[?.,!]/g, "").trim();
  const lower = queryText.toLowerCase();

  if (
    lower.includes("semiconductor") ||
    lower.includes("chip") ||
    lower.includes("asml") ||
    lower.includes("tsmc") ||
    lower.includes("lithography")
  ) {
    return [
      "What are the top technological alternatives to High-NA EUV lithography?",
      "How is China advancing domestic chip fabrication against export controls?",
      "What is the projected economic impact of TSMC fab delays in the US?",
      "What are the supply bottlenecks in advanced chip packaging (CoWoS)?"
    ];
  } else if (
    lower.includes("ai") ||
    lower.includes("model") ||
    lower.includes("llm") ||
    lower.includes("agent") ||
    lower.includes("deep learning")
  ) {
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
  } else if (
    lower.includes("market") ||
    lower.includes("economy") ||
    lower.includes("stock") ||
    lower.includes("crypto") ||
    lower.includes("finance")
  ) {
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
