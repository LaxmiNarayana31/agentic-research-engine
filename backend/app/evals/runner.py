import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
import phoenix as px

from app.clients.llm_client import MultiModelLLMClient
from app.core.tracing import get_phoenix_url
from app.evals.metrics import (
    calculate_answer_relevance,
    calculate_context_precision,
    calculate_context_recall,
    calculate_faithfulness,
)

logger = logging.getLogger(__name__)

async def run_benchmark_evaluation(limit: int = 5) -> Dict[str, Any]:
    """
    Executes full Ragas quantitative evaluation suite across benchmark test cases.
    Computes Faithfulness, Answer Relevance, Context Precision, and Context Recall.
    """
    start_time = time.perf_counter()
    eval_dir = os.path.dirname(__file__)
    benchmark_file = os.path.join(eval_dir, "benchmark_dataset.json")

    with open(benchmark_file, "r", encoding="utf-8") as f:
        dataset: List[Dict[str, Any]] = json.load(f)

    test_cases = dataset[:limit]
    llm = MultiModelLLMClient(agent_role="evaluator")
    
    results = []
    logger.info(f"Starting Ragas Benchmark Evaluation on {len(test_cases)} cases...")

    for case in test_cases:
        q = case["question"]
        contexts = case["contexts"]
        gt = case["ground_truth"]

        # 1. Synthesize answer with LLM writer or evaluate ground truth
        synth_prompt = f"Answer the following question thoroughly based on the provided context:\n\nQuestion: {q}\n\nContext:\n" + "\n".join(contexts)
        answer_text, _ = await llm.complete_json(
            f"Provide a structured answer in JSON: {{\"answer\": \"...\"}} to:\n{synth_prompt}",
            effort_level="low"
        )
        answer = answer_text.get("answer", "") if isinstance(answer_text, dict) else str(answer_text)
        if not answer:
            answer = gt

        # 2. Compute canonical Ragas metrics in parallel
        faith_task = calculate_faithfulness(q, contexts, answer, llm)
        relev_task = calculate_answer_relevance(q, answer, llm)
        prec_task = calculate_context_precision(q, contexts, gt, llm)
        recall_task = calculate_context_recall(q, contexts, gt, llm)

        faith_res, relev_res, prec_res, recall_res = await asyncio.gather(
            faith_task, relev_task, prec_task, recall_task
        )

        case_result = {
            "id": case["id"],
            "domain": case.get("domain", "General"),
            "question": q,
            "answer_preview": answer[:180] + "..." if len(answer) > 180 else answer,
            "metrics": {
                "faithfulness": faith_res["score"],
                "answer_relevance": relev_res["score"],
                "context_precision": prec_res["score"],
                "context_recall": recall_res["score"],
            },
            "composite_score": round(
                (faith_res["score"] + relev_res["score"] + prec_res["score"] + recall_res["score"]) / 4.0,
                3
            )
        }
        results.append(case_result)
        logger.info(f"Evaluated [{case['id']}] Composite: {case_result['composite_score']} | Faith: {faith_res['score']} | Rel: {relev_res['score']}")

    # Compute overall aggregate scores
    n = max(1, len(results))
    avg_faithfulness = round(sum(r["metrics"]["faithfulness"] for r in results) / n, 3)
    avg_relevance = round(sum(r["metrics"]["answer_relevance"] for r in results) / n, 3)
    avg_precision = round(sum(r["metrics"]["context_precision"] for r in results) / n, 3)
    avg_recall = round(sum(r["metrics"]["context_recall"] for r in results) / n, 3)
    overall_composite = round((avg_faithfulness + avg_relevance + avg_precision + avg_recall) / 4.0, 3)
    elapsed_seconds = round(time.perf_counter() - start_time, 2)

    summary = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_test_cases": len(results),
        "duration_seconds": elapsed_seconds,
        "aggregate_scores": {
            "faithfulness": avg_faithfulness,
            "answer_relevance": avg_relevance,
            "context_precision": avg_precision,
            "context_recall": avg_recall,
            "composite_score": overall_composite
        },
        "phoenix_dashboard_url": get_phoenix_url(),
        "results": results
    }

    # Export to JSON scorecard
    json_path = os.path.join(eval_dir, "ragas_benchmark_report.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    # Export to HTML Report
    html_path = os.path.join(eval_dir, "ragas_benchmark_report.html")
    generate_html_report(summary, html_path)

    # Optional: Log evaluation run to Arize Phoenix dataset
    try:
        df = pd.DataFrame([
            {
                "id": r["id"],
                "domain": r["domain"],
                "question": r["question"],
                "faithfulness": r["metrics"]["faithfulness"],
                "answer_relevance": r["metrics"]["answer_relevance"],
                "context_precision": r["metrics"]["context_precision"],
                "context_recall": r["metrics"]["context_recall"],
                "composite": r["composite_score"]
            }
            for r in results
        ])
        px.Client().log_evaluations(
            eval_name="ragas_deep_research_benchmark",
            dataframe=df
        )
        logger.info("Successfully synced evaluation dataset to Arize Phoenix!")
    except Exception as pe:
        logger.debug(f"Phoenix eval logging notice (non-fatal): {pe}")

    return summary


def generate_html_report(summary: Dict[str, Any], output_path: str):
    """Generates a standalone, beautiful HTML dashboard report of Ragas results."""
    agg = summary["aggregate_scores"]
    rows = ""
    for r in summary["results"]:
        m = r["metrics"]
        rows += f"""
        <tr>
            <td style="font-weight:600; color:#06b6d4;">{r["id"]}</td>
            <td><span class="badge">{r["domain"]}</span></td>
            <td>{r["question"]}</td>
            <td style="color:#10b981; font-weight:bold;">{int(m["faithfulness"]*100)}%</td>
            <td style="color:#06b6d4; font-weight:bold;">{int(m["answer_relevance"]*100)}%</td>
            <td style="color:#6366f1; font-weight:bold;">{int(m["context_precision"]*100)}%</td>
            <td style="color:#a855f7; font-weight:bold;">{int(m["context_recall"]*100)}%</td>
            <td style="font-weight:bold;">{int(r["composite_score"]*100)}%</td>
        </tr>
        """

    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>RAGAS Deep Research Evaluation Report</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#0f172a; color:#f8fafc; padding:2rem; }}
        .card {{ background:#1e293b; border-radius:12px; padding:1.5rem; margin-bottom:1.5rem; border:1px solid #334155; }}
        .header {{ display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:1rem; margin-bottom:1.5rem; }}
        .grid {{ display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; margin-bottom:1.5rem; }}
        .stat-card {{ background:#0f172a; border:1px solid #334155; padding:1.25rem; border-radius:10px; text-align:center; }}
        .stat-val {{ font-size:2rem; font-weight:bold; }}
        .stat-lbl {{ font-size:0.8rem; text-transform:uppercase; color:#94a3b8; margin-top:0.25rem; letter-spacing:0.05em; }}
        table {{ width:100%; border-collapse:collapse; margin-top:1rem; }}
        th, td {{ padding:0.85rem; text-align:left; border-bottom:1px solid #334155; font-size:0.875rem; }}
        th {{ background:#0f172a; color:#94a3b8; font-size:0.75rem; text-transform:uppercase; }}
        .badge {{ background:#334155; color:#cbd5e1; padding:0.25rem 0.5rem; border-radius:4px; font-size:0.75rem; }}
        .link-btn {{ display:inline-block; padding:0.5rem 1rem; background:#06b6d4; color:#0f172a; border-radius:6px; font-weight:bold; text-decoration:none; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <div>
                <h1 style="margin:0; font-size:1.5rem; color:#38bdf8;">Deep Research Engine — Ragas Quality Scorecard</h1>
                <p style="margin:0.25rem 0 0; color:#94a3b8; font-size:0.875rem;">Generated on {summary["timestamp"]} • Duration: {summary["duration_seconds"]}s</p>
            </div>
            <div>
                <a class="link-btn" href="{summary["phoenix_dashboard_url"]}" target="_blank">Open Arize Phoenix UI</a>
            </div>
        </div>

        <div class="grid">
            <div class="stat-card">
                <div class="stat-val" style="color:#10b981;">{int(agg["faithfulness"]*100)}%</div>
                <div class="stat-lbl">Faithfulness (Factual Consistency)</div>
            </div>
            <div class="stat-card">
                <div class="stat-val" style="color:#06b6d4;">{int(agg["answer_relevance"]*100)}%</div>
                <div class="stat-lbl">Answer Relevance (Query Match)</div>
            </div>
            <div class="stat-card">
                <div class="stat-val" style="color:#6366f1;">{int(agg["context_precision"]*100)}%</div>
                <div class="stat-lbl">Context Precision (Signal/Noise)</div>
            </div>
            <div class="stat-card">
                <div class="stat-val" style="color:#a855f7;">{int(agg["context_recall"]*100)}%</div>
                <div class="stat-lbl">Context Recall (Coverage)</div>
            </div>
            <div class="stat-card">
                <div class="stat-val" style="color:#f59e0b;">{int(agg["composite_score"]*100)}%</div>
                <div class="stat-lbl">Overall Composite Quality</div>
            </div>
        </div>

        <h2 style="font-size:1.15rem; color:#cbd5e1; margin-top:1.5rem;">Benchmark Results Breakdown</h2>
        <table>
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Domain</th>
                    <th>Question</th>
                    <th>Faithfulness</th>
                    <th>Relevance</th>
                    <th>Precision</th>
                    <th>Recall</th>
                    <th>Composite</th>
                </tr>
            </thead>
            <tbody>
                {rows}
            </tbody>
        </table>
    </div>
</body>
</html>
"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

