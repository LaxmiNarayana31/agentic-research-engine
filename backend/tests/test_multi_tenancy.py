import uuid
import pytest
from app.db.database import AsyncSessionLocal, init_db
from app.models.research_session import ResearchSession
from app.models.user import User
from app.services.research_service import ResearchService
from app.services.tenant_service import TenantService

@pytest.mark.asyncio
async def test_tenant_workspace_creation_and_membership():
    await init_db()
    tenant_service = TenantService()
    user_id = str(uuid.uuid4())
    
    async with AsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"user_{uuid.uuid4().hex[:6]}@example.com",
            full_name="Alice Explorer",
            auth_provider="local",
            role="user",
            is_active=True
        )
        db.add(user)
        await db.commit()

        tenant = await tenant_service.create_tenant(db, user_id, "Biotech Frontier Workspace", tier="pro")
        assert tenant.name == "Biotech Frontier Workspace"
        assert tenant.tier == "pro"

        workspaces = await tenant_service.get_user_tenants(db, user_id)
        assert len(workspaces) >= 1
        assert workspaces[0]["name"] == "Biotech Frontier Workspace"
        assert workspaces[0]["role"] == "owner"

@pytest.mark.asyncio
async def test_multi_tenant_session_isolation():
    await init_db()
    research_service = ResearchService()
    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())

    async with AsyncSessionLocal() as db:
        # Create session for User A
        sess_a = ResearchSession(
            id=str(uuid.uuid4()),
            user_id=user_a,
            tenant_id=tenant_a,
            query="Solid-state battery research for User A",
            effort_level="medium",
            status="completed"
        )
        # Create session for User B
        sess_b = ResearchSession(
            id=str(uuid.uuid4()),
            user_id=user_b,
            tenant_id=tenant_b,
            query="Quantum annealing research for User B",
            effort_level="high",
            status="completed"
        )
        db.add_all([sess_a, sess_b])
        await db.commit()

    # Query history as User A
    history_a = await research_service.get_history(user_id=user_a, tenant_id=tenant_a)
    session_ids_a = [s["id"] for s in history_a["history"]]
    assert sess_a.id in session_ids_a
    assert sess_b.id not in session_ids_a

    # Query history as User B
    history_b = await research_service.get_history(user_id=user_b, tenant_id=tenant_b)
    session_ids_b = [s["id"] for s in history_b["history"]]
    assert sess_b.id in session_ids_b
    assert sess_a.id not in session_ids_b

    # Verify unauthorized access protection in get_session_by_id
    access_attempt = await research_service.get_session_by_id(sess_b.id, user_id=user_a, tenant_id=tenant_a)
    assert access_attempt.get("session") is None
