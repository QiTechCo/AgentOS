import logging
from pathlib import Path
from datetime import datetime

from ..config import get_settings

logger = logging.getLogger("agentos.audit")


def log_audit(action_type: str, actor: str, detail: str) -> None:
    """Append an audit log entry to the shared Filing Cabinet document (.agent_os/artifacts/audit_log.md).
    This log document is readable from the Next.js Filing Cabinet natively.
    """
    settings = get_settings()
    d = settings.agent_os_dir / "artifacts"
    d.mkdir(parents=True, exist_ok=True)
    p = d / "audit_log.md"
    
    timestamp = datetime.now().isoformat()
    # Format a beautiful markdown log entry
    log_line = f"- `[{timestamp}]` **[{action_type.upper()}]** {actor}: {detail}\n"
    
    try:
        if not p.exists():
            p.write_text("# Agent OS Audit Log\n\n", encoding="utf-8")
        with open(p, "a", encoding="utf-8") as f:
            f.write(log_line)
    except Exception as e:
        logger.error(f"Failed to write to audit log: {e}")
