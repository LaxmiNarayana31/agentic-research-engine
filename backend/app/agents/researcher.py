import asyncio
import ipaddress
import json
import re
import socket
import textwrap
import time
from typing import Optional
from urllib.parse import urlparse
import uuid

from langchain_text_splitters import RecursiveCharacterTextSplitter
import httpx
import numpy as np
from rank_bm25 import BM25Okapi

from app.clients.llm_client import MultiModelLLMClient
from app.core.config import settings
from app.core.logging import logger
from app.dtos.planner_dto import PlannerSubTask
from app.dtos.researcher_dto import ResearchFinding
from app.services.semantic_cache import semantic_cache

def _tokenize_text(text: str) -> list:
    """Fast alphanumeric lowercase tokenizer for BM25 ranking."""
    if not text:
        return []
    return re.findall(r"\w+", text.lower())

def is_safe_url(url: str) -> bool:
    """
    MAANG Staff-grade SSRF Guard.
    Blocks private IP addresses, loopback, link-local, cloud metadata services (e.g. AWS/GCP 169.254.169.254),
    and non-HTTP(S) schemes.
    """
    try:
        if not url or not isinstance(url, str):
            return False
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        
        hostname = parsed.hostname
        if not hostname:
            return False

        lower_host = hostname.lower()
        if lower_host in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal", "instance-data"):
            logger.warning(f"🛡️ SSRF Guard BLOCKED request to restricted host '{hostname}' for URL: {url}")
            return False

        # If hostname is directly an IP literal
        try:
            direct_ip = ipaddress.ip_address(hostname)
            if (
                direct_ip.is_private or
                direct_ip.is_loopback or
                direct_ip.is_link_local or
                direct_ip.is_multicast or
                direct_ip.is_reserved or
                direct_ip.is_unspecified or
                str(direct_ip) == "169.254.169.254"
            ):
                logger.warning(f"🛡️ SSRF Guard BLOCKED request to restricted IP {direct_ip} for URL: {url}")
                return False
            return True
        except ValueError:
            pass  # It is a domain name, proceed to DNS resolution

        # Resolve IP addresses for hostname
        addr_info = socket.getaddrinfo(hostname, None)
        for entry in addr_info:
            ip_str = entry[4][0]
            ip = ipaddress.ip_address(ip_str)
            if (
                ip.is_private or
                ip.is_loopback or
                ip.is_link_local or
                ip.is_multicast or
                ip.is_reserved or
                ip.is_unspecified or
                str(ip) == "169.254.169.254"
            ):
                logger.warning(f"🛡️ SSRF Guard BLOCKED request to restricted IP {ip_str} for URL: {url}")
                return False

        return True
    except Exception as e:
        logger.debug(f"SSRF validation note for {url}: {e}")
        return False

