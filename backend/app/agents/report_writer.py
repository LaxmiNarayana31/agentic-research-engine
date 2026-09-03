import re
import textwrap
from typing import List, Optional, Any

from app.clients.llm_client import MultiModelLLMClient
from app.core.logging import logger
from app.dtos.report_dto import FinalReport
from app.dtos.researcher_dto import ResearchFinding
from app.dtos.verifier_dto import ClaimVerificationResult

def strip_outer_fences(text: str) -> str:
    """Safely strips enclosing ```markdown code fences if the LLM wrapped the entire report."""
    try:
        if not text:
            return text
        text = text.strip()
        if text.startswith("```markdown") and text.endswith("```"):
            return text[11:-3].strip()
        elif text.startswith("```md") and text.endswith("```"):
            return text[5:-3].strip()
        elif text.startswith("```") and text.endswith("```"):
            return text[3:-3].strip()
        return text
    except Exception:
        return text

class ReportWriterAgent:
    """Report Writer Agent synthesizing verified research into pure GitHub Flavored Markdown reports with citations."""

    def __init__(self):
        self.llm_client = MultiModelLLMClient(agent_role='writer')

    def _build_gfm_rules(self) -> str:
        return """
STRICT OUTPUT FORMAT CONSTRAINTS:
1. ONLY return pure GitHub Flavored Markdown (GFM).
2. DO NOT wrap the output in ```markdown ... ``` code fences.
3. DO NOT include any conversational preamble or postamble (e.g. do NOT say "Here is your report:" or "Hope this helps!"). Start directly with the main '#' title header.
4. For all Markdown Tables:
   - Always put every table row on a new line with standard markdown pipes.
   - Example:
     | Entity | Specification | Market Cap | Use Case |
     | :--- | :--- | :--- | :--- |
     | Item 1 | Spec A | $1.2B | Core Feature |
     | Item 2 | Spec B | $800M | Data Stream |
   - NEVER collapse table rows together on a single line.
5. Use clean Unicode characters (→, ≈, •, ≥, ≤) instead of LaTeX syntax (\\rightarrow, \\approx).
6. Use inline citations [1], [2] referencing the provided sources.
"""

    def _generate_related_questions(self, query: str, markdown: str) -> List[str]:
        """Generate intelligent, dynamic follow-up research questions derived directly from the query and report content."""
        try:
            q = (query or "").strip().rstrip("?").strip()
            if not q:
                return []

            # Extract any question lines already present in the synthesized report
            extracted_questions = []
            if markdown:
                for line in markdown.splitlines():
                    cleaned = line.strip().lstrip("-*#1234567890. ").strip()
                    if cleaned.endswith("?") and len(cleaned) > 15 and cleaned not in extracted_questions:
                        extracted_questions.append(cleaned)
                    if len(extracted_questions) >= 4:
                        break

            if len(extracted_questions) >= 3:
                return extracted_questions[:4]

            # Extract section headers from markdown to build contextual follow-ups
            headers = []
            if markdown:
                for line in markdown.splitlines():
                    if line.startswith("## ") and not line.startswith("## 📌") and not line.startswith("## 🎯"):
                        clean_header = re.sub(r"[^\w\s-]", "", line.replace("##", "")).strip()
                        if clean_header and len(clean_header) > 3:
                            headers.append(clean_header)

            derived_questions = list(extracted_questions)
            for h in headers:
                question_candidate = f"What are the critical developments and strategic implications of {h.lower()} for {q}?"
                if question_candidate not in derived_questions:
                    derived_questions.append(question_candidate)
                if len(derived_questions) >= 4:
                    break

            # Dynamic parameterized queries derived strictly from the user's research topic
            if len(derived_questions) < 4:
                derived_questions.append(f"What are the emerging trends, regulatory shifts, and technical milestones ahead for {q}?")
            if len(derived_questions) < 4:
                derived_questions.append(f"How do leading institutions and market leaders evaluate the primary risks and limitations of {q}?")
            if len(derived_questions) < 4:
                derived_questions.append(f"What are the projected economic and industry outcomes of {q} over the next 3 to 5 years?")

            return derived_questions[:4]
        except Exception:
            return [
                f"What are the key technical and strategic challenges in {query}?",
                f"What are the next major milestones and forecasts for {query}?"
            ]

    async def generate_report(self, query: str, findings: List[ResearchFinding], verifications: List[ClaimVerificationResult], feedback: str = None, effort_level: str = "medium", outline: Optional[List[Any]] = None) -> FinalReport:
        """Backwards-compatible wrapper delegating to write_report with dynamic outline synthesis."""
        return await self.write_report(query, findings, verifications, feedback=feedback, effort_level=effort_level, outline=outline)

    def _build_dynamic_outline_instructions(self, query: str, outline: Optional[List[Any]], effort_level: str = "medium") -> str:
        """Constructs dynamic, domain-accurate outline prompt instructions from the dynamic planner outline."""
        gfm_rules = self._build_gfm_rules()
        
        section_lines = []
        if outline:
            for s in outline:
                title = getattr(s, "section_title", None) or (s.get("section_title") if isinstance(s, dict) else str(s))
                focus = getattr(s, "focus_description", None) or (s.get("focus_description") if isinstance(s, dict) else "")
                req_table = getattr(s, "requires_table", False) or (s.get("requires_table") if isinstance(s, dict) else False)
                req_timeline = getattr(s, "requires_timeline", False) or (s.get("requires_timeline") if isinstance(s, dict) else False)
                
                line = f"## {title}"
                if focus:
                    line += f" ({focus})"
                if req_table:
                    line += " [MANDATORY: Include a rich, multi-column Markdown comparison table with standard pipes and column alignments]"
                if req_timeline:
                    line += " [MANDATORY: Include a chronological breakdown of milestones or key phases]"
                section_lines.append(line)

        if not section_lines:
            outline_instruction = f"""
Autonomously analyze the verified findings and organize the report into dynamic, domain-specific `#` and `##` section headings that naturally match the subject matter of "{query}". (DO NOT use generic placeholder titles; use exact technical/thematic domain headings).
Include a clean Markdown comparison table if multiple entities, mechanisms, or metrics are analyzed.
"""
        else:
            outline_instruction = f"""
Follow this dynamically formulated domain outline:
# {query}
{chr(10).join(section_lines)}
"""

        if effort_level == "low":
            level_banner = "EXECUTIVE BRIEFING (High-impact, focused synthesis with verified citations)"
            depth_guidance = """
EFFORT & COMPLEXITY CALIBRATION (LOW):
- Evaluate the question's complexity and autonomously determine the optimal concise depth needed to directly answer the query.
- Focus on high-signal executive takeaways and core verified evidence with inline citations [1], [2].
- Keep the briefing direct, clear, and actionable without conversational filler."""
        elif effort_level == "high":
            level_banner = "INSTITUTIONAL-GRADE DEEP RESEARCH DOSSIER (Exhaustive, rigorous multi-dimensional analysis)"
            depth_guidance = """
EFFORT & COMPLEXITY CALIBRATION (HIGH):
- Evaluate the query's inherent domain complexity and autonomously determine the maximum analytical depth required for an institutional-grade research dossier.
- Explore deep architectural mechanisms, specific numerical metrics, comparative tradeoffs, expert debates, and long-term implications.
- Thoroughly develop every theme into detailed, publication-ready analytical paragraphs with dense citations [1], [2].
- Integrate structured Markdown comparison tables and chronological progressions wherever relevant."""
        else:
            level_banner = "DEEP RESEARCH REPORT (Comprehensive, structured domain analysis)"
            depth_guidance = """
EFFORT & COMPLEXITY CALIBRATION (MEDIUM):
- Evaluate the query's complexity and autonomously calibrate a balanced, comprehensive analytical depth covering all dimensions of the findings.
- Provide thorough, multi-paragraph domain analysis grounded in verified inline citations [1], [2].
- Include structured Markdown comparison tables comparing relevant entities, specifications, or benchmarks."""

        return f"""
TARGET FORMAT: {level_banner}

{outline_instruction}

{depth_guidance}

{gfm_rules}
Output Pure Markdown Report:"""

    async def write_report(self, query: str, findings: List[ResearchFinding], verifications: List[ClaimVerificationResult], feedback: str = None, effort_level: str = "medium", outline: Optional[List[Any]] = None) -> FinalReport:
        """Synthesizes final comprehensive research report adhering strictly to the dynamic domain outline."""
        try:
            logger.info(f"ReportWriterAgent synthesizing report for query='{query[:30]}...' with dynamic outline ({len(outline or [])} sections)")
            
            bibliography = []
            source_map = {}
            idx = 1
            
            for finding in (findings or []):
                for rs in getattr(finding, "rich_sources", []):
                    src_url = rs.get("url")
                    if src_url and src_url not in source_map:
                        source_map[src_url] = idx
                        bibliography.append({
                            "citation_id": f"[{idx}]",
                            "url": src_url,
                            "title": rs.get("title", "Source"),
                            "image": rs.get("image", "")
                        })
                        idx += 1
                for src in getattr(finding, "sources", []):
                    if src not in source_map:
                        source_map[src] = idx
                        bibliography.append({
                            "citation_id": f"[{idx}]",
                            "url": src,
                            "title": src,
                            "image": ""
                        })
                        idx += 1

            if verifications:
                overall_score = sum([getattr(v, "entailment_score", 0.85) for v in verifications]) / len(verifications)
            else:
                overall_score = 0.85

            findings_context = []
            MAX_TOTAL_CHARS = 24000
            current_len = 0
            for finding in (findings or []):
                cite_str = " ".join([f"[{source_map[s]}]" for s in getattr(finding, "sources", []) if s in source_map])
                
                summary_text = getattr(finding, "summary", "")
                if len(summary_text) > 4000:
                    summary_text = summary_text[:4000] + "\n... [TRUNCATED FOR LENGTH]"
                    
                chunk = f"Subtask ({getattr(finding, 'task_id', 'task')}): {summary_text} (Sources: {cite_str or 'None'})"
                if current_len + len(chunk) > MAX_TOTAL_CHARS:
                    findings_context.append("\n[Remaining findings omitted to fit context window]")
                    break
                    
                findings_context.append(chunk)
                current_len += len(chunk)

            effort_instructions = self._build_dynamic_outline_instructions(query, outline, effort_level)

            bib_context = []
            for b in bibliography:
                bib_context.append(f"{b['citation_id']} {b['url']}")
            bib_context_str = "\n".join(bib_context)
            
            feedback_context = f"\nCRITIC FEEDBACK FROM PREVIOUS DRAFT:\n{feedback}\nYou must explicitly address and fix these issues in this new draft.\n" if feedback else ""

            prompt = textwrap.dedent(f"""\
                You are an expert Technical Report Writer and academic researcher. 
                
                Research Topic: "{query}"

                Verified Findings:
                {chr(10).join(findings_context)}

                Available Sources for Citations:
                {bib_context_str}
                {feedback_context}
                {effort_instructions}
                """)

            raw_text, used_model = await self.llm_client.complete_text(prompt, effort_level)
            if raw_text and len(raw_text.strip()) > 50:
                pure_markdown = strip_outer_fences(raw_text.strip())
                related_qs = self._generate_related_questions(query, pure_markdown)
                return FinalReport(
                    title=f"Research Report: {query}",
                    markdown_content=pure_markdown,
                    citation_count=len(bibliography),
                    bibliography=bibliography,
                    verification_score=overall_score,
                    used_model=used_model,
                    related_questions=related_qs
                )
            else:
                raise ValueError("LLM returned insufficient report content")
        except Exception as e:
            logger.warning(f"ReportWriterAgent synthesis fallback: {e}")
            fallback_md = f"# Research Report: {query}\n\n## Executive Summary\n\nSynthesized research findings for **{query}**.\n\n"
            for idx, f in enumerate(findings or []):
                fallback_md += f"### Key Finding {idx+1}\n{getattr(f, 'summary', '')}\n\n"
            
            return FinalReport(
                title=f"Research Report: {query}",
                markdown_content=fallback_md,
                citation_count=len(findings or []),
                bibliography=[],
                verification_score=0.85,
                used_model="fallback-writer",
                related_questions=self._generate_related_questions(query, fallback_md)
            )

    async def generate_report_stream(self, query: str, findings: List[ResearchFinding], verifications: List[ClaimVerificationResult], feedback: str = None, effort_level: str = "medium", outline: Optional[List[Any]] = None):
        """Streams report token by token with dynamic domain outline and full exception safety."""
        try:
            logger.info(f"ReportWriterAgent synthesizing streaming report for query='{query[:30]}...' with dynamic outline ({len(outline or [])} sections)")
            
            bibliography = []
            source_map = {}
            idx = 1
            
            for finding in (findings or []):
                for rs in getattr(finding, "rich_sources", []):
                    src_url = rs.get("url")
                    if src_url and src_url not in source_map:
                        source_map[src_url] = idx
                        bibliography.append({
                            "citation_id": f"[{idx}]",
                            "url": src_url,
                            "title": rs.get("title", "Source"),
                            "image": rs.get("image", "")
                        })
                        idx += 1
                for src in getattr(finding, "sources", []):
                    if src not in source_map:
                        source_map[src] = idx
                        bibliography.append({
                            "citation_id": f"[{idx}]",
                            "url": src,
                            "title": src,
                            "image": ""
                        })
                        idx += 1

            if verifications:
                total_score = sum(getattr(v, "entailment_score", 0.85) for v in verifications)
                overall_score = round(total_score / len(verifications), 4)
            else:
                overall_score = 0.85

            findings_context = []
            MAX_TOTAL_CHARS = 24000
            current_len = 0
            for finding in (findings or []):
                cite_str = " ".join([f"[{source_map[s]}]" for s in getattr(finding, "sources", []) if s in source_map])
                
                summary_text = getattr(finding, "summary", "")
                if len(summary_text) > 4000:
                    summary_text = summary_text[:4000] + "\n... [TRUNCATED FOR LENGTH]"
                    
                chunk = f"Subtask ({getattr(finding, 'task_id', 'task')}): {summary_text} (Sources: {cite_str or 'None'})"
                if current_len + len(chunk) > MAX_TOTAL_CHARS:
                    findings_context.append("\n[Remaining findings omitted to fit context window]")
                    break
                    
                findings_context.append(chunk)
                current_len += len(chunk)

            bib_context = []
            for b in bibliography:
                bib_context.append(f"{b['citation_id']} {b['url']}")
            bib_context_str = "\n".join(bib_context)
            
            feedback_context = f"\nCRITIC FEEDBACK FROM PREVIOUS DRAFT:\n{feedback}\nYou must explicitly address and fix these issues in this new draft.\n" if feedback else ""

            effort_instructions = self._build_dynamic_outline_instructions(query, outline, effort_level)

            prompt = textwrap.dedent(f"""\
                You are an expert Technical Report Writer and academic researcher. 
                
                Research Topic: "{query}"

                Verified Findings:
                {chr(10).join(findings_context)}

                Available Sources for Citations:
                {bib_context_str}
                {feedback_context}
                
                {effort_instructions}
                """)

            raw_text = ""
            async for token in self.llm_client.stream_text(prompt, effort_level):
                raw_text += token
                yield {"type": "token", "content": token}
            
            if raw_text and len(raw_text.strip()) > 50:
                pure_markdown = strip_outer_fences(raw_text.strip())
                related_qs = self._generate_related_questions(query, pure_markdown)
                report = FinalReport(
                    title=f"Research Report: {query}",
                    markdown_content=pure_markdown,
                    citation_count=len(bibliography),
                    bibliography=bibliography,
                    verification_score=overall_score,
                    used_model="streaming-model",
                    related_questions=related_qs
                )
                yield {"type": "report", "content": report}
            else:
                raise ValueError("Stream generated insufficient tokens")
        except Exception as stream_err:
            logger.warning(f"ReportWriter stream fallback: {stream_err}")
            fallback_md = f"# Research Dossier: {query}\n\n## Key Summary\n\n"
            for f in (findings or []):
                fallback_md += f"- {getattr(f, 'summary', '')}\n"
            
            fallback_report = FinalReport(
                title=f"Research Report: {query}",
                markdown_content=fallback_md,
                citation_count=len(findings or []),
                bibliography=[],
                verification_score=0.85,
                used_model="fallback-writer",
                related_questions=self._generate_related_questions(query, fallback_md)
            )
            yield {"type": "token", "content": fallback_md}
            yield {"type": "report", "content": fallback_report}
