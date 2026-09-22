import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON

from app.db.database import Base

# Native PostgreSQL JSONB / JSON column definition
CompatibleJSON = JSON().with_variant(JSONB, "postgresql")

class ResearchSession(Base):
    __tablename__ = "research_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), nullable=True, index=True)
    tenant_id = Column(String(36), nullable=True, index=True)
    query = Column(Text, nullable=False)
    effort_level = Column(String(20), default="medium", nullable=False)
    status = Column(String(30), default="running", index=True, nullable=False)
    
    plan_data = Column(CompatibleJSON, nullable=True)
    findings_data = Column(CompatibleJSON, nullable=True)
    verifications_data = Column(CompatibleJSON, nullable=True)
    report_data = Column(CompatibleJSON, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_research_sessions_created_desc", created_at.desc()),
        Index("ix_research_sessions_user_created", user_id, created_at.desc()),
        Index("ix_research_sessions_tenant_created", tenant_id, created_at.desc()),
    )
