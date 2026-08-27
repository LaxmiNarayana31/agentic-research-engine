"use client";

import { useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [pipelineData, setPipelineData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setLoading(true);
    setError(null);
    setPipelineData(null);

    try {
      const res = await fetch("http://localhost:8001/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Pipeline execution failed");
      setPipelineData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: "1150px", margin: "0 auto", padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "0.5rem" }}>
        Enterprise Multi-Agent Research System
      </h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>
        Orchestrating Planner, Researcher, Verifier, and Report Writer Agents (Port 8001)
      </p>

      {/* Form */}
      <section style={{ background: "white", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "2rem" }}>
        <form onSubmit={handleRunPipeline} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontWeight: "500", marginBottom: "0.25rem" }}>Enterprise Research Goal</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Orchestrating multi-agent research pipelines with verification and citation engines"
              style={{ width: "100%", padding: "0.6rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
            />
          </div>
          <button type="submit" disabled={loading} style={{ background: "#2563eb", color: "white", padding: "0.75rem", borderRadius: "4px", border: "none", cursor: "pointer", fontWeight: "600" }}>
            {loading ? "Orchestrating Agents..." : "Run Multi-Agent Research System"}
          </button>
        </form>

        {error && <div style={{ marginTop: "1rem", color: "#dc2626", background: "#fef2f2", padding: "0.75rem", borderRadius: "4px" }}>{error}</div>}
      </section>

      {pipelineData && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {/* Sub-tasks Planner Grid */}
          <section style={{ background: "#f8fafc", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: "600", marginBottom: "1rem" }}>
              Planner Sub-Task Breakdown ({pipelineData.plan?.total_tasks})
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem" }}>
              {pipelineData.plan?.sub_tasks?.map((st: any) => (
                <div key={st.task_id} style={{ background: "white", padding: "1rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                    <span style={{ fontWeight: "bold", color: "#2563eb" }}>{st.task_id.toUpperCase()}</span>
                    <span style={{ fontSize: "0.75rem", background: "#e2e8f0", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>
                      Tools: {st.required_tools?.join(", ")}
                    </span>
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "#334155", margin: 0 }}>{st.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Sub-Agent Findings & Verification */}
          <section style={{ background: "white", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: "600", marginBottom: "1rem" }}>Researcher & Verifier Agent Outputs</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {pipelineData.findings?.map((f: any, i: number) => {
                const v = pipelineData.verifications?.[i];
                return (
                  <div key={i} style={{ padding: "1rem", borderRadius: "6px", border: "1px solid #e2e8f0", background: v?.is_supported ? "#f0fdf4" : "#fafafa" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#475569", marginBottom: "0.4rem" }}>
                      <span>Model: <strong>{f.used_model}</strong> | Sources: {f.sources?.join(", ")}</span>
                      {v && <span style={{ color: v.is_supported ? "#166534" : "#b45309", fontWeight: "600" }}>NLI Score: {v.entailment_score}</span>}
                    </div>
                    <p style={{ fontSize: "0.9rem", color: "#1e293b", margin: 0 }}>{f.summary}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Final Synthesized Report with Clickable Citations */}
          <section style={{ background: "white", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "bold" }}>{pipelineData.report?.title}</h2>
              <span style={{ background: "#dbeafe", color: "#1e40af", padding: "0.3rem 0.8rem", borderRadius: "20px", fontSize: "0.85rem", fontWeight: "600" }}>
                Verification Score: {((pipelineData.report?.verification_score || 0) * 100).toFixed(0)}%
              </span>
            </div>

            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.95rem", lineHeight: "1.6", color: "#1e293b", background: "#fafafa", padding: "1.25rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
              {pipelineData.report?.markdown_content}
            </pre>

            <div style={{ marginTop: "1.5rem" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: "600", marginBottom: "0.5rem" }}>Citation Bibliography ({pipelineData.report?.citation_count})</h3>
              <ul style={{ paddingLeft: "1.2rem", fontSize: "0.9rem", color: "#334155" }}>
                {pipelineData.report?.bibliography?.map((b: any, i: number) => (
                  <li key={i} style={{ marginBottom: "0.25rem" }}>
                    <strong>{b.citation_id}:</strong> {b.source}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
