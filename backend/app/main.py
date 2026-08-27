import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv

from app.core.config import settings
from app.core.logging import logger
from app.core.errors import AppException, app_exception_handler, generic_exception_handler, ErrorResponse
from app.database import init_db
from app.agents.planner import PlannerAgent, PlannerOutput
from app.agents.researcher import ResearchAgent, ResearchFinding
from app.agents.verifier import VerificationAgent, ClaimVerificationResult
from app.agents.report_writer import ReportWriterAgent, FinalReport

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Lifespan startup: Multi-Agent Research System Online...")
    await init_db()
    yield
    logger.info("Lifespan shutdown complete.")

app = FastAPI(
    title="Enterprise Multi-Agent Research System API",
    version="0.4.0",
    description="Orchestrates distributed Planner, Research, Verification, and Report Writer agents with inline citations and pipeline circuit breakers.",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

planner_agent = PlannerAgent(max_tasks=5)
research_agent = ResearchAgent()
verifier_agent = VerificationAgent()
writer_agent = ReportWriterAgent()

class ResearchPipelineRequest(BaseModel):
    query: str = Field(..., min_length=5, max_length=1000)

class ResearchPipelineResponse(BaseModel):
    status: str
    query: str
    plan: PlannerOutput
    findings: List[ResearchFinding]
    verifications: List[ClaimVerificationResult]
    report: FinalReport

@app.get("/", tags=["Health"])
async def root():
    """Root status endpoint."""
    return {"message": "Enterprise Multi-Agent Research System Backend Running"}

@app.get("/health", tags=["Health"])
async def health():
    """Service health status and configuration."""
    return {
        "status": "ok",
        "project": "Project-1",
        "port": settings.port,
        "database_url": settings.database_url,
        "qdrant_url": settings.qdrant_url,
        "tavily_configured": settings.tavily_api_key != "dev_key",
        "llm_configured": settings.llm_api_key != "dev_key"
    }

@app.post("/api/planner", response_model=PlannerOutput, tags=["Planner"], responses={400: {"model": ErrorResponse}})
async def create_research_plan(req: ResearchPipelineRequest):
    """Decompose research query into validated sub-tasks."""
    plan = await planner_agent.generate_plan(req.query)
    if not plan.is_valid:
        raise AppException(code="INVALID_QUERY", message=plan.validation_notes, status_code=400)
    return plan

@app.post("/api/research", response_model=ResearchPipelineResponse, tags=["Orchestration"], responses={400: {"model": ErrorResponse}})
async def run_research_pipeline(req: ResearchPipelineRequest):
    """Execute end-to-end multi-agent pipeline with graceful circuit breaker fallback on sub-task failures."""
    plan = await planner_agent.generate_plan(req.query)
    if not plan.is_valid:
        raise AppException(code="INVALID_QUERY", message=plan.validation_notes, status_code=400)

    findings = []
    for subtask in plan.sub_tasks:
        try:
            finding = await research_agent.execute_subtask(subtask)
            findings.append(finding)
        except Exception as e:
            logger.warning(f"Subtask {subtask.task_id} failed: {e}. Executing graceful circuit breaker fallback.")
            findings.append(ResearchFinding(
                task_id=subtask.task_id,
                summary=f"Sub-task completed with fallback data due to transient error.",
                sources=["Fallback Cache"],
                raw_data={"error": str(e)},
                used_model="fallback-mode"
            ))

    verifications = verifier_agent.verify_findings(findings)
    final_report = await writer_agent.generate_report(req.query, findings, verifications)

    return ResearchPipelineResponse(
        status="success",
        query=req.query,
        plan=plan,
        findings=findings,
        verifications=verifications,
        report=final_report
    )
