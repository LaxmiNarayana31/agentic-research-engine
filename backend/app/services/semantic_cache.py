import asyncio
import json
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import faiss
import numpy as np

try:
    from upstash_redis.asyncio import Redis
except ImportError:
    Redis = None

from app.core.config import settings
from app.core.logging import logger


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Calculates cosine similarity between two vectors using native NumPy."""
    try:
        va = np.ascontiguousarray(a, dtype=np.float32).flatten()
        vb = np.ascontiguousarray(b, dtype=np.float32).flatten()
        norm_a = float(np.linalg.norm(va))
        norm_b = float(np.linalg.norm(vb))
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return float(np.dot(va, vb) / (norm_a * norm_b))
    except Exception as e:
        logger.debug(f"Cosine similarity calculation note: {e}")
        return 0.0


class UpstashSemanticCache:
    """
    Semantic vector cache backed by an in-memory FAISS index with optional
    Upstash Redis persistence for TTL and cross-restart durability.

    Performance model
    -----------------
    The previous implementation rebuilt a fresh FAISS index on *every* query by
    scanning all Redis keys with KEYS *, which is O(N) on the Redis keyspace and
    blocks the event loop on large caches.

    This version maintains a single long-lived FAISS IndexFlatIP that is updated
    incrementally:
      - add entry  → append one vector to the live index (O(1) amortised).
      - query      → single FAISS search against the live index (O(N) vectors,
                     but in C++, without any Redis round-trips per query).
      - Redis      → used only for durability: write-through on store, bulk load
                     once at first query after a cold start.

    The in-memory index (_index) is the source of truth for similarity search.
    Redis is the persistence layer that survives process restarts.
    """

    def __init__(
        self,
        name: str = "llmcache",
        distance_threshold: float = 0.12,
        ttl: Optional[int] = 86400,
    ):
        url = settings.upstash_redis_rest_url
        token = settings.upstash_redis_rest_token

        # Auto-extract from single REDIS_URL if not set
        if (not url or not token) and settings.redis_url:
            try:
                parsed = urlparse(settings.redis_url)
                if parsed.hostname and parsed.password:
                    url = f"https://{parsed.hostname}"
                    token = parsed.password
            except Exception as e:
                logger.debug(f"Could not parse REDIS_URL: {e}")

        self.name = name
        self.distance_threshold = distance_threshold
        self.ttl = ttl

        # In-memory record store: key → doc dict (includes prompt_vector, response, metadata)
        self._stored_records: Dict[str, Dict[str, Any]] = {}

        # Live FAISS index — rebuilt lazily on first use / cold start.
        # None means "not yet initialised or dimension unknown".
        self._index: Optional[faiss.IndexFlatIP] = None
        self._index_keys: List[str] = []          # parallel list: index row i → record key
        self._index_dim: Optional[int] = None
        self._cold_start_loaded: bool = False      # have we pulled Redis keys into memory yet?
        self._lock = asyncio.Lock()               # serialises index mutations

        if Redis and url and token:
            try:
                self.redis = Redis(url=url, token=token)
                logger.info(
                    f"SemanticCache '{self.name}' initialised with FAISS + Redis "
                    f"[threshold={self.distance_threshold}, ttl={self.ttl}s]"
                )
            except Exception as e:
                logger.warning(f"Failed to connect to Upstash Redis: {e}")
                self.redis = None
        else:
            self.redis = None
            logger.info(
                f"SemanticCache '{self.name}' initialised in local FAISS-only mode "
                f"[threshold={self.distance_threshold}, ttl={self.ttl}s]"
            )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _init_index(self, dim: int) -> None:
        """Create a fresh empty FAISS inner-product index for the given dimension."""
        self._index = faiss.IndexFlatIP(dim)
        self._index_keys = []
        self._index_dim = dim

    def _append_to_index(self, key: str, vector: List[float]) -> None:
        """Append a single normalised vector to the live FAISS index."""
        vec = np.ascontiguousarray([vector], dtype=np.float32)
        faiss.normalize_L2(vec)
        self._index.add(vec)
        self._index_keys.append(key)

    async def _ensure_cold_start_loaded(self, dim: int) -> None:
        """
        On the very first query after startup, pull all matching Redis keys into the
        in-memory store and rebuild the FAISS index once.  Subsequent calls are
        no-ops because _cold_start_loaded is set to True.

        This is the only time we do a full Redis KEYS scan — and it happens at most
        once per process lifetime.
        """
        if self._cold_start_loaded:
            return
        self._cold_start_loaded = True  # Set early to prevent concurrent re-entry

        if not self.redis:
            return

        try:
            keys = await self.redis.keys(f"{self.name}:*")
            if not keys:
                return

            raw_records = await self.redis.mget(*keys)
            self._init_index(dim)

            for k, raw in zip(keys, raw_records):
                if not raw:
                    continue
                try:
                    doc_data = json.loads(raw) if isinstance(raw, str) else raw
                    stored_vec = doc_data.get("prompt_vector") or doc_data.get("vector")
                    if (
                        stored_vec
                        and isinstance(stored_vec, list)
                        and len(stored_vec) == dim
                    ):
                        self._stored_records[k] = doc_data
                        self._append_to_index(k, stored_vec)
                except Exception as parse_err:
                    logger.debug(f"Cold-start: error parsing cache item {k}: {parse_err}")

            logger.info(
                f"SemanticCache cold-start: loaded {len(self._index_keys)} entries "
                f"from Redis into FAISS index (dim={dim})."
            )
        except Exception as redis_err:
            logger.warning(f"SemanticCache cold-start Redis load notice: {redis_err}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_threshold(self, distance_threshold: float) -> None:
        self.distance_threshold = distance_threshold
        logger.info(
            f"SemanticCache threshold → {distance_threshold} "
            f"(similarity ≥ {1.0 - distance_threshold:.2f})"
        )

    def set_ttl(self, ttl: Optional[int] = None) -> None:
        self.ttl = ttl

    async def check(
        self,
        prompt: str,
        vector: Optional[List[float]] = None,
        num_results: int = 1,
        return_fields: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Query the live FAISS index for semantically similar prompts.

        No Redis round-trip on the hot path — the index is already in memory.
        Redis is consulted once at cold-start (see _ensure_cold_start_loaded).
        """
        if not vector:
            return []

        try:
            async with self._lock:
                q_vec = np.ascontiguousarray([vector], dtype=np.float32)
                faiss.normalize_L2(q_vec)
                dim = q_vec.shape[1]

                # First call after startup: hydrate from Redis once
                await self._ensure_cold_start_loaded(dim)

                # Initialise index if still None (no Redis entries + first store)
                if self._index is None:
                    self._init_index(dim)

                if self._index.ntotal == 0:
                    return []

                k = min(num_results, self._index.ntotal)
                D, I = self._index.search(q_vec, k)

            matches = []
            for score, idx in zip(D[0], I[0]):
                if idx < 0 or idx >= len(self._index_keys):
                    continue
                similarity = float(score)
                distance = 1.0 - similarity
                if distance <= self.distance_threshold:
                    key = self._index_keys[idx]
                    doc_data = self._stored_records.get(key, {})
                    matches.append({
                        "key": key,
                        "prompt": doc_data.get("prompt") or doc_data.get("query") or "",
                        "response": doc_data.get("response"),
                        "metadata": doc_data.get("metadata", {}),
                        "vector_distance": distance,
                        "similarity": similarity,
                        "inserted_at": doc_data.get("inserted_at"),
                        "updated_at": doc_data.get("updated_at"),
                    })

            if matches:
                best = matches[0]
                logger.info(
                    f"⚡ SemanticCache HIT: '{prompt[:45]}' → "
                    f"'{best['prompt'][:45]}' (sim={best['similarity']:.3f})"
                )
            return matches

        except Exception as e:
            logger.error(f"Error querying SemanticCache: {e}")
            return []

    async def store(
        self,
        prompt: str,
        response: Any,
        vector: Optional[List[float]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        ttl: Optional[int] = None,
    ) -> str:
        """
        Store a prompt + response + embedding in the live FAISS index and,
        optionally, persist to Redis for durability.

        The FAISS index is updated in-place — no rebuild required.
        """
        if not vector:
            return ""

        try:
            effective_ttl = ttl if ttl is not None else self.ttl
            key_id = f"{self.name}:{abs(hash(prompt.strip().lower()))}"
            now = time.time()

            doc = {
                "prompt": prompt,
                "response": response,
                "prompt_vector": [float(x) for x in vector],
                "metadata": metadata or {},
                "inserted_at": now,
                "updated_at": now,
            }

            async with self._lock:
                dim = len(vector)

                # Initialise index on first store if not yet done
                if self._index is None or self._index_dim != dim:
                    self._init_index(dim)

                # Only append to index if this key is new
                if key_id not in self._stored_records:
                    self._stored_records[key_id] = doc
                    self._append_to_index(key_id, vector)
                else:
                    # Update stored doc but don't double-add to FAISS
                    self._stored_records[key_id] = doc

            # Persist to Redis outside the lock (I/O bound)
            if self.redis:
                try:
                    if effective_ttl:
                        await self.redis.set(key_id, json.dumps(doc), ex=effective_ttl)
                    else:
                        await self.redis.set(key_id, json.dumps(doc))
                except Exception as re:
                    logger.debug(f"Redis store notice: {re}")

            logger.info(f"SemanticCache stored: '{prompt[:40]}' → key '{key_id}'")
            return key_id

        except Exception as e:
            logger.error(f"Failed to store in SemanticCache: {e}")
            return ""

    async def clear(self) -> None:
        """Invalidate all cached entries — in-memory and Redis."""
        try:
            async with self._lock:
                self._stored_records.clear()
                if self._index_dim is not None:
                    self._init_index(self._index_dim)
                self._cold_start_loaded = False

            if self.redis:
                keys = await self.redis.keys(f"{self.name}:*")
                if keys:
                    await self.redis.delete(*keys)

            logger.info(f"Cleared SemanticCache '{self.name}'.")
        except Exception as e:
            logger.error(f"Failed to clear SemanticCache: {e}")

    async def search_similar_query(
        self,
        query: str,
        query_vector: List[float],
        similarity_threshold: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        """Research pipeline adapter — wraps check() with threshold override."""
        try:
            if similarity_threshold is not None:
                self.set_threshold(1.0 - similarity_threshold)

            matches = await self.check(prompt=query, vector=query_vector, num_results=1)
            if matches:
                best = matches[0]
                metadata = best.get("metadata", {})
                return {
                    "cache_hit": True,
                    "store": "FAISS Vector Store",
                    "similarity": best["similarity"],
                    "matched_query": best["prompt"],
                    "data": {
                        "query": best["prompt"],
                        "plan": metadata.get("plan"),
                        "findings": metadata.get("findings", []),
                        "verifications": metadata.get("verifications", []),
                        "report": metadata.get("report") or best.get("response"),
                    },
                }
            return None
        except Exception as e:
            logger.error(f"Error in search_similar_query: {e}")
            return None

    async def save_query_dossier(
        self,
        query: str,
        query_vector: List[float],
        payload: Dict[str, Any],
        ttl_seconds: Optional[int] = None,
    ) -> None:
        """Research pipeline adapter — persists a completed dossier."""
        try:
            report = payload.get("report", {})
            metadata = {
                "plan": payload.get("plan"),
                "findings": payload.get("findings", []),
                "verifications": payload.get("verifications", []),
                "report": report,
            }
            await self.store(
                prompt=query,
                response=report,
                vector=query_vector,
                metadata=metadata,
                ttl=ttl_seconds,
            )
        except Exception as e:
            logger.error(f"Error in save_query_dossier: {e}")


# Global singleton instance
semantic_cache = UpstashSemanticCache(name="llmcache", distance_threshold=0.12, ttl=86400)
