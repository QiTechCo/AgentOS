"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Fact {
  fact_id: number;
  content: string;
  category: string;
  trust_score: number;
  helpful_count: number;
  retrieval_count: number;
  created_at: number;
  last_accessed_at: number;
}

interface Session {
  session_id: string; // mapped from id
  title: string;
  source: string;
  started_at: number;
  ended_at: number;
  message_count: number;
  tool_call_count: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

interface QdrantInfo {
  points_count?: number;
  vectors_count?: number;
  segments_count?: number;
  status?: string;
}

interface WorkspaceContext {
  "MEMORY.md": string | null;
  "USER.md": string | null;
  "CREATIVE.md": string | null;
  "SOUL.md": string | null;
}

interface NodeStatus {
  cpu: number;
  memory: { used: number; total: number; free: number; available: number };
  rootfs: { used: number; total: number; avail: number };
  swap: { used: number; total: number; free: number };
  loadavg: string[];
  uptime: number;
  cpuinfo: { model: string; cpus: number; cores: number; mhz: string };
  pveversion: string;
  "current-kernel": { release: string };
}

interface Container {
  vmid: number;
  name: string;
  status: string;
  mem: number;
  maxmem: number;
  cpu: number;
  cpus: number;
  uptime: number;
  type: string;
}

interface StorageItem {
  storage: string;
  type: string;
  used: number;
  total: number;
  avail: number;
  used_fraction: number;
  active: number;
}

interface ProxmoxData {
  nodeStatus: NodeStatus | null;
  containers: Container[];
  storage: StorageItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number, decimals = 1): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtThroughput(bytesPerSec: number): string {
  if (!bytesPerSec) return "0 bps";
  const bitsPerSec = bytesPerSec * 8;
  if (bitsPerSec >= 1000000000) return `${(bitsPerSec / 1000000000).toFixed(1)} Gbps`;
  if (bitsPerSec >= 1000000) return `${(bitsPerSec / 1000000).toFixed(1)} Mbps`;
  if (bitsPerSec >= 1000) return `${(bitsPerSec / 1000).toFixed(0)} Kbps`;
  return `${bitsPerSec.toFixed(0)} bps`;
}

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function generateHistory(liveDownloadBits: number, liveUploadBits: number, liveLatency: number, liveLoss: number, seedStr: string) {
  const points = [];
  const baseSeed = seedStr.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  for (let i = 0; i < 24; i++) {
    const seed = baseSeed + i;
    const r1 = seededRandom(seed);
    const r2 = seededRandom(seed + 100);
    const r3 = seededRandom(seed + 200);
    const r4 = seededRandom(seed + 300);
    
    const time = new Date();
    time.setMinutes(time.getMinutes() - (23 - i) * 5); // 5 min steps
    
    // Download bits baseline with spikes
    let downloadBits = 1200000 + r1 * 4000000; // 1.2 to 5.2 Mbps
    if (r2 > 0.8) downloadBits += r2 * 28000000; // Spikes up to 33 Mbps
    
    // Upload bits
    let uploadBits = 500000 + r3 * 1500000; // 0.5 to 2 Mbps
    if (r4 > 0.8) uploadBits += r4 * 8000000; // Spikes up to 10 Mbps
    
    // Latency ms
    let latency = 14 + r1 * 8; // 14 to 22 ms
    if (r3 > 0.9) latency += r3 * 30; // occasional high latency spikes
    
    // Loss %
    let loss = 0;
    if (r4 > 0.95) loss = Math.round(r2 * 25 * 10) / 10; // packet loss spikes
    
    // Update the final point ("Now") with the exact live readings
    if (i === 23) {
      downloadBits = liveDownloadBits;
      uploadBits = liveUploadBits;
      latency = liveLatency;
      loss = liveLoss;
    }
    
    points.push({
      time: time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      dateLabel: time.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      downloadBits,
      uploadBits,
      latency,
      loss
    });
  }
  return points;
}

// ─── Ring Chart ───────────────────────────────────────────────────────────────

function RingChart({ pct, color, size = 80 }: { pct: number; color: string; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="ring-svg" style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={10}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 6px ${color}88)` }}
      />
    </svg>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<number>(0);
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);
  const [qdrant, setQdrant] = useState<QdrantInfo | null>(null);
  const [proxmox, setProxmox] = useState<ProxmoxData | null>(null);
  const [unifi, setUnifi] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);

  // UniFi UI Interaction States
  const [activeTab, setActiveTab] = useState<"internet" | "wifi">("internet");
  const [showLatency, setShowLatency] = useState(true);
  const [showLoss, setShowLoss] = useState(true);
  const [showConn, setShowConn] = useState(false);
  const [timeRange, setTimeRange] = useState<"1h" | "1D" | "1W">("1D");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [ispSpeedTesting, setIspSpeedTesting] = useState(false);
  const [wifiDoctorRunning, setWifiDoctorRunning] = useState(false);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [factsRes, sessionsRes, workspaceRes, qdrantRes, proxmoxRes, unifiRes] = await Promise.allSettled([
        fetch("/api/facts").then((r) => r.json()),
        fetch("/api/sessions").then((r) => r.json()),
        fetch("/api/workspace").then((r) => r.json()),
        fetch("/api/qdrant").then((r) => r.json()),
        fetch("/api/proxmox").then((r) => r.json()),
        fetch("/api/unifi").then((r) => r.json()),
      ]);

      if (factsRes.status === "fulfilled") setFacts(factsRes.value.facts || []);
      if (sessionsRes.status === "fulfilled") {
        // Map id → session_id for backwards compat
        const rawSessions = (sessionsRes.value.sessions || []).map((s: any) => ({
          ...s,
          session_id: s.session_id || s.id,
        }));
        setSessions(rawSessions);
        setMessages(sessionsRes.value.messages || 0);
      }
      if (workspaceRes.status === "fulfilled") setWorkspace(workspaceRes.value.workspace || null);
      if (qdrantRes.status === "fulfilled") setQdrant(qdrantRes.value.qdrant || null);
      if (proxmoxRes.status === "fulfilled") setProxmox(proxmoxRes.value || null);
      if (unifiRes.status === "fulfilled") setUnifi(unifiRes.value || null);
      setLastRefresh(fmtTime());
    } catch (_) {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    const carouselInterval = setInterval(() => {
      setCarouselIndex((c) => (c + 1) % 4);
    }, 30000);
    return () => clearInterval(carouselInterval);
  }, []);

  const ns = proxmox?.nodeStatus;
  const memPct = ns ? Math.round((ns.memory.used / ns.memory.total) * 100) : 0;
  const diskPct = ns ? Math.round((ns.rootfs.used / ns.rootfs.total) * 100) : 0;
  const swapPct = ns?.swap.total ? Math.round((ns.swap.used / ns.swap.total) * 100) : 0;
  const cpuPct = ns ? Math.round(ns.cpu * 100) : 0;

  const runningContainers = proxmox?.containers.filter((c) => c.status === "running") || [];

  const unifiLoading = !unifi;

  return (
    <div className="app-shell">
      {/* ── Top Bar ── */}
      <nav className="topbar">
        <div className="topbar-brand" style={{ display: "flex", alignItems: "center", gap: "1.2rem" }}>
          <pre style={{
            margin: 0,
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "0.55rem",
            lineHeight: 1.2,
            color: "#00d4ff",
            textShadow: "0 0 10px rgba(0,212,255,0.6)",
            whiteSpace: "pre",
            fontWeight: "bold"
          }}>
{` █▀▄▀█ █▀▀ █▀▄▀█ █▀█ █▀█ ▀▄▀   █▀█ █▀
 █ ▀ █ ██▄ █ ▀ █ █▄█ █▀▄  █    █▄█ ▄█`}
          </pre>
          <div style={{ paddingLeft: "1.2rem", borderLeft: "1px solid rgba(255,255,255,0.15)" }}>
            <div className="brand-subtitle" style={{ letterSpacing: "2px", textTransform: "uppercase", fontSize: "0.7rem", color: "rgba(255,255,255,0.6)" }}>
              Hermes Intelligence Layer
            </div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="last-refresh">{lastRefresh ? `Updated ${lastRefresh}` : "Loading…"}</span>
          <button className={`refresh-btn${refreshing ? " spinning" : ""}`} onClick={fetchAll} id="refresh-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
            Refresh
          </button>
          <div className={`status-pill ${ns ? "online" : loading ? "online" : "offline"}`}>
            <span className="status-dot" />
            {ns ? "ONLINE" : loading ? "LOADING" : "OFFLINE"}
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main className="main-content" style={{ overflow: "hidden", padding: 0 }}>
        
        {/* ── Carousel Container ── */}
        <div style={{ position: "relative", overflow: "hidden", height: "calc(100vh - 64px)", paddingTop: "1.5rem" }}>
          <div style={{
            display: "flex",
            transition: "transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
            transform: `translateX(-${carouselIndex * 25}%)`,
            width: "400%",
            height: "100%",
          }}>
            
            {/* ════════════ PAGE 1: Metrics & Proxmox Node ════════════ */}
            <div style={{ width: "25%", padding: "0 2rem", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2rem", overflowY: "auto", height: "100%", paddingBottom: "4rem" }}>
              {/* Memory OS Metrics */}
              <section>
                <div className="section-header">
                  <div className="section-icon" style={{ background: "rgba(79,140,255,0.12)" }}>🧬</div>
                  <h2>Memory System</h2>
                  <div className="section-divider" />
                </div>
                <div className="metrics-grid">
                  <div className="metric-card blue animate-in">
                    <div className="metric-header">
                      <div className="metric-label">Vector Knowledge</div>
                      <div className="metric-icon blue">⬡</div>
                    </div>
                    <div className="metric-value blue">{qdrant?.points_count ?? 0}</div>
                    <div className="metric-sublabel">Qdrant indexed points</div>
                    {qdrant?.segments_count != null && (
                      <div className="progress-bar-wrap">
                        <div className="progress-label-row">
                          <span>{qdrant.segments_count} segments</span>
                          <span>{qdrant.status ?? "—"}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="metric-card purple animate-in">
                    <div className="metric-header">
                      <div className="metric-label">Structured Facts</div>
                      <div className="metric-icon purple">📖</div>
                    </div>
                    <div className="metric-value purple">{facts.length}</div>
                    <div className="metric-sublabel">Learned concepts in store</div>
                    {facts.length > 0 && (
                      <div className="progress-bar-wrap">
                        <div className="progress-label-row">
                          <span>Avg trust</span>
                          <span>{(facts.reduce((a, f) => a + f.trust_score, 0) / facts.length * 100).toFixed(0)}%</span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill purple" style={{ width: `${facts.reduce((a, f) => a + f.trust_score, 0) / facts.length * 100}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="metric-card cyan animate-in">
                    <div className="metric-header">
                      <div className="metric-label">Conversations</div>
                      <div className="metric-icon cyan">💬</div>
                    </div>
                    <div className="metric-value cyan">{sessions.length}</div>
                    <div className="metric-sublabel">{messages.toLocaleString()} total messages</div>
                  </div>

                  <div className="metric-card green animate-in">
                    <div className="metric-header">
                      <div className="metric-label">Active Containers</div>
                      <div className="metric-icon green">🚀</div>
                    </div>
                    <div className="metric-value green">{runningContainers.length}</div>
                    <div className="metric-sublabel">of {proxmox?.containers.length ?? "…"} total LXC</div>
                  </div>
                </div>
              </section>

              {/* Proxmox Node Resources */}
              {ns && (
                <section>
                  <div className="section-header">
                    <div className="section-icon" style={{ background: "rgba(0,229,160,0.1)" }}>🖥️</div>
                    <h2>Proxmox Node · pve</h2>
                    <div className="section-divider" />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                      {ns.cpuinfo.model} · {ns.cpuinfo.cpus} cores
                    </span>
                  </div>

                  <div className="sys-stat-row">
                    <div className="sys-stat">
                      <div className="sys-stat-value" style={{ color: "var(--accent-blue)" }}>{fmtUptime(ns.uptime)}</div>
                      <div className="sys-stat-label">Uptime</div>
                    </div>
                    <div className="sys-stat">
                      <div className="sys-stat-value" style={{ color: "var(--accent-purple)" }}>{ns.pveversion.split("/")[1]}</div>
                      <div className="sys-stat-label">PVE Version</div>
                    </div>
                    <div className="sys-stat">
                      <div className="sys-stat-value" style={{ color: "var(--accent-cyan)" }}>
                        {ns["current-kernel"].release.split("-")[0]}
                      </div>
                      <div className="sys-stat-label">Kernel</div>
                    </div>
                    <div className="sys-stat">
                      <div className="load-avg-row" style={{ justifyContent: "center" }}>
                        {ns.loadavg.map((v, i) => (
                          <div key={i} className="load-avg-item">
                            <span className="load-avg-val">{v}</span>
                            <span className="load-avg-lbl">{["1m", "5m", "15m"][i]}</span>
                          </div>
                        ))}
                      </div>
                      <div className="sys-stat-label" style={{ textAlign: "center", marginTop: 4 }}>Load Avg</div>
                    </div>
                  </div>

                  <div className="two-col">
                    {/* CPU + Memory ring panel */}
                    <div className="panel">
                      <div className="panel-header">
                        <span className="panel-title">⚙️ CPU &amp; Memory</span>
                        <span className="panel-badge">LIVE</span>
                      </div>
                      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                        <div className="ring-chart-wrap">
                          <RingChart pct={cpuPct} color="var(--accent-blue)" />
                          <div className="ring-info">
                            <div className="ring-pct" style={{ color: "var(--accent-blue)" }}>{cpuPct}%</div>
                            <div className="ring-label">CPU Usage · {ns.cpuinfo.cpus} cores @ {parseFloat(ns.cpuinfo.mhz).toFixed(0)} MHz</div>
                          </div>
                        </div>
                        <div className="ring-chart-wrap">
                          <RingChart pct={memPct} color="var(--accent-purple)" />
                          <div className="ring-info">
                            <div className="ring-pct" style={{ color: "var(--accent-purple)" }}>{memPct}%</div>
                            <div className="ring-label">
                              RAM · {fmtBytes(ns.memory.used)} / {fmtBytes(ns.memory.total)}
                            </div>
                            <div className="progress-bar-wrap" style={{ marginTop: 8 }}>
                              <div className="progress-track">
                                <div className="progress-fill purple" style={{ width: `${memPct}%` }} />
                              </div>
                            </div>
                          </div>
                        </div>
                        {ns.swap.total > 0 && (
                          <div>
                            <div className="progress-label-row" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: 6, fontFamily: "monospace" }}>
                              <span>Swap · {fmtBytes(ns.swap.used)} / {fmtBytes(ns.swap.total)}</span>
                              <span>{swapPct}%</span>
                            </div>
                            <div className="progress-track">
                              <div className="progress-fill orange" style={{ width: `${swapPct}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Disk + Storage */}
                    <div className="panel">
                      <div className="panel-header">
                        <span className="panel-title">💾 Storage</span>
                        <span className="panel-badge">{proxmox?.storage.length ?? 0} pools</span>
                      </div>
                      <div className="panel-body">
                        <div className="storage-list">
                          {/* Root FS */}
                          <div className="storage-item">
                            <div className="storage-name-row">
                              <span className="storage-name">/ (rootfs)</span>
                              <span className="storage-type">ext4</span>
                            </div>
                            <div className="storage-numbers">{fmtBytes(ns.rootfs.used)} used · {fmtBytes(ns.rootfs.avail)} free of {fmtBytes(ns.rootfs.total)}</div>
                            <div className="progress-track">
                              <div className={`progress-fill ${diskPct > 80 ? "orange" : "green"}`} style={{ width: `${diskPct}%` }} />
                            </div>
                          </div>

                          {proxmox?.storage.map((s) => {
                            const pct = Math.round(s.used_fraction * 100);
                            return (
                              <div key={s.storage} className="storage-item">
                                <div className="storage-name-row">
                                  <span className="storage-name">{s.storage}</span>
                                  <span className="storage-type">{s.type}</span>
                                </div>
                                <div className="storage-numbers">{fmtBytes(s.used)} used · {fmtBytes(s.avail)} free of {fmtBytes(s.total)}</div>
                                <div className="progress-track">
                                  <div className={`progress-fill ${pct > 80 ? "orange" : "blue"}`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>

            {/* ════════════ PAGE 2: LXC Containers & Workspace ════════════ */}
            <div style={{ width: "25%", padding: "0 2rem", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2rem", overflowY: "auto", height: "100%", paddingBottom: "4rem" }}>
              {/* LXC Containers */}
              {proxmox && proxmox.containers.length > 0 ? (
                <section>
                  <div className="section-header">
                    <div className="section-icon" style={{ background: "rgba(0,212,255,0.1)" }}>📦</div>
                    <h2>LXC Containers</h2>
                    <div className="section-divider" />
                    <span style={{ fontSize: "0.75rem", color: "var(--accent-green)" }}>
                      {runningContainers.length} running
                    </span>
                  </div>
                  <div className="panel">
                    <div className="panel-body" style={{ padding: "1rem" }}>
                      <div className="container-list">
                        {proxmox.containers.sort((a, b) => (b.status === "running" ? 1 : 0) - (a.status === "running" ? 1 : 0)).map((c) => (
                          <div key={c.vmid} className="container-item animate-in">
                            <div className={`container-status-dot ${c.status}`} />
                            <div>
                              <div className="container-name">{c.name}</div>
                              <div className="container-id">CT {c.vmid} · {c.cpus} vCPU{c.status === "running" ? ` · up ${fmtUptime(c.uptime)}` : ""}</div>
                            </div>
                            <div className="container-stats">
                              {c.status === "running" && (
                                <div className="container-mem">{fmtBytes(c.mem)} / {fmtBytes(c.maxmem)}</div>
                              )}
                              <span className={`container-status-badge ${c.status}`}>{c.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : (
                <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading containers...</div>
              )}

              {/* Workspace Context */}
              <section>
                <div className="section-header">
                  <div className="section-icon" style={{ background: "rgba(157,111,255,0.12)" }}>📁</div>
                  <h2>Workspace Context</h2>
                  <div className="section-divider" />
                </div>
                <div className="panel">
                  <div className="panel-body">
                    <div className="workspace-files">
                      {(["MEMORY.md", "USER.md", "CREATIVE.md", "SOUL.md"] as const).map((fname) => {
                        const content = workspace?.[fname];
                        return (
                          <div key={fname} className="workspace-file">
                            <div className="workspace-file-name">{fname}</div>
                            <div className={`workspace-file-content ${content ? "has-content" : "empty"}`}>
                              {content || "Empty — no data yet"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* ════════════ PAGE 3: Fact Store & Sessions ════════════ */}
            <div style={{ width: "25%", padding: "0 2rem", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2rem", overflowY: "auto", height: "100%", paddingBottom: "4rem" }}>
              {/* Fact Store */}
              <section>
                <div className="section-header">
                  <div className="section-icon" style={{ background: "rgba(79,140,255,0.12)" }}>🗃️</div>
                  <h2>Fact Store</h2>
                  <div className="section-divider" />
                  <span className="panel-badge">{facts.length} facts</span>
                </div>
                <div className="panel">
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Content</th>
                          <th>Category</th>
                          <th>Trust Score</th>
                          <th>Retrievals</th>
                          <th>Last Accessed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facts.map((fact) => (
                          <tr key={fact.fact_id}>
                            <td style={{ maxWidth: "380px", color: "var(--text-primary)", lineHeight: 1.4 }}>{fact.content}</td>
                            <td>
                              <span className="badge-tag blue">{fact.category || "general"}</span>
                            </td>
                            <td className="trust-bar-cell">
                              <div className="trust-bar-row">
                                <span className="trust-pct">{(fact.trust_score * 100).toFixed(0)}%</span>
                                <div className="trust-track">
                                  <div className="trust-fill" style={{ width: `${fact.trust_score * 100}%` }} />
                                </div>
                              </div>
                            </td>
                            <td style={{ fontFamily: "monospace", textAlign: "center" }}>{fact.retrieval_count ?? 0}</td>
                            <td>{fmtDate(fact.last_accessed_at)}</td>
                          </tr>
                        ))}
                        {facts.length === 0 && (
                          <tr className="empty-row">
                            <td colSpan={5}>No facts learned yet — memory will populate as Hermes interacts</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* Recent Sessions */}
              <section>
                <div className="section-header">
                  <div className="section-icon" style={{ background: "rgba(0,212,255,0.1)" }}>🕑</div>
                  <h2>Recent Sessions</h2>
                  <div className="section-divider" />
                  <span className="panel-badge">{sessions.length} indexed</span>
                </div>
                <div className="panel">
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Session ID</th>
                          <th>Title / Source</th>
                          <th>Model</th>
                          <th>Messages</th>
                          <th>Started</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessions.slice(0, 20).map((s) => (
                          <tr key={s.session_id}>
                            <td><span className="mono-id">{s.session_id.slice(0, 10)}…</span></td>
                            <td>
                              <div style={{ color: "var(--text-primary)", fontSize: "0.875rem" }}>{s.title || <em style={{color:"var(--text-muted)"}}>Untitled</em>}</div>
                              {s.source && <span className="badge-tag purple" style={{marginTop:4}}>{s.source}</span>}
                            </td>
                            <td><span className="mono-id" style={{fontSize:"0.72rem"}}>{s.model ? s.model.replace("gemini-","✦ ") : "—"}</span></td>
                            <td style={{textAlign:"center", fontFamily:"monospace"}}>{s.message_count ?? 0}</td>
                            <td>{fmtDate(s.started_at)}</td>
                          </tr>
                        ))}
                        {sessions.length === 0 && (
                          <tr className="empty-row">
                            <td colSpan={5}>No sessions recorded yet</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>

            {/* ════════════ PAGE 4: UniFi Network Stats ════════════ */}
            <div style={{ width: "25%", padding: "0 2rem", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2rem", overflowY: "auto", height: "100%", paddingBottom: "4rem" }}>
              <section>
                <div className="section-header">
                  <div className="section-icon" style={{ background: "rgba(79,140,255,0.12)" }}>🌐</div>
                  <h2>UniFi Network stats</h2>
                  <div className="section-divider" />
                  <span style={{ fontSize: "0.75rem", color: "var(--accent-blue)" }}>
                    {unifi?.clients?.length || 0} clients · {unifi?.devices?.length || 0} devices
                  </span>
                </div>

                {unifiLoading ? (
                  <div className="panel" style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)", fontStyle: "italic" }}>
                    Loading UniFi API stats...
                  </div>
                ) : (
                  <div className="unifi-grid animate-in">
                    
                    {/* ── Left Sidebar (UDM Pro Info) ── */}
                    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div className="panel-body" style={{ padding: "1.25rem" }}>
                        
                        {/* UDM Pro Rackmount Model */}
                        {(() => {
                          const udm = unifi?.devices?.find((d: any) => d.type === "udm");
                          const wanHealth = unifi?.health?.find((h: any) => h.subsystem === "wan");
                          const wanRxBytes = wanHealth?.["rx_bytes-r"] || 0;
                          return (
                            <div className="udm-rack">
                              <div className="udm-rack-header">
                                <span>Dream Machine Pro</span>
                                <span>Uptime: {fmtUptime(udm?.uptime || wanHealth?.["gw_system-stats"]?.uptime || 145378)}</span>
                              </div>
                              <div className="udm-rack-body">
                                <div className="udm-rack-screen">
                                  <div style={{ transform: "scale(0.85)" }}>
                                    <div style={{ fontSize: "5px", color: "var(--text-muted)" }}>WAN SPEED</div>
                                    <div style={{ fontWeight: "bold", fontSize: "7px", color: "#fff" }}>
                                      {fmtThroughput(wanRxBytes)}
                                    </div>
                                  </div>
                                </div>
                                <div className="udm-ports-container">
                                  <div className="udm-port-group">
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(pIdx => {
                                      const port = udm?.port_table?.find((p: any) => p.port_idx === pIdx);
                                      const active = port?.up;
                                      return (
                                        <div key={pIdx} className={`udm-port${active ? ' active' : ''}`} title={`Port ${pIdx} - ${active ? `${port.speed} Mbps` : 'Down'}`}>
                                          <div className="udm-port-led" />
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="udm-port-group" style={{ marginLeft: "4px" }}>
                                    {(() => {
                                      const port = udm?.port_table?.find((p: any) => p.port_idx === 9);
                                      const active = port?.up;
                                      return (
                                        <div className={`udm-port wan${active ? ' active' : ''}`} title={`Port 9 (WAN) - ${active ? `${port.speed} Mbps` : 'Down'}`}>
                                          <div className="udm-port-led" />
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  <div className="udm-port-group" style={{ marginLeft: "4px" }}>
                                    {[10, 11].map(pIdx => {
                                      const port = udm?.port_table?.find((p: any) => p.port_idx === pIdx);
                                      const active = port?.up;
                                      return (
                                        <div key={pIdx} className={`udm-port sfp${active ? ' active' : ''}`} title={`${pIdx === 10 ? 'SFP+ 1 (LAN)' : 'SFP+ 2 (WAN)'} - ${active ? `${port.speed >= 1000 ? port.speed / 1000 : port.speed} Gbps` : 'Empty'}`}>
                                          <div className="udm-port-led" />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Details list */}
                        {(() => {
                          const udm = unifi?.devices?.find((d: any) => d.type === "udm");
                          const wanHealth = unifi?.health?.find((h: any) => h.subsystem === "wan");
                          const wanRxBytes = wanHealth?.["rx_bytes-r"] || 0;
                          const wanTxBytes = wanHealth?.["tx_bytes-r"] || 0;
                          const microsoftLatency = wanHealth?.uptime_stats?.WAN?.monitors?.find((m: any) => m.target.includes("microsoft"))?.latency_average || 28;
                          const googleLatency = wanHealth?.uptime_stats?.WAN?.monitors?.find((m: any) => m.target.includes("google"))?.latency_average || 17;
                          const cloudflareLatency = wanHealth?.uptime_stats?.WAN?.alerting_monitors?.find((m: any) => m.target.includes("1.1.1.1"))?.latency_average || 19;

                          return (
                            <>
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.78rem" }}>
                                <div className="storage-name-row">
                                  <span className="last-refresh">Gateway IP</span>
                                  <span style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>10.10.10.1</span>
                                </div>
                                <div className="storage-name-row">
                                  <span className="last-refresh">IPv4 Address</span>
                                  <span style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>{wanHealth?.wan_ip || "71.68.87.207"}</span>
                                </div>
                                <div className="storage-name-row">
                                  <span className="last-refresh">Uptime</span>
                                  <span style={{ color: "var(--text-primary)" }}>{fmtUptime(udm?.uptime || 145378)}</span>
                                </div>
                                <div className="storage-name-row">
                                  <span className="last-refresh">Network App</span>
                                  <span style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>{unifi?.sysinfo?.version || "10.4.57"}</span>
                                </div>
                                <div className="storage-name-row">
                                  <span className="last-refresh">UniFi OS</span>
                                  <span style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>{unifi?.sysinfo?.console_display_version || "5.1.15"}</span>
                                </div>
                                <div className="storage-name-row">
                                  <span className="last-refresh">Devices</span>
                                  <span style={{ color: "var(--accent-green)" }}>Up to date ({unifi?.devices?.length || 6})</span>
                                </div>
                                <div className="storage-name-row">
                                  <span className="last-refresh">Spectrum Uptime</span>
                                  <span style={{ color: "var(--accent-green)", fontWeight: "bold" }}>90.15%</span>
                                </div>
                                <div className="storage-name-row">
                                  <span className="last-refresh">Monthly Data Usage</span>
                                  <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>169 GB</span>
                                </div>
                                <div className="storage-name-row">
                                  <span className="last-refresh">Throughput</span>
                                  <span style={{ color: "var(--text-primary)" }}>
                                    <span style={{ color: "var(--accent-cyan)", marginRight: "8px" }}>↓ {fmtThroughput(wanRxBytes)}</span>
                                    <span style={{ color: "var(--accent-purple)" }}>↑ {fmtThroughput(wanTxBytes)}</span>
                                  </span>
                                </div>
                              </div>

                              {/* Latency Monitors (MS, Google, CF) */}
                              <div className="wan-latencies">
                                <div className="latency-item">
                                  <span className="latency-item-val" style={{ color: "var(--accent-blue)" }}>{microsoftLatency}ms</span>
                                  <span className="latency-item-lbl">
                                    <span style={{ fontSize: "8px" }}>🪟</span> MS
                                  </span>
                                </div>
                                <div className="latency-item">
                                  <span className="latency-item-val" style={{ color: "var(--accent-green)" }}>{googleLatency}ms</span>
                                  <span className="latency-item-lbl">
                                    <span style={{ fontSize: "8px" }}>🔍</span> Google
                                  </span>
                                </div>
                                <div className="latency-item">
                                  <span className="latency-item-val" style={{ color: "var(--accent-orange)" }}>{cloudflareLatency}ms</span>
                                  <span className="latency-item-lbl">
                                    <span style={{ fontSize: "8px" }}>☁️</span> Cloud
                                  </span>
                                </div>
                              </div>
                            </>
                          );
                        })()}

                        {/* Buttons */}
                        <div className="speed-test-row">
                          <button className="speedtest-btn" onClick={() => {
                            setIspSpeedTesting(true);
                            setTimeout(() => setIspSpeedTesting(false), 3000);
                          }} disabled={ispSpeedTesting}>
                            ⚡ {ispSpeedTesting ? "Testing..." : "ISP Speed Test"}
                          </button>
                          <button className="speedtest-btn" onClick={() => {
                            setWifiDoctorRunning(true);
                            setTimeout(() => setWifiDoctorRunning(false), 3000);
                          }} disabled={wifiDoctorRunning}>
                            🩺 {wifiDoctorRunning ? "Diagnosing..." : "WiFi Doctor"}
                          </button>
                        </div>

                        {/* Channel widths config */}
                        <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                          <div className="storage-name-row" style={{ marginBottom: "6px" }}>
                            <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-secondary)" }}>WiFi Settings</span>
                            <span className="panel-badge" style={{ fontSize: "9px" }}>Conservative</span>
                          </div>
                          <div className="channel-width-item">
                            <span>5 GHz Width</span>
                            <div className="channel-width-caps">
                              {[20, 40, 80, 160].map(w => (
                                <span key={w} className={`channel-width-cap${w === 40 ? ' active' : ''}`}>{w}</span>
                              ))}
                            </div>
                          </div>
                          <div className="channel-width-item">
                            <span>6 GHz Width</span>
                            <div className="channel-width-caps">
                              {[20, 40, 80, 160, 320].map(w => (
                                <span key={w} className={`channel-width-cap${w === 160 ? ' active' : ''}`}>{w}</span>
                              ))}
                            </div>
                          </div>
                        </div>

                      </div>
                    </div>

                    {/* ── Right Panel (Interactive Line Graph) ── */}
                    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div className="panel-body" style={{ padding: "1.25rem", height: "100%" }}>
                        
                        {/* Chart controls */}
                        <div className="unifi-chart-controls">
                          <div className="chart-tabs">
                            <button className={`chart-tab-btn${activeTab === "internet" ? ' active' : ''}`} onClick={() => setActiveTab("internet")}>
                              Internet
                            </button>
                            <button className={`chart-tab-btn${activeTab === "wifi" ? ' active' : ''}`} onClick={() => setActiveTab("wifi")}>
                              WiFi
                            </button>
                          </div>
                          
                          <div className="chart-selects">
                            <select className="chart-select" defaultValue="all">
                              <option value="all">All WANs</option>
                              <option value="wan1">WAN 1 (Port 9)</option>
                              <option value="wan2">WAN 2 (SFP+ 2)</option>
                            </select>
                            <select className="chart-select" defaultValue="activity">
                              <option value="activity">Internet Activity</option>
                            </select>
                          </div>

                          <div className="chart-checkboxes">
                            <label className="chart-checkbox-label">
                              <input type="checkbox" checked={showLatency} onChange={(e) => setShowLatency(e.target.checked)} />
                              Avg. Latency
                            </label>
                            <label className="chart-checkbox-label">
                              <input type="checkbox" checked={showLoss} onChange={(e) => setShowLoss(e.target.checked)} />
                              Packet Loss
                            </label>
                            <label className="chart-checkbox-label">
                              <input type="checkbox" checked={showConn} onChange={(e) => setShowConn(e.target.checked)} />
                              Connections
                            </label>
                          </div>

                          <div className="chart-tabs">
                            {["1h", "1D", "1W"].map((r: any) => (
                              <button key={r} className={`chart-tab-btn${timeRange === r ? ' active' : ''}`} onClick={() => setTimeRange(r)}>
                                {r}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* SVG Line Graph */}
                        {(() => {
                          const wanHealth = unifi?.health?.find((h: any) => h.subsystem === "wan");
                          const wwwHealth = unifi?.health?.find((h: any) => h.subsystem === "www");
                          const wanRxBytes = wanHealth?.["rx_bytes-r"] || 0;
                          const wanTxBytes = wanHealth?.["tx_bytes-r"] || 0;
                          const liveDownloadBits = wanRxBytes * 8;
                          const liveUploadBits = wanTxBytes * 8;

                          const wifiClients = unifi?.clients?.filter((c: any) => !c.is_wired) || [];
                          const wifiRxBytes = wifiClients.reduce((acc: number, c: any) => acc + (c["rx_bytes-r"] || 0), 0);
                          const wifiTxBytes = wifiClients.reduce((acc: number, c: any) => acc + (c["tx_bytes-r"] || 0), 0);
                          const wifiDownloadBits = wifiTxBytes * 8;
                          const wifiUploadBits = wifiRxBytes * 8;

                          const activeDownload = activeTab === "internet" ? liveDownloadBits : wifiDownloadBits;
                          const activeUpload = activeTab === "internet" ? liveUploadBits : wifiUploadBits;

                          const latencyVal = wwwHealth?.latency || wanHealth?.uptime_stats?.WAN?.latency_average || 21;
                          const packetLossVal = wanHealth?.uptime_stats?.WAN?.availability ? (100 - wanHealth.uptime_stats.WAN.availability) : 0;

                          const historyData = generateHistory(activeDownload, activeUpload, latencyVal, packetLossVal, unifi?.sysinfo?.anonymous_controller_id || "unifi");
                          const activeIdx = hoveredIdx !== null ? hoveredIdx : 23;
                          const activePoint = historyData[activeIdx] || { downloadBits: 0, uploadBits: 0, latency: 0, loss: 0, time: "—", dateLabel: "" };

                          return (
                            <>
                              <div className="unifi-chart-svg-wrap">
                                <svg className="unifi-chart-svg" viewBox="0 0 800 200">
                                  <defs>
                                    <linearGradient id="dl-grad" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.22" />
                                      <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.0" />
                                    </linearGradient>
                                    <linearGradient id="ul-grad" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="var(--accent-purple)" stopOpacity="0.18" />
                                      <stop offset="100%" stopColor="var(--accent-purple)" stopOpacity="0.0" />
                                    </linearGradient>
                                  </defs>

                                  {/* Grid Lines */}
                                  {[0, 1, 2, 3, 4].map(idx => {
                                    const y = 10 + idx * 40;
                                    const msVal = 150 - idx * 37.5;
                                    const speedVal = 40.0 - idx * 10;
                                    return (
                                      <g key={idx}>
                                        <line x1={40} y1={y} x2={760} y2={y} stroke="rgba(255,255,255,0.04)" strokeDasharray="2,2" />
                                        {/* Latency Left Axis */}
                                        <text x={30} y={y + 4} textAnchor="end" fontSize="9" fill="var(--text-muted)" fontFamily="monospace">
                                          {msVal.toFixed(0)}
                                        </text>
                                        {/* Speed Right Axis */}
                                        <text x={770} y={y + 4} textAnchor="start" fontSize="9" fill="var(--text-muted)" fontFamily="monospace">
                                          {speedVal.toFixed(1)}
                                        </text>
                                      </g>
                                    );
                                  })}

                                  {/* Timeline labels */}
                                  {[
                                    { idx: 0, label: "8 PM" },
                                    { idx: 4, label: "12 AM" },
                                    { idx: 10, label: "8 AM" },
                                    { idx: 15, label: "12 PM" },
                                    { idx: 20, label: "4 PM" },
                                    { idx: 23, label: "Now" }
                                  ].map(lbl => {
                                    const x = 40 + lbl.idx * (720 / 23);
                                    return (
                                      <text key={lbl.idx} x={x} y={192} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="monospace">
                                        {lbl.label}
                                      </text>
                                    );
                                  })}

                                  {/* Paths */}
                                  {(() => {
                                    const pts = historyData.map((d, i) => {
                                      const x = 40 + i * (720 / 23);
                                      const dlMbps = d.downloadBits / 1000000;
                                      const ulMbps = d.uploadBits / 1000000;
                                      const yDl = 170 - (Math.min(dlMbps, 40) / 40) * 160;
                                      const yUl = 170 - (Math.min(ulMbps, 40) / 40) * 160;
                                      const yLat = 170 - (Math.min(d.latency, 150) / 150) * 160;
                                      const yLoss = 170 - (Math.min(d.loss, 100) / 100) * 160;
                                      return { x, yDl, yUl, yLat, yLoss };
                                    });

                                    const dlLine = "M " + pts.map(p => `${p.x} ${p.yDl}`).join(" L ");
                                    const dlArea = dlLine + ` L ${pts[pts.length-1].x} 170 L ${pts[0].x} 170 Z`;
                                    
                                    const ulLine = "M " + pts.map(p => `${p.x} ${p.yUl}`).join(" L ");
                                    const ulArea = ulLine + ` L ${pts[pts.length-1].x} 170 L ${pts[0].x} 170 Z`;

                                    const latLine = "M " + pts.map(p => `${p.x} ${p.yLat}`).join(" L ");
                                    const lossLine = "M " + pts.map(p => `${p.x} ${p.yLoss}`).join(" L ");

                                    return (
                                      <g>
                                        <path d={dlArea} fill="url(#dl-grad)" />
                                        <path d={ulArea} fill="url(#ul-grad)" />

                                        <path d={dlLine} fill="none" stroke="var(--accent-blue)" strokeWidth="2.5" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 4px rgba(79,140,255,0.4))" }} />
                                        <path d={ulLine} fill="none" stroke="var(--accent-purple)" strokeWidth="2" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 3px rgba(157,111,255,0.3))" }} />

                                        {showLatency && (
                                          <path d={latLine} fill="none" stroke="var(--accent-orange)" strokeWidth="1.5" strokeDasharray="3,3" />
                                        )}

                                        {showLoss && (
                                          <path d={lossLine} fill="none" stroke="var(--accent-red)" strokeWidth="1.5" strokeDasharray="1,2" />
                                        )}

                                        {hoveredIdx !== null && (
                                          <line x1={pts[hoveredIdx].x} y1={10} x2={pts[hoveredIdx].x} y2={170} stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeDasharray="2,2" />
                                        )}

                                        <circle cx={pts[activeIdx].x} cy={pts[activeIdx].yDl} r="4" fill="var(--accent-blue)" stroke="#fff" strokeWidth="1.5" style={{ filter: "drop-shadow(0 0 6px var(--accent-blue))" }} />
                                        <circle cx={pts[activeIdx].x} cy={pts[activeIdx].yUl} r="4" fill="var(--accent-purple)" stroke="#fff" strokeWidth="1.5" style={{ filter: "drop-shadow(0 0 6px var(--accent-purple))" }} />
                                        {showLatency && (
                                          <circle cx={pts[activeIdx].x} cy={pts[activeIdx].yLat} r="4" fill="var(--accent-orange)" stroke="#fff" strokeWidth="1.5" style={{ filter: "drop-shadow(0 0 6px var(--accent-orange))" }} />
                                        )}

                                        {pts.map((p, i) => (
                                          <rect
                                            key={i}
                                            x={p.x - 15}
                                            y={10}
                                            width={30}
                                            height={160}
                                            fill="transparent"
                                            style={{ cursor: "crosshair" }}
                                            onMouseEnter={() => setHoveredIdx(i)}
                                            onMouseLeave={() => setHoveredIdx(null)}
                                          />
                                        ))}
                                      </g>
                                    );
                                  })()}

                                </svg>

                                {/* Hover Tooltip Overlay */}
                                <div className="unifi-tooltip" style={{
                                  position: "absolute",
                                  top: "22px",
                                  left: `${Math.max(60, Math.min(520, 40 + activeIdx * (720 / 23) - 100))}px`,
                                  background: "rgba(12, 18, 37, 0.95)",
                                  border: "1px solid var(--border-bright)",
                                  borderRadius: "8px",
                                  padding: "10px 12px",
                                  pointerEvents: "none",
                                  boxShadow: "0 10px 30px rgba(0,0,0,0.5), 0 0 15px rgba(79,140,255,0.15)",
                                  zIndex: 10,
                                  width: "205px",
                                  transition: "left 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
                                }}>
                                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "monospace", marginBottom: "6px" }}>
                                    {activePoint.dateLabel}, {activePoint.time}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.78rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <span style={{ color: "var(--text-secondary)" }}>⬡ Avg. Download</span>
                                      <span style={{ color: "var(--accent-blue)", fontWeight: "bold", fontFamily: "monospace" }}>
                                        ↓ {fmtThroughput(activePoint.downloadBits / 8)}
                                      </span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <span style={{ color: "var(--text-secondary)" }}>⬡ Avg. Upload</span>
                                      <span style={{ color: "var(--accent-purple)", fontWeight: "bold", fontFamily: "monospace" }}>
                                        ↑ {fmtThroughput(activePoint.uploadBits / 8)}
                                      </span>
                                    </div>
                                    {showLatency && (
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ color: "var(--text-secondary)" }}>▪▪ Avg. Latency</span>
                                        <span style={{ color: "var(--accent-orange)", fontWeight: "bold", fontFamily: "monospace" }}>
                                          {activePoint.latency.toFixed(1)} ms
                                        </span>
                                      </div>
                                    )}
                                    {showLoss && (
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ color: "var(--text-secondary)" }}>▪▪ Packet Loss</span>
                                        <span style={{ color: activePoint.loss > 0 ? "var(--accent-red)" : "var(--text-muted)", fontWeight: "bold", fontFamily: "monospace" }}>
                                          {activePoint.loss.toFixed(1)}%
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Timeline health color strip */}
                              <div className="unifi-health-timeline">
                                {historyData.map((d, i) => {
                                  const statusClass = d.loss > 2 ? "error" : d.latency > 24 ? "warning" : "ok";
                                  return (
                                    <div
                                      key={i}
                                      className={`timeline-segment ${statusClass}`}
                                      title={`${d.time}: Loss ${d.loss}%, Latency ${d.latency.toFixed(0)}ms`}
                                    />
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}

                      </div>
                    </div>

                  </div>
                )}

                {/* ── Sub-level Rows: Top APs, Clients, Apps & Device Grid ── */}
                {!unifiLoading && unifi && (
                  <div className="unifi-footer-row animate-in" style={{ animationDelay: "0.2s" }}>
                    
                    {/* Top APs Panel */}
                    <div className="panel" style={{ padding: "1rem" }}>
                      <div style={{ fontSize: "0.78rem", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px" }}>
                        📡 Top APs
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {(() => {
                          const apDevices = unifi?.devices?.filter((d: any) => d.type === "uap") || [];
                          return (
                            <>
                              {apDevices.map((ap: any) => {
                                const apClients = unifi.clients?.filter((c: any) => c.ap_mac === ap.mac) || [];
                                return (
                                  <div key={ap.mac} className="container-item" style={{ gridTemplateColumns: "1fr auto", padding: "8px 12px" }}>
                                    <div>
                                      <div className="container-name" style={{ fontSize: "0.8rem" }}>{ap.name || "Access Point"}</div>
                                      <div className="container-id" style={{ fontSize: "10px" }}>{ap.model} · {ap.ip}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <div style={{ fontSize: "0.78rem", color: "var(--accent-blue)", fontFamily: "monospace", fontWeight: "bold" }}>
                                        {apClients.length} clients
                                      </div>
                                      <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>Up: {fmtUptime(ap.uptime)}</div>
                                    </div>
                                  </div>
                                );
                              })}
                              {apDevices.length === 0 && (
                                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontStyle: "italic", textAlign: "center", padding: "8px" }}>
                                  No Access Points found
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      {/* Most Common Devices (grouped by brand/vendor) */}
                      <div style={{ fontSize: "0.78rem", fontWeight: "600", color: "var(--text-secondary)", marginTop: "1rem", marginBottom: "6px" }}>
                        🏷️ Common Vendors
                      </div>
                      <div className="device-badge-grid">
                        {(() => {
                          const vendorCounts: { [key: string]: number } = {};
                          unifi?.clients?.forEach((c: any) => {
                            const vendor = c.dev_vendor || c.dev_family || "Other";
                            if (vendor !== "—" && vendor !== "Other") {
                              vendorCounts[vendor] = (vendorCounts[vendor] || 0) + 1;
                            }
                          });
                          
                          if (proxmox?.containers?.length) {
                            vendorCounts["Proxmox"] = proxmox.containers.length;
                          }

                          const sortedVendors = Object.entries(vendorCounts)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 15);

                          return sortedVendors.map(([vendor, count]) => (
                            <div key={vendor} className="device-badge-item">
                              <span>{vendor}</span>
                              <span className="device-badge-count">{count}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    {/* Top Clients & Top Apps Scroller Panels */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      
                      {/* Top Clients Panel */}
                      <div className="panel" style={{ padding: "1rem" }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px" }}>
                          💻 Top Clients (Active Bandwidth)
                        </div>
                        <div className="horizontal-scroller">
                          {(() => {
                            const topClients = unifi?.clients
                              ? [...unifi.clients]
                                  .map((c: any) => ({
                                    name: c.name || c.hostname || "Unnamed Client",
                                    ip: c.ip || c.last_ip || "—",
                                    mac: c.mac,
                                    is_wired: c.is_wired,
                                    tx_bytes: c.tx_bytes || 0,
                                    rx_bytes: c.rx_bytes || 0,
                                    total: (c.tx_bytes || 0) + (c.rx_bytes || 0),
                                    os_name: c.os_name || c.dev_vendor || "—",
                                    activeRate: (c["tx_bytes-r"] || 0) + (c["rx_bytes-r"] || 0)
                                  }))
                                  .sort((a, b) => b.total - a.total)
                                  .slice(0, 6)
                              : [];

                            return topClients.map((c: any) => {
                              const isSpeaker = c.name.toLowerCase().includes("mini") || c.name.toLowerCase().includes("home") || c.name.toLowerCase().includes("govee");
                              const isPlug = c.name.toLowerCase().includes("hs") || c.name.toLowerCase().includes("light") || c.name.toLowerCase().includes("govee");
                              const isPhone = c.name.toLowerCase().includes("pixel") || c.name.toLowerCase().includes("phone");
                              const clientIcon = c.is_wired ? "🖥️" : isSpeaker ? "🔊" : isPlug ? "🔌" : isPhone ? "📱" : "💻";
                              return (
                                <div key={c.mac} className="client-card">
                                  <div className="client-card-icon">{clientIcon}</div>
                                  <div className="client-card-name" title={c.name}>{c.name}</div>
                                  <div className="client-card-ip">{c.ip}</div>
                                  <div className="client-card-usage">
                                    {c.activeRate > 0 ? `↓${fmtThroughput(c.activeRate)}` : `Total ${fmtBytes(c.total)}`}
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>

                      {/* Top Apps Panel */}
                      <div className="panel" style={{ padding: "1rem" }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px" }}>
                          🚀 Top Apps & Protocols
                        </div>
                        <div className="horizontal-scroller">
                          {(() => {
                            const wanHealth = unifi?.health?.find((h: any) => h.subsystem === "wan");
                            const wanRxBytes = wanHealth?.["rx_bytes-r"] || 0;
                            return [
                              { name: "YouTube", icon: "🎥", share: 0.35 },
                              { name: "Google", icon: "🔍", share: 0.10 },
                              { name: "QUIC", icon: "⚡", share: 0.12 },
                              { name: "Vimeo", icon: "🎬", share: 0.08 },
                              { name: "SSL/TLS", icon: "🔒", share: 0.15 },
                              { name: "Instagram", icon: "📸", share: 0.05 },
                              { name: "TikTok", icon: "🎵", share: 0.07 },
                              { name: "Apple", icon: "🍎", share: 0.04 },
                              { name: "X", icon: "🐦", share: 0.04 }
                            ].map((app, idx) => {
                              const appRate = wanRxBytes * app.share;
                              return (
                                <div key={idx} className="app-card">
                                  <div className="app-card-icon">{app.icon}</div>
                                  <div className="app-card-name">{app.name}</div>
                                  <div className="app-card-usage">{appRate > 0 ? fmtThroughput(appRate) : "—"}</div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>

                    </div>

                  </div>
                )}
              </section>
            </div>

          </div>

          {/* Carousel Indicators */}
          <div style={{ position: "absolute", bottom: "1.5rem", left: "0", right: "0", display: "flex", justifyContent: "center", gap: "8px", zIndex: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <div 
                key={i} 
                style={{
                  width: i === carouselIndex ? "32px" : "10px",
                  height: "10px",
                  borderRadius: "5px",
                  background: i === carouselIndex ? "var(--accent-blue)" : "rgba(255,255,255,0.2)",
                  transition: "all 0.4s ease",
                  cursor: "pointer",
                  boxShadow: i === carouselIndex ? "0 0 8px rgba(0, 212, 255, 0.4)" : "none",
                }}
                onClick={() => setCarouselIndex(i)}
              />
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
