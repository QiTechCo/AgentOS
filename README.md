# Agent OS (Hermes OS)

A self-hosted, multi-agent Unified Operating System designed to orchestrate **Nous Research Hermes**, **Claude Code**, and **Antigravity (Gemini)** within a single, shared workspace and context.

It runs locally or in a Proxmox container, connecting to your server-side memory stack and cloud APIs to provide a unified Visual Intelligence Layer (Mission Control).

## System Architecture

Agent OS integrates three core AI systems into a single contextual loop:
1.  **Nous Research Hermes (Velocity 0.15):** Exposes core tools and handles background events via SSE MCP.
2.  **Claude Code (Opus 4.8):** Executes high-intensity codebase modifications and architectural changes.
3.  **Antigravity (Gemini):** Orchestrated via the Google Antigravity SDK to conduct autonomous multi-step tools, web browsing, and code integrations.

### Context Unification
Context isolation is eliminated by:
*   A shared workspace memory folder (`.agent_os/`) containing active `goals.json`, developer `standards.json`, and project `context.json`.
*   A unified **Model Context Protocol (MCP) Server** running as part of the API gateway. This exposes shared memory and task status tools directly to Claude Code, Hermes, and Antigravity.
*   An **asynchronous dreaming daemon** that reviews log deltas, generates Morning Briefs, and tracks subscription ROI.

## Project Structure

```
.agent_os/                     # The Shared Workspace Memory Area
apps/
  api/                         # FastAPI gateway + custom MCP server
  web/                         # Next.js Mission Control dashboard
  worker/                      # ARQ worker for daily dreaming/ROI calculations
packages/
  personas/                    # Configuration for the agent Pantheon
```

## Quick Start

1.  **Configure environment variables:**
    ```bash
    cp .env.example .env
    # Add your GEMINI_API_KEY (and optionally ANTHROPIC_API_KEY)
    ```
2.  **Launch the stack:**
    ```bash
    make up
    ```
3.  **Explore the Dashboards:**
    *   Mission Control Dashboard: `http://localhost:8088`
    *   API Gateway & Docs: `http://localhost:8000/docs`

## License
MIT