async def _fetch_page_content(url: str, timeout: float = 3.5) -> str:
    """Fast async web scraper with SSRF protection extracting readable article text.

    Follows redirects manually so every hop is re-validated by is_safe_url before
    the next request is issued.  This prevents open-redirect chains that land on
    a private/metadata IP that passed the initial check.
    """
    if not url or not url.startswith("http"):
        return ""

    # Pre-flight SSRF check on the initial URL
    if not is_safe_url(url):
        return ""

    MAX_REDIRECTS = 5
    current_url = url
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
        # follow_redirects=False — we handle each hop manually so we can re-run
        # is_safe_url on the redirect target before issuing the next request.
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            for _ in range(MAX_REDIRECTS):
                resp = await client.get(current_url, headers=headers)

                if resp.status_code in (301, 302, 303, 307, 308):
                    location = resp.headers.get("location", "")
                    if not location:
                        return ""
                    # Resolve relative redirects against the current URL
                    if location.startswith("/"):
                        parsed = urlparse(current_url)
                        location = f"{parsed.scheme}://{parsed.netloc}{location}"
                    # Re-validate the redirect target before following it
                    if not is_safe_url(location):
                        logger.warning(f"🛡️ SSRF Guard BLOCKED redirect target: {location}")
                        return ""
                    current_url = location
                    continue

                if resp.status_code != 200:
                    return ""

                html = resp.text
                # Remove scripts, styles, header, footer, nav, noscript, svg
                html = re.sub(r"<(script|style|header|footer|nav|svg|noscript)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
                # Remove remaining HTML tags
                text = re.sub(r"<[^>]+>", " ", html)
                # Normalize whitespace
                text = re.sub(r"\s+", " ", text).strip()
                return text[:6000] if len(text) > 6000 else text

            logger.warning(f"SSRF Guard: too many redirects for {url}")
            return ""
    except Exception as e:
        logger.debug(f"Article scraper note for {url}: {e}")
        return ""

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
    """Standalone Research Agent executing individual sub-tasks using multi-engine search, native BM25Okapi and Redis caching."""

    def __init__(self):
        self.llm_client = MultiModelLLMClient(agent_role='researcher')

    async def _search_duckduckgo(self, query: str, max_results: int = 5) -> list:
        """Fallback web search using DuckDuckGo (free, zero API key requirement) with async article scraping."""
        try:
            try:
                from ddgs import DDGS
            except ImportError:
                import warnings
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    from duckduckgo_search import DDGS

            def _ddg_sync():
                import warnings
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    with DDGS() as ddgs:
                        return list(ddgs.text(query, max_results=max_results))

            results = await asyncio.to_thread(_ddg_sync)
            normalized = []
            for r in results:
                u = r.get("href") or r.get("link") or ""
                snippet = r.get("body") or r.get("snippet") or ""
                if u:
                    normalized.append({
                        "title": r.get("title") or "Source",
                        "url": u,
                        "content": snippet,
                        "raw_content": snippet
                    })

            # Fast concurrent page scraping for top results to ensure rich RAG context
            top_candidates = [item for item in normalized[:3] if len(item.get("content", "")) < 300]
            if top_candidates:
                scrape_tasks = [_fetch_page_content(item["url"]) for item in top_candidates]
                scraped_texts = await asyncio.gather(*scrape_tasks, return_exceptions=True)
                for item, page_text in zip(top_candidates, scraped_texts):
                    if isinstance(page_text, str) and len(page_text) > 150:
                        item["raw_content"] = page_text
                        item["content"] = page_text[:500]

            return normalized
        except Exception as e:
            logger.warning(f"DuckDuckGo search fallback notice: {e}")
            return []

    async def _fast_rerank(self, task_description: str, results: list) -> list:
        """Fast relevance ranking using native rank_bm25 BM25Okapi."""
        try:
            if not results or len(results) <= 3:
                return results[:3] if results else []

            tokenized_corpus = [
                _tokenize_text(f"{r.get('title', '')} {r.get('content', '')}")
                for r in results
            ]
            bm25 = BM25Okapi(tokenized_corpus)
            tokenized_query = _tokenize_text(task_description)
            scores = bm25.get_scores(tokenized_query)
            top_k = min(3, len(results))
            top_indices = np.argsort(scores)[::-1][:top_k]
            return [results[i] for i in top_indices]
        except Exception as e:
            logger.debug(f"BM25Okapi ranking fallback: {e}")
            return results[:3] if results else []

    async def _hybrid_rag(self, query: str, raw_content: str) -> str:
        """Hybrid retrieval: BM25 lexical ranking fused with dense cosine similarity via RRF.

        Pipeline
        --------
        1. Split the scraped page into 500-char overlapping chunks.
        2. Score every chunk with BM25 against the query tokens   → bm25_rank[i]
        3. Embed all chunks + the query with Gemini Embedding API → dense_rank[i]
        4. Fuse both rank lists with Reciprocal Rank Fusion (k=60):
               rrf[i] = 1/(k + bm25_rank[i]) + 1/(k + dense_rank[i])
        5. Return the top-3 chunks by fused score for the LLM prompt.

        Dense embeddings are obtained in a single batched API call to minimise
        latency. If the embedding API is unavailable or rate-limited, the method
        falls back to BM25-only ranking so research continues uninterrupted.
        """
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

            TOP_K = 3
            RRF_K = 60  # standard RRF constant

            # ── Step 1: BM25 ranking ──────────────────────────────────────────
            tokenized_chunks = [_tokenize_text(c) for c in chunks]
            bm25 = BM25Okapi(tokenized_chunks)
            tokenized_query = _tokenize_text(query)
            bm25_scores = bm25.get_scores(tokenized_query)
            # bm25_rank[i] = rank position of chunk i in BM25 ordering (0 = best)
            bm25_order = np.argsort(bm25_scores)[::-1]
            bm25_rank = np.empty(len(chunks), dtype=np.float32)
            for pos, idx in enumerate(bm25_order):
                bm25_rank[idx] = pos + 1  # 1-indexed

            # ── Step 2: Dense embedding + cosine similarity ───────────────────
            dense_rank = None
            try:
                # Embed all chunks + the query in one batched call
                all_texts = chunks + [query]
                all_vecs = await self.llm_client.get_embeddings(all_texts)
                chunk_vecs = np.array(all_vecs[:-1], dtype=np.float32)
                query_vec  = np.array(all_vecs[-1],  dtype=np.float32)

                # L2-normalise so dot product == cosine similarity
                chunk_norms = np.linalg.norm(chunk_vecs, axis=1, keepdims=True)
                query_norm  = np.linalg.norm(query_vec)
                # Avoid divide-by-zero
                chunk_vecs_n = chunk_vecs / np.where(chunk_norms == 0, 1, chunk_norms)
                query_vec_n  = query_vec  / (query_norm if query_norm > 0 else 1)

                cosine_scores = chunk_vecs_n @ query_vec_n  # shape: (n_chunks,)

                dense_order = np.argsort(cosine_scores)[::-1]
                dense_rank = np.empty(len(chunks), dtype=np.float32)
                for pos, idx in enumerate(dense_order):
                    dense_rank[idx] = pos + 1
                logger.debug(f"Hybrid RAG: dense embeddings obtained for {len(chunks)} chunks")
            except Exception as emb_err:
                logger.warning(f"Hybrid RAG: embedding failed, falling back to BM25-only ({emb_err})")

            # ── Step 3: Reciprocal Rank Fusion ───────────────────────────────
            if dense_rank is not None:
                rrf_scores = (
                    1.0 / (RRF_K + bm25_rank) +
                    1.0 / (RRF_K + dense_rank)
                )
            else:
                # BM25-only fallback — still works, just single-signal
                rrf_scores = 1.0 / (RRF_K + bm25_rank)

            top_indices = np.argsort(rrf_scores)[::-1][:TOP_K]
            # Return chunks in original document order for readability
            top_indices_sorted = sorted(top_indices.tolist())
            top_chunks = [chunks[i] for i in top_indices_sorted]

            retrieval_mode = "hybrid BM25+dense RRF" if dense_rank is not None else "BM25-only (dense unavailable)"
            logger.debug(f"Hybrid RAG: selected {len(top_chunks)} chunks via {retrieval_mode}")
            return "\n...\n".join(top_chunks)

        except Exception as e:
            logger.warning(f"Hybrid RAG error, falling back to raw content slice: {e}")
            try:
                if 'chunks' in locals() and chunks:
                    tokenized_chunks = [_tokenize_text(c) for c in chunks]
                    bm25 = BM25Okapi(tokenized_chunks)
                    scores = bm25.get_scores(_tokenize_text(query))
                    top_k = min(3, len(chunks))
                    top_indices = np.argsort(scores)[::-1][:top_k]
                    return "\n...\n".join([chunks[i] for i in sorted(top_indices)])
                return (raw_content or "")[:1500]
            except Exception:
                return (raw_content or "")[:1500]

    async def execute_subtask(self, task: PlannerSubTask) -> ResearchFinding:
        """Executes research subtask with complete multi-engine search and fallback protection."""
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

            if "tavily_search" in task.required_tools or "web_search" in task.required_tools:
                raw_results = []
                images_list = []
                tavily_key = settings.tavily_api_key

                # 1. Attempt Tavily Search if key configured
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
                            else:
                                logger.warning(f"Tavily returned non-200 ({resp.status_code}), triggering DuckDuckGo fallback")
                    except Exception as e:
                        logger.warning(f"Tavily fetch failed: {e}, triggering DuckDuckGo fallback")

                # 2. Resilient Multi-Engine Fallback: DuckDuckGo Search
                if not raw_results:
                    logger.info(f"Executing DuckDuckGo search fallback for: '{task.description}'")
                    raw_results = await self._search_duckduckgo(task.description, max_results=task.max_results or 5)

                if raw_results:
                    best_results = await self._fast_rerank(task.description, raw_results)
                    results_data["web_search"] = ""
                    
                    for idx, res in enumerate(best_results):
                        url = res.get("url")
                        if not url:
                            continue
                        sources.append(url)
                        img_url = images_list[idx] if idx < len(images_list) else ""
                        rich_sources.append({
                            "url": url,
                            "title": res.get("title", "Source"),
                            "image": img_url
                        })
                        rag_text = await self._hybrid_rag(task.description, res.get("raw_content") or res.get("content", ""))
                        results_data["web_search"] += f"Source ({url}):\n{rag_text}\n\n"
                else:
                    # No results from any search engine — record the failure honestly.
                    # Do NOT add fabricated URLs; leave sources empty so the report
                    # writer and verifier can treat this finding as unverified.
                    results_data["web_search"] = ""
                    logger.warning(f"No search results for subtask {task.task_id}: '{task.description[:60]}' — proceeding with empty evidence.")

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
                summary=f"Research failed for '{getattr(task, 'description', 'subtask')}' — no evidence collected.",
                sources=[],
                rich_sources=[],
                raw_data={"error": str(e)},
                used_model="failed"
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

            if "tavily_search" in task.required_tools or "web_search" in task.required_tools:
                raw_results = []
                images_list = []
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
                            else:
                                logger.warning(f"Tavily returned non-200 ({resp.status_code}) in stream, triggering DuckDuckGo fallback")
                    except Exception as e:
                        logger.warning(f"Tavily stream fetch note: {e}, triggering DuckDuckGo fallback")

                # Resilient DuckDuckGo Search fallback with article scraping
                if not raw_results:
                    logger.info(f"Executing DuckDuckGo search fallback for stream: '{task.description}'")
                    raw_results = await self._search_duckduckgo(task.description, max_results=task.max_results or 5)

                if raw_results:
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
                        if not url:
                            continue
                        sources.append(url)
                        img_url = images_list[idx] if idx < len(images_list) else ""
                        rich_sources.append({
                            "url": url,
                            "title": res.get("title", "Source"),
                            "image": img_url
                        })
                        rag_text = await self._hybrid_rag(task.description, res.get("raw_content") or res.get("content", ""))
                        results_data["web_search"] += f"Source ({url}):\n{rag_text}\n\n"
                else:
                    # No results from any search engine — record the failure honestly.
                    # Do NOT add fabricated URLs; leave sources empty so the report
                    # writer and verifier can treat this finding as unverified.
                    results_data["web_search"] = ""
                    logger.warning(f"No stream search results for subtask {task.task_id}: '{task.description[:60]}' — proceeding with empty evidence.")

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
                summary=f"Research stream failed for '{getattr(task, 'description', 'subtask')}' — no evidence collected.",
                sources=[],
                rich_sources=[],
                raw_data={"error": str(top_err)},
                used_model="failed"
            )
            yield {"type": "finding", "content": fallback_finding}
