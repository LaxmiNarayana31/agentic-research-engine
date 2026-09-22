import pytest
import numpy as np
from app.services.semantic_cache import cosine_similarity, UpstashSemanticCache

def test_cosine_similarity():
    v1 = np.array([1.0, 0.0, 0.0])
    v2 = np.array([1.0, 0.0, 0.0])
    v3 = np.array([0.0, 1.0, 0.0])
    
    assert abs(cosine_similarity(v1, v2) - 1.0) < 1e-5
    assert abs(cosine_similarity(v1, v3) - 0.0) < 1e-5

def test_semantic_cache_threshold():
    cache = UpstashSemanticCache(name="test_cache", distance_threshold=0.12)
    assert cache.distance_threshold == 0.12
    cache.set_threshold(0.20)
    assert cache.distance_threshold == 0.20
    cache.set_ttl(3600)
    assert cache.ttl == 3600
