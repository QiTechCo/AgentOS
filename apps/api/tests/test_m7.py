"""M7 unit tests — API Token Authentication and Audit Logging validation.

Run: `python -m tests.test_m7` from apps/api
"""
import os
import json
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

os.environ["GEMINI_API_KEY"] = "gem-test"
os.environ["QDRANT_URL"] = "http://localhost:6333"

# Setup token auth for testing
os.environ["AGENT_OS_AUTH_TOKEN"] = "test-secret-token"

from app.config import get_settings  # noqa: E402
get_settings.cache_clear()

from app.bridges.audit import log_audit  # noqa: E402
from app.auth import verify_auth_token  # noqa: E402
from fastapi import HTTPException  # noqa: E402


async def run_tests():
    # 1) Audit logging test
    settings = get_settings()
    os.makedirs(settings.agent_os_dir / "artifacts", exist_ok=True)
    audit_file = settings.agent_os_dir / "artifacts" / "audit_log.md"
    
    # Reset file
    if audit_file.exists():
        os.remove(audit_file)
        
    log_audit("deployment", "Daedalus", "Launched container mock 9")
    
    assert audit_file.exists()
    content = audit_file.read_text(encoding="utf-8")
    assert "# Agent OS Audit Log" in content
    assert "[DEPLOYMENT]" in content
    assert "Daedalus" in content
    assert "Launched container mock 9" in content

    # 2) Auth Token Validation tests
    # Test valid X-Agent-OS-Token
    await verify_auth_token(x_agent_os_token="test-secret-token") # Should pass without raising error
    
    # Test valid Bearer Token fallback
    await verify_auth_token(authorization="Bearer test-secret-token") # Should pass without raising error
    
    # Test invalid X-Agent-OS-Token raises 403 Forbidden
    try:
        await verify_auth_token(x_agent_os_token="invalid-token")
        assert False, "expected HTTPException 403"
    except HTTPException as e:
        assert e.status_code == 403
        assert "Invalid or missing" in e.detail

    # Test missing token raises 403 Forbidden
    try:
        await verify_auth_token(x_agent_os_token=None, authorization=None)
        assert False, "expected HTTPException 403"
    except HTTPException as e:
        assert e.status_code == 403

    # Test auth check is skipped when token is unset in config
    os.environ["AGENT_OS_AUTH_TOKEN"] = ""
    get_settings.cache_clear()
    
    # Should pass even if we send None since auth is skipped
    await verify_auth_token(x_agent_os_token=None, authorization=None)

    # Cleanup test files
    if audit_file.exists():
        os.remove(audit_file)
        
    print("ALL M7 AUTHENTICATION AND AUDIT LOG TESTS PASSED!")


if __name__ == "__main__":
    asyncio.run(run_tests())
