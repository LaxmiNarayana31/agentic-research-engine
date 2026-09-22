import re
import uuid
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.dtos.auth_dto import TenantResponse
from app.models.tenant import Tenant, TenantMember
from app.models.user import User

def slugify(text: str) -> str:
    """Generate URL-safe slug from text."""
    try:
        slug = re.sub(r"[^\w\s-]", "", (text or "").lower()).strip()
        slug = re.sub(r"[-\s]+", "-", slug)
        return slug or "workspace"
    except Exception:
        return "workspace"

def serialize_tenant(tenant: Tenant, role: str = "member") -> dict:
    """Service-level serialization for Tenant entity."""
    try:
        return {
            "id": tenant.id,
            "name": tenant.name,
            "slug": tenant.slug,
            "tier": tenant.tier,
            "role": role,
            "created_at": tenant.created_at.isoformat() if tenant.created_at else None
        }
    except Exception as e:
        logger.error(f"Error serializing tenant: {e}")
        return {
            "id": getattr(tenant, "id", ""),
            "name": getattr(tenant, "name", "Workspace"),
            "slug": getattr(tenant, "slug", "workspace"),
            "tier": getattr(tenant, "tier", "free"),
            "role": role,
            "created_at": None
        }

class TenantService:
    """Service managing workspaces, organizations, and multi-tenant access control."""

    async def create_tenant(self, db: AsyncSession, user_id: str, name: str, tier: str = "free") -> Tenant:
        """Create a new tenant and assign the user as owner."""
        try:
            base_slug = slugify(name)
            unique_slug = f"{base_slug}-{str(uuid.uuid4())[:8]}"
            
            tenant = Tenant(
                id=str(uuid.uuid4()),
                name=name,
                slug=unique_slug,
                tier=tier
            )
            db.add(tenant)
            await db.flush()

            # Add creator as owner
            membership = TenantMember(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                user_id=user_id,
                role="owner"
            )
            db.add(membership)
            await db.commit()
            await db.refresh(tenant)
            
            logger.info(f"Created workspace '{tenant.name}' ({tenant.id}) for user {user_id}")
            return tenant
        except Exception as e:
            await db.rollback()
            logger.error(f"Error creating tenant '{name}' for user {user_id}: {e}")
            raise

    async def create_workspace(self, db: AsyncSession, user_id: str, name: str) -> TenantResponse:
        """Create a new workspace and return serialized TenantResponse DTO."""
        try:
            tenant = await self.create_tenant(db, user_id, name, tier="free")
            return TenantResponse(id=tenant.id, name=tenant.name, slug=tenant.slug, tier=tenant.tier, role="owner")
        except Exception as e:
            logger.error(f"Error creating workspace DTO: {e}")
            raise

    async def get_user_tenants(self, db: AsyncSession, user_id: str) -> List[dict]:
        """Fetch all tenants/workspaces a user belongs to, including their role."""
        try:
            stmt = (
                select(Tenant, TenantMember.role)
                .join(TenantMember, Tenant.id == TenantMember.tenant_id)
                .where(TenantMember.user_id == user_id)
            )
            result = await db.execute(stmt)
            rows = result.all()
            
            return [serialize_tenant(tenant, role) for tenant, role in rows]
        except Exception as e:
            logger.error(f"Error fetching tenants for user {user_id}: {e}")
            return []

    async def list_user_workspaces(self, db: AsyncSession, user_id: str) -> List[TenantResponse]:
        """List all workspaces for a user converted to TenantResponse DTOs."""
        try:
            workspaces = await self.get_user_tenants(db, user_id)
            return [TenantResponse(**ws) for ws in workspaces]
        except Exception as e:
            logger.error(f"Error listing workspaces for user {user_id}: {e}")
            return []

    async def get_tenant_by_id(self, db: AsyncSession, tenant_id: str) -> Optional[Tenant]:
        """Retrieve a tenant by ID."""
        try:
            stmt = select(Tenant).where(Tenant.id == tenant_id)
            result = await db.execute(stmt)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching tenant {tenant_id}: {e}")
            return None

    async def is_tenant_member(self, db: AsyncSession, tenant_id: str, user_id: str) -> bool:
        """Check if a user is a member of a tenant."""
        try:
            stmt = select(TenantMember).where(
                TenantMember.tenant_id == tenant_id,
                TenantMember.user_id == user_id
            )
            result = await db.execute(stmt)
            return result.scalar_one_or_none() is not None
        except Exception as e:
            logger.error(f"Error checking tenant membership: {e}")
            return False

    async def get_or_create_personal_tenant(self, db: AsyncSession, user: User) -> Tenant:
        """Ensure a user has at least one personal workspace."""
        try:
            user_tenants = await self.get_user_tenants(db, user.id)
            if user_tenants:
                stmt = select(Tenant).where(Tenant.id == user_tenants[0]["id"])
                res = await db.execute(stmt)
                return res.scalar_one()
            
            workspace_name = f"{user.full_name.split()[0]}'s Workspace"
            return await self.create_tenant(db, user.id, workspace_name, tier="free")
        except Exception as e:
            logger.error(f"Error in get_or_create_personal_tenant: {e}")
            raise
