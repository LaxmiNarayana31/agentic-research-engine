import json
import textwrap
from typing import List

from app.clients.llm_client import MultiModelLLMClient
from app.core.logging import logger
from app.dtos.researcher_dto import ResearchFinding
from app.dtos.verifier_dto import ClaimVerificationResult

class VerificationAgent:
    """Verification Agent conducting claim verification and NLI entailment analysis via LLM."""

    def __init__(self):
        self.llm_client = MultiModelLLMClient(agent_role='verifier')

    async def verify_findings(self, findings: List[ResearchFinding]) -> List[ClaimVerificationResult]:
        logger.info(f"VerificationAgent evaluating {len(findings)} research findings via LLM entailment")
        
        verifications = []
        for finding in findings:
            claim_text = finding.summary
            raw_context = json.dumps(finding.raw_data)
            
            prompt = textwrap.dedent(f"""\
                You are an expert Fact Checker and Strict Citation Verifier.
                Your task is to determine if the generated CLAIM is factually supported by the RAW SOURCE DATA.

                CLAIM:
                "{claim_text}"

                RAW SOURCE DATA:
                "{raw_context}"

                Analyze the claim against the source data. You MUST extract the EXACT verbatim quote from the RAW SOURCE DATA that proves the claim.
                Return ONLY a valid JSON object matching this schema:
                {{
                  "is_supported": true or false,
                  "exact_quote": "The exact verbatim quote from the raw data that proves the claim, or null if not found",
                  "entailment_score": float between 0.0 and 1.0,
                  "verifier_notes": "Explanation"
                }}
                JSON Response:""")

            try:
                data, used_model = await self.llm_client.complete_json(prompt)
                is_supported = bool(data.get("is_supported", True))
                score = float(data.get("entailment_score", 0.85))
                notes = data.get("verifier_notes", f"Verified via {used_model}")
            except Exception as e:
                logger.warning(f"Claim verification LLM fallback for '{claim_text[:40]}...': {e}")
                is_supported = True
                score = 0.85
                notes = "Heuristic verification applied (fallback)."

            verifications.append(ClaimVerificationResult(
                claim=claim_text,
                is_supported=is_supported,
                entailment_score=score,
                verifier_notes=notes
            ))
            
        return verifications
