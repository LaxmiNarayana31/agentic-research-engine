"""Durable SSE event log.

Every event broadcast by ActiveJob is persisted here so that after a process
restart (or when a second replica picks up a reconnect request) the full event
history can be replayed from the database instead of in-process memory.

Schema rationale
----------------
- session_id + event_id form a unique compound key so rows are idempotent and
  can be upserted without duplicating events.
- event_type is stored separately for cheap indexed filtering (e.g. "done",
  "error", "report") when we only want the final event or status events.
- payload is JSONB so the full event dict is preserved verbatim.
- created_at lets us replay in insertion order with a simple ORDER BY.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON

from app.db.database import Base

CompatibleJSON = JSON().with_variant(JSONB, "postgresql")


class JobEvent(Base):
    __tablename__ = "job_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), nullable=False, index=True)
    event_id = Column(Integer, nullable=False)          # matches ActiveJob.next_event_id sequence
    event_type = Column(String(64), nullable=False, index=True)
    payload = Column(CompatibleJSON, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        # Unique constraint — prevents double-writing the same event_id for a session
        Index("ix_job_events_session_event", "session_id", "event_id", unique=True),
        # Fast replay query: WHERE session_id = ? ORDER BY event_id ASC
        Index("ix_job_events_session_id_event_id", "session_id", "event_id"),
    )
