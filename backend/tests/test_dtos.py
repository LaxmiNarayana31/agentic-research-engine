import pytest
from app.dtos.planner_dto import PlannerSubTask, PlannerOutput
from app.dtos.researcher_dto import ResearchFinding
from app.dtos.verifier_dto import ClaimVerificationResult
from app.dtos.report_dto import FinalReport

def test_planner_dto_validation():
    task = PlannerSubTask(
        task_id="st_1",
        description="Investigate ASML High-NA EUV lithography systems.",
        required_tools=["tavily_search"],
        search_depth="advanced"
    )
    assert task.task_id == "st_1"
    assert "tavily_search" in task.required_tools

    plan = PlannerOutput(
        research_query="High-NA EUV semiconductor analysis",
        sub_tasks=[task],
        total_tasks=1
    )
    assert len(plan.sub_tasks) == 1
    assert plan.research_query == "High-NA EUV semiconductor analysis"

def test_research_finding_dto():
    finding = ResearchFinding(
        task_id="st_1",
        summary="High-NA EUV operates at 0.55 NA.",
        sources=["https://asml.com"],
        raw_data={"content": "ASML EXE:5000 specification"},
        used_model="gemini-2.5-flash"
    )
    assert finding.task_id == "st_1"
    assert len(finding.sources) == 1
    assert "content" in finding.raw_data

def test_verifier_dto():
    verification = ClaimVerificationResult(
        claim="High-NA EUV operates at 0.55 NA.",
        is_supported=True,
        entailment_score=0.95,
        verifier_notes="Verified via source documentation."
    )
    assert verification.is_supported is True
    assert verification.entailment_score == 0.95

def test_final_report_dto():
    report = FinalReport(
        title="High-NA EUV Research Report",
        markdown_content="# Research Report\n\nContent here.",
        citation_count=1,
        bibliography=[{"url": "https://asml.com", "title": "ASML"}],
        verification_score=0.92,
        related_questions=["What is the next generation after High-NA?"]
    )
    assert report.title == "High-NA EUV Research Report"
    assert report.verification_score == 0.92
    assert len(report.related_questions) == 1
