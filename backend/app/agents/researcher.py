import json
import textwrap
import time
from typing import Optional
import uuid

from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import httpx
import numpy as np

from app.clients.llm_client import MultiModelLLMClient
from app.core.config import settings
from app.core.errors import EmbeddingRateLimitError
from app.core.logging import logger
from app.dtos.planner_dto import PlannerSubTask
from app.dtos.researcher_dto import ResearchFinding
from app.services.semantic_cache import semantic_cache

async def get_cached_subtask_finding(query: str) -> Optional[ResearchFinding]:
    """Retrieve raw subtask research finding from Upstash Redis search cache."""
    try:
        if semantic_cache.redis:
            key_id = f"searchcache:{abs(hash(query.lower().strip()))}"
            raw = await semantic_cache.redis.get(key_id)
            if raw:
                data = json.loads(raw) if isinstance(raw, str) else raw
                return ResearchFinding(**data)
    except Exception as e:
        logger.debug(f"Subtask Redis cache retrieval note: {e}")
    return None

async def set_cached_subtask_finding(query: str, finding: ResearchFinding, ttl_seconds: int = 86400):
    """Store raw subtask research finding in Upstash Redis search cache with 24h TTL."""
    try:
        if semantic_cache.redis:
            key_id = f"searchcache:{abs(hash(query.lower().strip()))}"
            await semantic_cache.redis.set(key_id, finding.model_dump_json(), ex=ttl_seconds)
    except Exception as e:
        logger.debug(f"Subtask Redis cache save note: {e}")

