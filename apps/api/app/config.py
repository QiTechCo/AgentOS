import os
from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # API Keys & Providers
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    ollama_url: str = "http://localhost:11434"

    # Hermes core REST bridge (mcpo)
    hermes_mcp_url: str = ""
    hermes_mcp_api_key: str = ""

    # Memory OS
    qdrant_url: str = ""
    qdrant_collection: str = "knowledge_base"
    hermes_home_ro: str = ""

    # Internal databases & worker
    database_url: str = ""
    redis_url: str = "redis://redis:6379/0"

    # Proxmox SSH & LXC Config (for driving ACP)
    proxmox_ssh_host: str = "10.10.10.117"
    proxmox_ssh_user: str = "root"
    hermes_lxc_id: int = 102
    hermes_python_path: str = "/usr/local/lib/hermes-agent/venv/bin/python"

    # Path Resolution
    @property
    def root_dir(self) -> Path:
        return Path(__file__).resolve().parents[3]

    @property
    def personas_file(self) -> Path:
        return self.root_dir / "packages" / "personas" / "personas.yaml"

    @property
    def agent_os_dir(self) -> Path:
        # Check env or default to .agent_os in root
        env_val = os.getenv("AGENT_OS_DIR")
        if env_val:
            return Path(env_val).resolve()
        return self.root_dir / ".agent_os"


@lru_cache
def get_settings() -> Settings:
    return Settings()
