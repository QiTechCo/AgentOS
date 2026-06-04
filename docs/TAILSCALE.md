# Tailscale VPN Integration Guide

This guide details how to securely connect **Agent OS** (the web dashboard, FastAPI gateway, and background worker) with your Proxmox containers, Qdrant database, and local workspaces over a secure, private Tailscale mesh network.

Using Tailscale eliminates the need to expose port forwards (such as `:8000`, `:8088`, or `:6333`) to the public internet, routing all multi-agent calls securely over WireGuard encrypted tunnels.

---

## 1. Network Topology Overview

```
                        [ Tailnet Mesh VPN ]
                                 │
         ┌───────────────────────┼────────────────────────┐
         │                       │                        │
         ▼                       ▼                        ▼
 ┌───────────────┐       ┌───────────────┐       ┌────────────────┐
 │  Local Client │       │ API Gateway & │       │ Proxmox Host & │
 │ (Web Browser) │       │   OS Worker   │       │   Hermes LXC   │
 │   Tailscale   │       │   Tailscale   │       │   Tailscale    │
 └───────────────┘       └───────────────┘       └────────────────┘
```

* **Next.js Web UI (`apps/web`):** Connects to the FastAPI API gateway via Tailnet IP addresses (e.g. `http://agent-os-api:8000`).
* **FastAPI Gateway (`apps/api`):** Communicates with:
  * **Qdrant DB:** Queries the host machine (e.g. `http://proxmox-host:6333`).
  * **Hermes Agent (LXC 102):** Executes prompts over SSH using host VPN IPs.
* **Hermes Core (LXC):** Connects back to the API gateway and vector database over the VPN network.

---

## 2. Installation & Setup

### Step A: Install Tailscale on the Proxmox Host & LXCs
To securely bridge Proxmox nodes, install Tailscale natively on your Proxmox hypervisor:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

For unprivileged LXC containers (such as Container 102 `hermes-agent`), ensure that the tun device is enabled in the container configuration `/etc/pve/lxc/102.conf` before installing Tailscale:
```ini
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```
Then log in to the LXC and run the install script.

### Step B: Setup Subnet Routing (Optional)
If you prefer not to install Tailscale inside every individual container, you can configure the Proxmox host to act as a **subnet router** to expose the Proxmox bridge network (e.g. `10.10.10.0/24`) to your Tailnet:
```bash
tailscale up --advertise-routes=10.10.10.0/24
```
Enable the route in the Tailscale admin console under **Edit route settings**.

---

## 3. Configuration & Variable Mapping

Once your machines are connected to the Tailnet, update your `.env` configuration file in Agent OS to utilize the new Tailnet IP addresses or MagicDNS hostnames instead of LAN-only IPs:

```ini
# --- Telemetry and API base ---
NEXT_PUBLIC_API_BASE=http://agent-os-api.tailnet-zone.ts.net:8000

# --- Vector database (Qdrant) ---
QDRANT_URL=http://proxmox-host.tailnet-zone.ts.net:6333

# --- Proxmox Host SSH ---
PROXMOX_SSH_HOST=proxmox-host.tailnet-zone.ts.net
```

---

## 4. Securing with API Tokens

When exposing the Next.js Mission Control dashboard and API gateway over Tailscale to multiple devices (e.g. phone, tablet, remote laptop), enable the built-in token authentication:

1. Generate a secure auth token:
   ```bash
   openssl rand -hex 24
   ```
2. Configure `.env` on the gateway server:
   ```ini
   AGENT_OS_AUTH_TOKEN=your_secure_random_hex_token
   ```
3. Pass the token to the client/frontend environment:
   ```ini
   NEXT_PUBLIC_AGENT_OS_TOKEN=your_secure_random_hex_token
   ```
   
FastAPI will now block any unauthenticated REST calls with `403 Forbidden` unless the `X-Agent-OS-Token` header is present. The dashboard automatically injects this token into all fetch requests.
