import asyncio
import json
import textwrap
from typing import List

from app.clients.llm_client import MultiModelLLMClient
from app.core.logging import logger
from app.dtos.researcher_dto import ResearchFinding
from app.dtos.verifier_dto import ClaimVerificationResult


class VerificationAgent:
    """Verification Agent conducting parallel claim verification via LLM entailment analysis."""

    def __init__(self):
        self.llm_client = MultiModelLLMClient(agent_role='verifier')

    async def _verify_single_finding(self, finding: ResearchFinding) -> ClaimVerificationResult:
        """Verifies an individual research finding with full exception safety.

        On LLM failure the finding is marked as UNSUPPORTED with a zero score so
        it is never silently treated as verified evidence.
        """
        try:
            claim_text = getattr(finding, "summary", "") or ""
            raw_context = json.dumps(getattr(finding, "raw_data", {}))

            prompt = textwrap.dedent(f"""\
                You are an expert Fact Checker and Strict Citation Verifier.
                Your task is to determine if the generated CLAIM is factually supported by the RAW SOURCE DATA.

                CLAIM:
                "{claim_text}"

                RAW SOURCE DATA:
                "{raw_context}"

                Analyze the claim against the source data. Extract the EXACT verbatim quote from the RAW SOURCE DATA
                that best supports or refutes the claim.

                Return ONLY a valid JSON object matching this schema:
                {{
                  "is_supported": true or false,
                  "exact_quote": "The exact verbatim quote from the raw data that proves or disproves the claim, or null if no relevant text was found",
                  "entailment_score": float between 0.0 and 1.0,
                  "verifier_notes": "Brief explanation of the verdict"
                }}

                Scoring guidance:
                - 0.9–1.0: claim is directly and explicitly supported by a verbatim passage
                - 0.6–0.9: claim is reasonably inferable from the source data
                - 0.3–0.6: claim is weakly or only partially supported
                - 0.0–0.3: claim is unsupported or contradicted

                If raw source data is empty or too short to evaluate, set is_supported=false and entailment_score=0.0.

                JSON Response:""")

            try:
                data, used_model = await self.llm_client.complete_json(prompt, effort_level="low")
                is_supported = bool(data.get("is_supported", False))
                score = float(data.get("entailment_score", 0.0))
                notes = str(data.get("verifier_notes", f"Verified via {used_model}"))
                exact_quote = data.get("exact_quote") or None
            except Exception as e:
                logger.warning(f"Claim verification LLM failed for '{claim_text[:40]}...': {e}")
                # Verification failed — treat as UNSUPPORTED, never silently assume supported.
                return ClaimVerificationResult(
                    claim=claim_text,
                    is_supported=False,
                    entailment_score=0.0,
                    verifier_notes="Verification failed (LLM error) — claim treated as unverified.",
                    exact_quote=None
                )

            return ClaimVerificationResult(
                claim=claim_text,
                is_supported=is_supported,
                entailment_score=score,
                verifier_notes=notes,
                exact_quote=exact_quote
            )
        except Exception as top_err:
            logger.error(f"Error in _verify_single_finding: {top_err}")
            return ClaimVerificationResult(
                claim=getattr(finding, "summary", "Research finding claim"),
                is_supported=False,
                entailment_score=0.0,
                verifier_notes="Verification could not be completed — claim treated as unverified.",
                exact_quote=None
            )

    async def verify_findings(self, findings: List[ResearchFinding]) -> List[ClaimVerificationResult]:
        """Runs parallel verification across findings with full exception capture.

        Any individual finding that raises an exception is marked UNSUPPORTED (score 0.0),
        never silently promoted to verified.
        """
        try:
            if not findings:
                return []
            logger.info(f"VerificationAgent executing PARALLEL evaluation for {len(findings)} research findings...")

            tasks = [self._verify_single_finding(finding) for finding in findings]
            raw_results = await asyncio.gather(*tasks, return_exceptions=True)

            clean_results = []
            for idx, res in enumerate(raw_results):
                if isinstance(res, Exception):
                    logger.warning(f"Finding verification exception on task {idx}: {res}")
                    clean_results.append(ClaimVerificationResult(
                        claim=findings[idx].summary if idx < len(findings) else "Research finding",
                        is_supported=False,
                        entailment_score=0.0,
                        verifier_notes="Verification exception — claim treated as unverified.",
                        exact_quote=None
                    ))
                else:
                    clean_results.append(res)
            return clean_results
        except Exception as e:
            logger.error(f"Error in verify_findings: {e}")
            return [
                ClaimVerificationResult(
                    claim=f.summary,
                    is_supported=False,
                    entailment_score=0.0,
                    verifier_notes="Batch verification failed — claim treated as unverified.",
                    exact_quote=None
                ) for f in (findings or [])
            ]