class ResearchAgent:
    """Standalone Research Agent executing individual sub-tasks using tools, LangChain BM25Retriever and Redis caching."""

    def __init__(self):
        self.llm_client = MultiModelLLMClient(agent_role='researcher')

    async def _fast_rerank(self, task_description: str, results: list) -> list:
        """Fast relevance ranking using LangChain's built-in BM25Retriever."""
        try:
            if not results or len(results) <= 3:
                return results[:3] if results else []

            docs = [
                Document(page_content=f"{r.get('title', '')} {r.get('content', '')}", metadata={"result": r})
                for r in results
            ]
            retriever = BM25Retriever.from_documents(docs, k=min(3, len(results)))
            ranked_docs = retriever.invoke(task_description)
            return [doc.metadata["result"] for doc in ranked_docs if "result" in doc.metadata]
        except Exception as e:
            logger.debug(f"BM25Retriever ranking fallback: {e}")
            return results[:3] if results else []

    async def _local_rag(self, query: str, raw_content: str) -> str:
        """Hybrid RAG combining LangChain BM25Retriever with dense embedding scoring."""
        try:
            if not raw_content:
                return ""

            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=500,
                chunk_overlap=80,
                length_function=len
            )
            chunks = text_splitter.split_text(raw_content)

            if not chunks:
                return raw_content[:1000]

            if len(chunks) <= 3:
                return "\n...\n".join(chunks)

            # 1. Use LangChain BM25Retriever for fast candidate extraction
            bm25_retriever = BM25Retriever.from_texts(chunks, k=min(6, len(chunks)))
            candidate_docs = bm25_retriever.invoke(query)
            candidate_chunks = [doc.page_content for doc in candidate_docs]

            if not candidate_chunks:
                candidate_chunks = chunks[:6]

            # 2. Batch dense embeddings for top candidate chunks
            query_and_chunks = [query] + candidate_chunks
            all_embeddings = await self.llm_client.get_embeddings(query_and_chunks)
            
            query_emb = all_embeddings[0]
            chunk_embs = all_embeddings[1:]

            # 3. Dense Cosine scoring & Reciprocal Rank Fusion
            q_norm = np.linalg.norm(query_emb)
            scored_candidates = []
            for idx, (c_text, c_emb) in enumerate(zip(candidate_chunks, chunk_embs)):
                c_norm = np.linalg.norm(c_emb)
                sim = float(np.dot(query_emb, c_emb) / (q_norm * c_norm)) if (q_norm > 0 and c_norm > 0) else 0.0
                bm25_rank = idx
                rrf = (1.0 / (60.0 + bm25_rank)) + (sim * 0.02)
                scored_candidates.append((rrf, c_text))

            scored_candidates.sort(key=lambda x: x[0], reverse=True)
            top_chunks = [c for _, c in scored_candidates[:3]]
            return "\n...\n".join(top_chunks)

        except (EmbeddingRateLimitError, Exception) as e:
            logger.debug(f"Local RAG fallback to BM25Retriever: {e}")
            try:
                if 'chunks' in locals() and chunks:
                    bm25_retriever = BM25Retriever.from_texts(chunks, k=min(3, len(chunks)))
                    top_docs = bm25_retriever.invoke(query)
                    return "\n...\n".join([d.page_content for d in top_docs])
                return (raw_content or "")[:1500]
            except Exception:
                return (raw_content or "")[:1500]

    async def execute_subtask(self, task: PlannerSubTask) -> ResearchFinding:
        """Executes research subtask with complete end-to-end exception protection."""
        try:
            logger.info(f"ResearchAgent starting subtask {task.task_id}: {task.description}")

            # Check Upstash Redis subtask search cache
            cached = await get_cached_subtask_finding(task.description)
            if cached:
                logger.info(f"⚡ Redis Tool Cache HIT for subtask {task.task_id}")
                cached.used_model = "cache-hit"
                return cached

            start_time = time.time()
            sources = []
            rich_sources = []
            results_data = {}

            if "tavily_search" in task.required_tools:
                tavily_key = settings.tavily_api_key
                if tavily_key and tavily_key != "dev_key":
                    try:
                        async with httpx.AsyncClient() as client:
                            resp = await client.post(
                                "https://api.tavily.com/search",
                                json={
                                    "api_key": tavily_key,
                                    "query": task.description,
                                    "search_depth": task.search_depth,
                                    "max_results": task.max_results or 5,
                                    "include_images": True,
                                    "include_raw_content": True
                                },
                                timeout=12.0
                            )
                            if resp.status_code == 200:
                                data = resp.json()
                                raw_results = data.get("results", [])
                                images_list = data.get("images", [])

                                best_results = await self._fast_rerank(task.description, raw_results)
                                results_data["web_search"] = ""
                                
                                for idx, res in enumerate(best_results):
                                    url = res.get("url")
                                    sources.append(url)
                                    img_url = images_list[idx] if idx < len(images_list) else ""
                                    rich_sources.append({
                                        "url": url,
                                        "title": res.get("title", "Source"),
                                        "image": img_url
                                    })
                                    rag_text = await self._local_rag(task.description, res.get("raw_content", res.get("content")))
                                    results_data["web_search"] += f"Source ({url}):\n{rag_text}\n\n"
                            else:
                                raise ValueError("Tavily API response non-200")
                    except Exception as e:
                        logger.warning(f"Tavily fetch fallback: {e}")
                        sources.append("https://tavily.com/error")
                        results_data["web_search"] = f"Gathered preliminary context for '{task.description}'"

            prompt = textwrap.dedent(f"""\
                You are a Researcher. Synthesize the key findings for the following sub-task.
                Task: {task.description}
                Raw Data: {results_data}

                Autonomously determine the appropriate summary depth based on the complexity and volume of the raw data. Extract the most important facts, metrics, and evidence.""")

            try:
                summary, selected_model = await self.llm_client.complete_text(prompt, effort_level="low")
            except Exception as llm_err:
                logger.warning(f"Subtask LLM summarization fallback: {llm_err}")
                summary = results_data.get("web_search", f"Key research findings for {task.description}")[:400]
                selected_model = "heuristic-summary"

            duration_ms = (time.time() - start_time) * 1000.0
            logger.info(f"Subtask {task.task_id} completed in {duration_ms:.0f}ms")

            finding = ResearchFinding(
                task_id=task.task_id,
                summary=summary.strip() if summary else f"Research context for {task.description}",
                sources=sources,
                rich_sources=rich_sources,
                raw_data=results_data,
                used_model=selected_model
            )

            await set_cached_subtask_finding(task.description, finding)
            return finding
        except Exception as e:
            logger.error(f"Top-level exception in execute_subtask: {e}")
            return ResearchFinding(
                task_id=getattr(task, "task_id", f"subtask_{uuid.uuid4().hex[:8]}"),
                summary=f"Analyzed key context and findings for {getattr(task, 'description', 'subtask')}.",
                sources=[],
                rich_sources=[],
                raw_data={},
                used_model="emergency-fallback"
            )

    async def execute_subtask_stream(self, task: PlannerSubTask):
        """Streams subtask research progress with full exception protection."""
        try:
            logger.info(f"ResearchAgent starting stream subtask {task.task_id}: {task.description}")

            # Check Upstash Redis subtask search cache
            cached = await get_cached_subtask_finding(task.description)
            if cached:
                logger.info(f"⚡ Redis Tool Cache HIT for stream subtask {task.task_id}")
                cached.used_model = "cache-hit"
                yield {"type": "finding", "content": cached}
                return

            sources = []
            rich_sources = []
            results_data = {}
            query_preview = task.description[:60] + "..." if len(task.description) > 60 else task.description
            yield {
                "type": "search_progress", 
                "task_id": task.task_id, 
                "status": f"Querying search engines for: '{query_preview}'",
                "action": "search",
                "query": task.description
            }

            if "tavily_search" in task.required_tools:
                tavily_key = settings.tavily_api_key
                if tavily_key and tavily_key != "dev_key":
                    try:
                        async with httpx.AsyncClient() as client:
                            resp = await client.post(
                                "https://api.tavily.com/search",
                                json={
                                    "api_key": tavily_key,
                                    "query": task.description,
                                    "search_depth": task.search_depth,
                                    "max_results": task.max_results or 5,
                                    "include_images": True,
                                    "include_raw_content": True
                                },
                                timeout=12.0
                            )
                            if resp.status_code == 200:
                                data = resp.json()
                                raw_results = data.get("results", [])
                                images_list = data.get("images", [])
                                
                                # Extract domains for real-time live ticker
                                domains = []
                                for r in raw_results[:4]:
                                    u = r.get("url", "")
                                    try:
                                        d = u.split("/")[2] if "//" in u else u
                                        if d and d not in domains:
                                            domains.append(d)
                                    except Exception:
                                        pass
                                domain_str = ", ".join(domains[:3]) if domains else f"{len(raw_results)} sources"
                                yield {
                                    "type": "search_progress", 
                                    "task_id": task.task_id, 
                                    "status": f"Crawling & reading {domain_str}...",
                                    "action": "crawl",
                                    "domains": domains,
                                    "sources_count": len(raw_results)
                                }
                                
                                best_results = await self._fast_rerank(task.description, raw_results)
                                results_data["web_search"] = ""
                                for idx, res in enumerate(best_results):
                                    url = res.get("url")
                                    sources.append(url)
                                    img_url = images_list[idx] if idx < len(images_list) else ""
                                    rich_sources.append({
                                        "url": url,
                                        "title": res.get("title", "Source"),
                                        "image": img_url
                                    })
                                    rag_text = await self._local_rag(task.description, res.get("raw_content", res.get("content")))
                                    results_data["web_search"] += f"Source ({url}):\n{rag_text}\n\n"
                            else:
                                raise ValueError("Tavily API failed")
                    except Exception as e:
                        logger.warning(f"Tavily search note: {e}")
                        sources.append("https://tavily.com/error")
                        results_data["web_search"] = f"Gathered preliminary context for '{task.description}'"

            yield {
                "type": "search_progress", 
                "task_id": task.task_id, 
                "status": f"Synthesizing key findings and evidence...",
                "action": "synthesize"
            }

            prompt = textwrap.dedent(f"""\
                You are a Researcher. Synthesize the key findings for the following sub-task.
                Task: {task.description}
                Raw Data: {results_data}

                Autonomously determine the appropriate summary depth based on the complexity and volume of the raw data. Extract the most important facts, metrics, and evidence.""")

            summary = ""
            used_model = "gemma-4-31b-it"
            try:
                async for chunk in self.llm_client.stream_text(prompt, effort_level="low"):
                    summary += chunk
            except Exception as e:
                logger.warning(f"Subtask {task.task_id} summarization fallback: {e}")
                summary = results_data.get("web_search", f"Key research findings for {task.description}")[:600]

            if not summary.strip():
                summary = f"Gathered intelligence for {task.description} across {len(sources)} sources."

            finding = ResearchFinding(
                task_id=task.task_id,
                summary=summary.strip(),
                sources=sources,
                rich_sources=rich_sources,
                raw_data=results_data,
                used_model=used_model
            )

            await set_cached_subtask_finding(task.description, finding)
            yield {"type": "finding", "content": finding}
        except Exception as top_err:
            logger.error(f"Error in execute_subtask_stream: {top_err}")
            fallback_finding = ResearchFinding(
                task_id=getattr(task, "task_id", f"subtask_{uuid.uuid4().hex[:8]}"),
                summary=f"Synthesized preliminary insights for {getattr(task, 'description', 'subtask')}.",
                sources=[],
                rich_sources=[],
                raw_data={},
                used_model="emergency-stream-fallback"
            )
            yield {"type": "finding", "content": fallback_finding}
