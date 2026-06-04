"use client";
import React, { useEffect, useState, useRef } from "react";
import { 
  Activity, Cpu, Database, Sparkles, DollarSign, CheckCircle2, 
  FolderOpen, Terminal, ArrowRightLeft, Send, RefreshCw, Eye, 
  Plus, AlertCircle, Play, ShieldAlert, Award
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type Conn = { name: string; ok: boolean; enabled: boolean; detail: string; latency_ms: number | null };
type Persona = { name: string; title?: string; role?: string; backend?: string; model?: string };
type GoalStep = { id: string; description: string; assignee: string; status: string };
type Goal = { id: string; description: string; owner: string; status: string; target_date: string; steps?: GoalStep[] };
type ArtifactFile = { name: string; size_bytes: number; modified_at: number };
type Message = { sender: "user" | "agent"; text: string; persona?: string; thinking?: string };

export default function MissionControl() {
  // Telemetry & Configurations
  const [conns, setConns] = useState<Conn[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersona, setActivePersona] = useState<string>("hermes");
  const [sharedContext, setSharedContext] = useState<any>({
    summary: "System initializing...",
    next_steps: [],
    active_agent: "Unknown"
  });
  const [goals, setGoals] = useState<Goal[]>([]);
  const [standards, setStandards] = useState<any>({ general: [], python: [], javascript: [] });
  const [artifacts, setArtifacts] = useState<ArtifactFile[]>([]);
  const [activeArtifactContent, setActiveArtifactContent] = useState<string | null>(null);
  const [activeArtifactName, setActiveArtifactName] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);

  // User Actions
  const [chatInput, setChatInput] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    { sender: "agent", text: "Welcome to Agent OS Mission Control. All cores are connected and ready.", persona: "hermes" }
  ]);
  const [rightPanelTab, setRightPanelTab] = useState<"pantheon" | "goals" | "artifacts" | "dreaming">("pantheon");
  const [apiError, setApiError] = useState<string>("");
  const [chatLoading, setChatLoading] = useState<boolean>(false);

  // Form Fields for updates
  const [newGoalDesc, setNewGoalDesc] = useState<string>("");
  const [newGoalOwner, setNewGoalOwner] = useState<string>("Antigravity");
  const [newGoalDate, setNewGoalDate] = useState<string>("2026-06-10");

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load telemetry and shared context on mount
  const loadSystemState = async () => {
    try {
      const [cRes, pRes, ctxRes, gRes, sRes, artRes] = await Promise.all([
        fetch(`${API}/connections`).then((r) => r.json()),
        fetch(`${API}/personas`).then((r) => r.json()),
        fetch(`${API}/agent_os/context`).then((r) => r.json()),
        fetch(`${API}/agent_os/goals`).then((r) => r.json()),
        fetch(`${API}/agent_os/standards`).then((r) => r.json()),
        fetch(`${API}/agent_os/artifacts`).then((r) => r.json())
      ]);

      setConns(cRes.connections || []);
      setPersonas(pRes.personas || []);
      setSharedContext(ctxRes || {});
      setGoals(gRes.goals || []);
      setStandards(sRes || {});
      setArtifacts(artRes.artifacts || []);
      setApiError("");
    } catch (e) {
      setApiError(`API disconnected at ${API}. Start it with 'make up' or 'make dev'`);
    }
  };

  useEffect(() => {
    loadSystemState();
    const interval = setInterval(loadSystemState, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send a chat message to the gateway agent router (supporting ACP streaming for Hermes)
  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userMsg = chatInput;
    setMessages((prev) => [...prev, { sender: "user", text: userMsg }]);
    setChatInput("");
    setChatLoading(true);

    if (activePersona === "hermes") {
      try {
        const response = await fetch(`${API}/hermes/acp/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: userMsg })
        });

        if (!response.ok) {
          throw new Error("Failed to start Hermes ACP stream");
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) return;

        // Append an empty agent message to update in-place as the stream chunks arrive
        setMessages((prev) => [...prev, { sender: "agent", text: "", persona: "hermes" }]);

        let accumulatedText = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunkStr = decoder.decode(value);
          const lines = chunkStr.split("\n\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === "chunk" && event.text) {
                  accumulatedText += event.text;
                  setMessages((prev) => {
                    const newMsgs = [...prev];
                    newMsgs[newMsgs.length - 1].text = accumulatedText;
                    return newMsgs;
                  });
                } else if (event.type === "error") {
                  accumulatedText += `\n[Stream Error: ${event.message}]`;
                  setMessages((prev) => {
                    const newMsgs = [...prev];
                    newMsgs[newMsgs.length - 1].text = accumulatedText;
                    return newMsgs;
                  });
                }
              } catch (err) {
                // Ignore parsing errors for partial/malformed lines
              }
            }
          }
        }
        loadSystemState(); // Reload goals/context upon prompt completion
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { sender: "agent", text: `ACP Stream Error: ${err.message}`, persona: "system" }
        ]);
      } finally {
        setChatLoading(false);
      }
    } else {
      // Standard static completion route for Athena/Apollo/Daedalus/Mercury
      try {
        const response = await fetch(`${API}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userMsg, persona: activePersona })
        });

        if (!response.ok) {
          const errDetail = await response.json();
          throw new Error(errDetail.detail || "Failed to prompt agent.");
        }

        const result = await response.json();
        setMessages((prev) => [
          ...prev,
          {
            sender: "agent",
            text: result.reply || `Handoff triggered or executed. Result details: ${JSON.stringify(result)}`,
            persona: result.persona || activePersona
          }
        ]);
        loadSystemState();
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { sender: "agent", text: `Error: ${err.message}`, persona: "system" }
        ]);
      } finally {
        setChatLoading(false);
      }
    }
  };

  // Add a new goal to the tracker
  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalDesc.trim()) return;

    try {
      const response = await fetch(`${API}/agent_os/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: newGoalDesc,
          owner: newGoalOwner,
          target_date: newGoalDate
        })
      });
      if (response.ok) {
        setNewGoalDesc("");
        loadSystemState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Toggle or update a goal status
  const handleUpdateGoalStatus = async (goalId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "completed" ? "pending" : "completed";
    try {
      const response = await fetch(`${API}/agent_os/goals/${goalId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      if (response.ok) {
        loadSystemState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Toggle or update a goal step status
  const handleUpdateGoalStepStatus = async (goalId: string, stepId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "completed" ? "pending" : "completed";
    try {
      const response = await fetch(`${API}/agent_os/goals/${goalId}/steps/${stepId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      if (response.ok) {
        loadSystemState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // View an artifact file content
  const handlePreviewArtifact = async (filename: string) => {
    try {
      const response = await fetch(`${API}/agent_os/artifacts/${filename}`);
      if (response.ok) {
        const content = await response.text();
        setActiveArtifactName(filename);
        setActiveArtifactContent(content);
        setShowPreviewModal(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Render Dot Color for telemetry
  const getDotStyle = (c: Conn) => {
    if (!c.enabled) return { color: "#4b5563", label: "Disabled" };
    return c.ok 
      ? { color: "#10b981", label: `${c.latency_ms ? c.latency_ms + 'ms' : 'Online'}` } 
      : { color: "#ef4444", label: "Critical" };
  };

  // Quick run mockup tests (for checking features)
  const runMockupTest = async (testType: string) => {
    if (testType === "invoice") {
      try {
        const response = await fetch(`${API}/agent_os/artifacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "dana_white_invoice.html",
            content: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; background: #0c101b; color: #f3f4f6; padding: 20px; }
    .invoice { border: 1px solid #1e293b; border-radius: 8px; padding: 24px; max-width: 500px; margin: auto; background: #111827; }
    h2 { color: #6366f1; border-bottom: 1px solid #374151; padding-bottom: 8px; margin-top: 0; }
    .amount { font-size: 24px; font-weight: bold; color: #10b981; margin: 16px 0; }
    .desc { font-style: italic; color: #9ca3af; margin-bottom: 20px; }
    .footer { font-size: 11px; color: #4b5563; text-align: center; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="invoice">
    <h2>INVOICE: QiTechCo</h2>
    <div>Client: Dana White</div>
    <div class="amount">$50,000.00 USD</div>
    <div class="desc">For consulting services referencing a "beautiful right hook" in strategic negotiation.</div>
    <div>Status: PAID</div>
    <div class="footer">Generated by Agent OS (Hermes / Antigravity)</div>
  </div>
</body>
</html>`
          })
        });
        if (response.ok) {
          alert("Invoice 'dana_white_invoice.html' generated in workspace! Switch to Filing Cabinet tab to preview.");
          loadSystemState();
        }
      } catch (e) {
        alert("Failed to trigger mock test.");
      }
    }
  };

  return (
    <div className="app-container">
      {/* Top Header Navigation */}
      <header>
        <div className="logo-section">
          <h1>AGENT OS</h1>
          <span className="logo-badge">Unified core</span>
        </div>

        {/* Telemetry Core Map (Mini Indicators) */}
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "12px", background: "rgba(255,255,255,0.03)", padding: "4px 12px", borderRadius: "99px", border: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-muted)", fontSize: "11px", fontWeight: "600", textTransform: "uppercase" }}>Active:</span>
            <span style={{ color: "#a5b4fc", fontWeight: "600" }}>{sharedContext.active_agent || "System Idle"}</span>
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            {conns.slice(0, 4).map((c) => {
              const dot = getDotStyle(c);
              return (
                <div key={c.name} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }} title={`${c.name}: ${c.detail}`}>
                  <span style={{ background: dot.color, width: "6px", height: "6px", borderRadius: "50%", boxShadow: `0 0 6px ${dot.color}` }} />
                  <span style={{ color: "var(--text-muted)", textTransform: "capitalize" }}>{c.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Multi-Agent Space Grid */}
      <div className="main-space">
        {/* Left Column: Telemetry & Memory Binds */}
        <div className="scrollable" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px", borderRight: "1px solid var(--border)" }}>
          {apiError && (
            <div className="glass-panel" style={{ borderLeft: "4px solid var(--rose)", background: "rgba(244, 63, 94, 0.05)" }}>
              <div style={{ display: "flex", gap: "10px", color: "var(--rose)", fontSize: "13px", fontWeight: "600" }}>
                <ShieldAlert size={16} />
                <span>API Error</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>{apiError}</p>
            </div>
          )}

          {/* Telemetry Node Map */}
          <div>
            <div className="section-title"><Activity size={14} /> Telemetry Node Map</div>
            <div className="glass-panel" style={{ padding: "12px" }}>
              {conns.map((c) => {
                const dot = getDotStyle(c);
                return (
                  <div key={c.name} className="telemetry-row">
                    <div style={{ background: dot.color, color: dot.color }} className="telemetry-dot" />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "13px", fontWeight: "600", textTransform: "capitalize" }}>{c.name.replace("_", " ")}</span>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{c.enabled ? c.detail : "Disabled"}</span>
                    </div>
                    <span style={{ marginLeft: "auto", fontSize: "11px", color: c.ok ? "var(--emerald)" : "var(--text-muted)", fontWeight: "500" }}>
                      {dot.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Shared Context Space Summary */}
          <div>
            <div className="section-title"><ArrowRightLeft size={14} /> Shared Workspace State</div>
            <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Status Summary</span>
                <p style={{ fontSize: "13px", marginTop: "4px", lineHeight: "1.5" }}>{sharedContext.summary}</p>
              </div>

              {sharedContext.next_steps && sharedContext.next_steps.length > 0 && (
                <div>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Workspace Next Steps</span>
                  <ul style={{ margin: "6px 0 0 16px", fontSize: "12px", lineHeight: "1.6" }}>
                    {sharedContext.next_steps.map((step: string, idx: number) => (
                      <li key={idx} style={{ color: "var(--primary)" }}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Memory OS statistics */}
          <div>
            <div className="section-title"><Database size={14} /> Memory OS Data Lake</div>
            <div className="glass-panel" style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifySelf: "stretch", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Vectordb (Qdrant):</span>
                <span style={{ fontWeight: "600", color: "var(--cyan)" }}>Active (kb_base)</span>
              </div>
              <div style={{ display: "flex", justifySelf: "stretch", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>SQLite Memory Store:</span>
                <span style={{ fontWeight: "600" }}>Bound (Read-Only)</span>
              </div>
            </div>
          </div>

          {/* Test Utilities */}
          <div>
            <div className="section-title"><Play size={14} /> Simulation Commands</div>
            <div className="glass-panel" style={{ padding: "12px" }}>
              <button 
                onClick={() => runMockupTest("invoice")}
                className="chat-send-btn" 
                style={{ width: "100%", fontSize: "12px", padding: "8px 0", justifyContent: "center", background: "rgba(99, 102, 241, 0.15)", border: "1px solid rgba(99, 102, 241, 0.3)", color: "#a5b4fc" }}
              >
                Trigger "Dana White Invoice" Mockup
              </button>
            </div>
          </div>
        </div>

        {/* Center Column: Command Bar & Messaging */}
        <div className="chat-container">
          {/* Chat Pane Header */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "rgba(3, 7, 18, 0.4)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Terminal size={16} style={{ color: "var(--primary)" }} />
              <span style={{ fontWeight: "600" }}>Command Console</span>
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Target Persona:</span>
              <select 
                value={activePersona} 
                onChange={(e) => setActivePersona(e.target.value)}
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text)", padding: "4px 8px", borderRadius: "6px", fontSize: "12px", outline: "none", cursor: "pointer" }}
              >
                {personas.map((p) => (
                  <option key={p.name} value={p.name} style={{ background: "#0b0f19" }}>
                    {p.name.toUpperCase()} ({p.title || "Agent"})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Messages Trajectory Stream */}
          <div className="chat-messages">
            {messages.map((m, idx) => (
              <div key={idx} className={`message-bubble ${m.sender}`}>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px", fontSize: "11px", color: m.sender === "user" ? "#a5b4fc" : "var(--cyan)", fontWeight: "600", textTransform: "uppercase" }}>
                  <span>{m.sender === "user" ? "Operator" : m.persona || "Agent"}</span>
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            ))}
            {chatLoading && (
              <div className="message-bubble agent" style={{ display: "flex", gap: "8px", alignItems: "center", background: "rgba(255,255,255,0.02)" }}>
                <RefreshCw size={14} className="spin" style={{ color: "var(--primary)", animation: "spin 2s linear infinite" }} />
                <span style={{ color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic" }}>Agent reasoning...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat prompt form */}
          <form onSubmit={handleSendChat} className="chat-input-area">
            <input 
              type="text" 
              value={chatInput} 
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={`Send instructions to ${activePersona.toUpperCase()}...`} 
              className="chat-input"
              disabled={chatLoading}
            />
            <button type="submit" className="chat-send-btn" disabled={chatLoading}>
              <Send size={14} />
              <span>Send</span>
            </button>
          </form>
        </div>

        {/* Right Column: Pantheon / Goals / Document filing cabinet */}
        <div className="scrollable" style={{ padding: "20px" }}>
          {/* Tab buttons */}
          <div className="tab-header">
            <button 
              onClick={() => setRightPanelTab("pantheon")} 
              className={`tab-btn ${rightPanelTab === "pantheon" ? "active" : ""}`}
            >
              Pantheon
            </button>
            <button 
              onClick={() => setRightPanelTab("goals")} 
              className={`tab-btn ${rightPanelTab === "goals" ? "active" : ""}`}
            >
              Goals & Rules
            </button>
            <button 
              onClick={() => setRightPanelTab("artifacts")} 
              className={`tab-btn ${rightPanelTab === "artifacts" ? "active" : ""}`}
            >
              Filing Cabinet
            </button>
            <button 
              onClick={() => setRightPanelTab("dreaming")} 
              className={`tab-btn ${rightPanelTab === "dreaming" ? "active" : ""}`}
            >
              Dreaming
            </button>
          </div>

          {/* Pantheon view */}
          {rightPanelTab === "pantheon" && (
            <div>
              <div className="section-title"><Cpu size={14} /> Agent Personas</div>
              <div className="pantheon-grid">
                {personas.map((p) => (
                  <div key={p.name} className="persona-card" style={{ borderLeft: p.name === activePersona ? "3px solid var(--primary)" : "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: "700", fontSize: "14px", textTransform: "capitalize" }}>{p.name}</span>
                      <span style={{ fontSize: "11px", color: "var(--cyan)", background: "rgba(6, 182, 212, 0.08)", padding: "1px 6px", borderRadius: "4px" }}>
                        {p.title}
                      </span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>{p.role}</div>
                    <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--primary)", marginTop: "8px", display: "flex", justifySelf: "stretch", justifyContent: "space-between" }}>
                      <span>Model: {p.model || p.backend}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Goals & Rules view */}
          {rightPanelTab === "goals" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Goals list */}
              <div>
                <span className="section-title"><CheckCircle2 size={14} /> Project Tracker</span>
                <div style={{ margin: "10px 0" }}>
                  {goals.map((g) => (
                    <div key={g.id} className="goal-item" style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                        <input 
                          type="checkbox" 
                          checked={g.status === "completed"} 
                          onChange={() => handleUpdateGoalStatus(g.id, g.status)}
                          style={{ marginTop: "4px", cursor: "pointer" }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                          <span style={{ fontSize: "13.5px", fontWeight: "600", textDecoration: g.status === "completed" ? "line-through" : "none", color: g.status === "completed" ? "var(--text-muted)" : "var(--text)" }}>
                            {g.description}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                            Owner: <span style={{ color: "#a5b4fc", fontWeight: "500" }}>{g.owner}</span> · Due: {g.target_date}
                          </span>
                        </div>
                      </div>
                      
                      {/* Steps checklist matrix */}
                      <div style={{ marginLeft: "26px", marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        {g.steps && g.steps.map((step) => (
                          <div key={step.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px" }}>
                            <input 
                              type="checkbox" 
                              checked={step.status === "completed"} 
                              onChange={() => handleUpdateGoalStepStatus(g.id, step.id, step.status)}
                              style={{ cursor: "pointer", width: "12px", height: "12px" }}
                            />
                            <span style={{ textDecoration: step.status === "completed" ? "line-through" : "none", color: step.status === "completed" ? "var(--text-muted)" : "var(--text)" }}>
                              {step.description}
                            </span>
                            <span style={{ 
                              marginLeft: "auto", 
                              fontSize: "9.5px", 
                              fontWeight: "600", 
                              textTransform: "uppercase", 
                              padding: "2px 6px", 
                              borderRadius: "4px",
                              background: step.assignee === "Human" ? "rgba(16, 185, 129, 0.1)" : "rgba(99, 102, 241, 0.1)",
                              border: step.assignee === "Human" ? "1px solid rgba(16, 185, 129, 0.2)" : "1px solid rgba(99, 102, 241, 0.2)",
                              color: step.assignee === "Human" ? "#34d399" : "#a5b4fc"
                            }}>
                              {step.assignee}
                            </span>
                          </div>
                        ))}
                        
                        {/* Add Step Inline Form */}
                        <div style={{ marginTop: "4px" }}>
                          <GoalStepForm goalId={g.id} onStepAdded={loadSystemState} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add goal form */}
                <form onSubmit={handleAddGoal} className="glass-panel" style={{ padding: "12px", marginTop: "12px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--text-muted)" }}>Create Goal</span>
                  <input 
                    type="text" 
                    value={newGoalDesc}
                    onChange={(e) => setNewGoalDesc(e.target.value)}
                    placeholder="Goal description..." 
                    style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: "6px", color: "white", padding: "6px 10px", marginTop: "8px", fontSize: "12px", outline: "none" }}
                  />
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <select 
                      value={newGoalOwner}
                      onChange={(e) => setNewGoalOwner(e.target.value)}
                      style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "white", padding: "4px", borderRadius: "6px", fontSize: "11px" }}
                    >
                      <option value="Human">Human</option>
                      <option value="Hermes">Hermes</option>
                      <option value="Claude Code">Claude Code</option>
                      <option value="Antigravity">Antigravity</option>
                    </select>
                    <input 
                      type="date" 
                      value={newGoalDate}
                      onChange={(e) => setNewGoalDate(e.target.value)}
                      style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "white", padding: "4px", borderRadius: "6px", fontSize: "11px" }}
                    />
                    <button type="submit" style={{ background: "var(--primary)", border: "none", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", color: "white" }}>
                      <Plus size={14} />
                    </button>
                  </div>
                </form>
              </div>

              {/* Developer Standards list */}
              <div>
                <span className="section-title"><Award size={14} /> Governance Standards</span>
                <div className="glass-panel" style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <span style={{ fontWeight: "600", color: "var(--primary)" }}>General Rules:</span>
                    <ul style={{ paddingLeft: "16px", marginTop: "4px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                      {(standards.general || []).map((r: string, idx: number) => (
                        <li key={idx}>{r}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span style={{ fontWeight: "600", color: "var(--cyan)" }}>Python Spec:</span>
                    <ul style={{ paddingLeft: "16px", marginTop: "4px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                      {(standards.python || []).map((r: string, idx: number) => (
                        <li key={idx}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filing Cabinet (Artifacts) view */}
          {rightPanelTab === "artifacts" && (
            <div>
              <div className="section-title"><FolderOpen size={14} /> Filing Cabinet</div>
              <div>
                {artifacts.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "20px" }}>
                    No artifacts generated yet.
                  </div>
                ) : (
                  artifacts.map((a) => (
                    <div 
                      key={a.name} 
                      onClick={() => handlePreviewArtifact(a.name)}
                      className="artifact-card"
                    >
                      <div style={{ display: "flex", justifySelf: "stretch", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: "600", fontSize: "13px", color: "#a5b4fc" }}>{a.name}</span>
                        <Eye size={12} style={{ color: "var(--text-muted)" }} />
                      </div>
                      <div style={{ display: "flex", justifySelf: "stretch", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
                        <span>{(a.size_bytes / 1024).toFixed(1)} KB</span>
                        <span>{new Date(a.modified_at * 1000).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Dreaming Feed view */}
          {rightPanelTab === "dreaming" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="section-title"><Sparkles size={14} /> Autonomous Insights</div>
              
              <div className="glass-panel" style={{ borderLeft: "3px solid var(--emerald)" }}>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--emerald)" }}>Morning Briefing Summary</span>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px", lineHeight: "1.5" }}>
                  All systems operating normally. Qdrant indexed 15 new memories yesterday. 
                  Recommended action: review the Hermes session history regarding Minecraft CPU benchmarks to extract developer patterns.
                </p>
              </div>

              <div className="glass-panel" style={{ borderLeft: "3px solid var(--primary)" }}>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "#a5b4fc" }}>ROI Subscription rightsizer</span>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px", lineHeight: "1.5" }}>
                  Gemini API usage is optimized. You have consumed 24% of your daily token quota. 
                  No downgrades or adjustments recommended at this time.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Artifact Preview Modal */}
      {showPreviewModal && activeArtifactName && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0, 0, 0, 0.8)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
          <div className="glass-panel" style={{ width: "90%", maxWidth: "800px", height: "85%", display: "grid", gridTemplateRows: "50px 1fr 50px", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.15)" }}>
            
            {/* Modal Header */}
            <div style={{ display: "flex", justifySelf: "stretch", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>
              <span style={{ fontWeight: "700", color: "#a5b4fc" }}>Preview: {activeArtifactName}</span>
              <button 
                onClick={() => setShowPreviewModal(false)}
                style={{ background: "transparent", border: "none", color: "white", cursor: "pointer", fontSize: "18px" }}
              >
                &times;
              </button>
            </div>

            {/* Modal Content Preview */}
            <div style={{ overflow: "auto", margin: "16px 0", background: "rgba(0,0,0,0.3)", borderRadius: "8px", border: "1px solid var(--border)", padding: "16px" }}>
              {activeArtifactName.endsWith(".html") ? (
                <iframe 
                  srcDoc={activeArtifactContent || ""} 
                  title={activeArtifactName}
                  style={{ width: "100%", height: "100%", border: "none", background: "transparent" }}
                />
              ) : (
                <pre style={{ fontFamily: "var(--font-mono)", fontSize: "12px", whiteSpace: "pre-wrap", color: "var(--text)" }}>
                  {activeArtifactContent}
                </pre>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ display: "flex", justifySelf: "stretch", justifyContent: "flex-end", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
              <button 
                onClick={() => setShowPreviewModal(false)}
                className="chat-send-btn"
                style={{ padding: "6px 16px", fontSize: "12px" }}
              >
                Close Preview
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}


function GoalStepForm({ goalId, onStepAdded }: { goalId: string; onStepAdded: () => void }) {
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState("Human");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/agent_os/goals/${goalId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, assignee })
      });
      if (res.ok) {
        setDesc("");
        onStepAdded();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" }}>
      <input 
        type="text" 
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Add checklist step..."
        style={{ flex: 1, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", color: "white", padding: "3px 8px", fontSize: "11px", outline: "none" }}
        disabled={loading}
      />
      <select 
        value={assignee}
        onChange={(e) => setAssignee(e.target.value)}
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "white", padding: "2px 4px", borderRadius: "4px", fontSize: "11px", outline: "none", cursor: "pointer" }}
        disabled={loading}
      >
        <option value="Human" style={{ background: "#0b0f19" }}>Human</option>
        <option value="Hermes" style={{ background: "#0b0f19" }}>Hermes</option>
        <option value="Claude Code" style={{ background: "#0b0f19" }}>Claude Code</option>
        <option value="Antigravity" style={{ background: "#0b0f19" }}>Antigravity</option>
      </select>
      <button type="submit" style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "4px", padding: "3px 8px", cursor: "pointer", color: "white", fontSize: "11px" }} disabled={loading}>
        Add
      </button>
    </form>
  );
}
