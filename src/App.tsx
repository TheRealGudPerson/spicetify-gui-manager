import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity, Archive, ArrowDownToLine, ArrowUpRight, Check, ChevronRight, CircleHelp,
  Command, Download, ExternalLink, FileCog, FolderOpen, Gauge, Heart, Layers3,
  LayoutDashboard, LoaderCircle, Palette, Play, RefreshCw, RotateCcw, Search,
  Settings2, ShieldCheck, Sparkles, Terminal, WandSparkles, X
} from "lucide-react";

type Status = { platform: string; spicetifyFound: boolean; version: string | null; spotifyFound: boolean; configPath: string | null };
type CommandResult = { success: boolean; command: string; code: number | null; stdout: string; stderr: string };
type Section = "Overview" | "Themes" | "Extensions" | "Custom Apps" | "Color Schemes" | "Configuration" | "Backups" | "Logs";

const navigation: { name: Section; icon: typeof LayoutDashboard; note?: string }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Themes", icon: Palette, note: "Soon" },
  { name: "Extensions", icon: Layers3, note: "Soon" },
  { name: "Custom Apps", icon: Sparkles, note: "Soon" },
  { name: "Color Schemes", icon: WandSparkles, note: "Soon" },
  { name: "Configuration", icon: Settings2 },
  { name: "Backups", icon: Archive },
  { name: "Logs", icon: Terminal }
];

const demoLog = [
  { time: "Just now", text: "SpiceDeck session started", kind: "info" },
  { time: "Ready", text: "Waiting for a status check", kind: "muted" }
];

function App() {
  const [section, setSection] = useState<Section>("Overview");
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [logs, setLogs] = useState(demoLog);
  const [query, setQuery] = useState("");
  const [configText, setConfigText] = useState("");
  const [notice, setNotice] = useState("");

  const addLog = useCallback((text: string, kind = "info") => {
    setLogs(current => [{ time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), text, kind }, ...current].slice(0, 80));
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const next = await invoke<Status>("get_status");
      setStatus(next);
      addLog(next.spicetifyFound ? `Detected Spicetify ${next.version ?? ""}`.trim() : "Spicetify CLI was not found in PATH", next.spicetifyFound ? "success" : "warning");
    } catch (error) {
      setNotice(String(error));
      addLog(`Status check failed: ${String(error)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const runAction = useCallback(async (action: string) => {
    setBusyAction(action);
    setNotice("");
    try {
      const response = await invoke<CommandResult>("run_action", { action });
      setResult(response);
      addLog(`$ ${response.command}`, "command");
      if (response.stdout.trim()) addLog(response.stdout.trim().slice(-900), "output");
      if (response.stderr.trim()) addLog(response.stderr.trim().slice(-900), response.success ? "warning" : "error");
      addLog(response.success ? `${action} completed` : `${action} failed (exit ${response.code ?? "unknown"})`, response.success ? "success" : "error");
      if (action === "config") setConfigText(response.stdout || response.stderr);
      if (action === "apply" || action === "backup" || action === "restore") await refreshStatus();
    } catch (error) {
      setNotice(String(error));
      addLog(String(error), "error");
    } finally {
      setBusyAction("");
    }
  }, [addLog, refreshStatus]);

  const filteredLogs = useMemo(() => logs.filter(item => item.text.toLowerCase().includes(query.toLowerCase())), [logs, query]);

  const runLabel = (action: string) => busyAction === action ? "Working…" : ({ apply: "Apply changes", backup: "Create backup", restore: "Restore Spotify", config: "Read configuration" } as Record<string, string>)[action] ?? action;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={21} strokeWidth={2.4}/></div><div><strong>spicedeck</strong><span>SPICETIFY MANAGER</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{navigation.map(item => {
        const Icon = item.icon;
        return <button key={item.name} className={`nav-item ${section === item.name ? "active" : ""}`} onClick={() => setSection(item.name)}>
          <Icon size={17}/><span>{item.name}</span>{item.note && <small>{item.note}</small>}{section === item.name && <ChevronRight className="nav-chevron" size={15}/>}
        </button>;
      })}</nav>
      <div className="sidebar-bottom">
        <div className="tip-card"><div className="tip-icon"><ShieldCheck size={17}/></div><strong>Local by design</strong><p>Commands run on this device as your current user. No admin access needed.</p></div>
        <button className="nav-item" onClick={() => window.open("https://spicetify.app/docs", "_blank", "noopener,noreferrer")}><CircleHelp size={17}/><span>Spicetify docs</span><ExternalLink size={13} className="external"/></button>
        <div className="profile"><div className="avatar">SD</div><div className="profile-copy"><strong>SpiceDeck</strong><span>Early access · v0.1.0</span></div><div className="online-dot"/></div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{section}</strong></div><div className="top-actions"><span className="platform-pill"><span className="pulse-dot"/>{status?.platform ?? "Detecting platform"}</span><button className="icon-button" title="Refresh status" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""}/></button></div></header>
      <div className="content">
        {section === "Overview" && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> YOUR MUSIC, YOUR RULES</div><h1>Take control of <span>Spotify.</span></h1><p>Manage your Spicetify setup without living in a terminal.</p></div><button className="button button-primary" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => void runAction("apply")}>{busyAction === "apply" ? <LoaderCircle className="spin" size={16}/> : <Play size={15} fill="currentColor"/>}{runLabel("apply")}</button></div>
          {notice && <div className="notice"><X size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div>}
          <div className="status-grid">
            <div className="status-card"><div className="card-top"><span>SPICETIFY CLI</span><div className="status-icon green"><Command size={17}/></div></div><div className="status-value">{status?.spicetifyFound ? "Installed" : status ? "Not found" : "Checking…"}</div><div className="card-foot"><span className={status?.spicetifyFound ? "dot good" : "dot bad"}/>{status?.version ? `Version ${status.version}` : status?.spicetifyFound ? "Version unavailable" : "Check installation and PATH"}</div></div>
            <div className="status-card"><div className="card-top"><span>SPOTIFY</span><div className="status-icon violet"><Activity size={17}/></div></div><div className="status-value">{status ? status.spotifyFound ? "Detected" : "Not detected" : "Checking…"}</div><div className="card-foot"><span className={status?.spotifyFound ? "dot good" : "dot neutral"}/>{status?.spotifyFound ? "Spotify installation found" : "Detection depends on platform"}</div></div>
            <div className="status-card"><div className="card-top"><span>SAFETY CHECK</span><div className="status-icon amber"><ShieldCheck size={17}/></div></div><div className="status-value">User-level</div><div className="card-foot"><span className="dot good"/>No automatic elevation</div></div>
          </div>
          <section className="section-block">
            <div className="section-title"><div><h2>Quick actions</h2><p>The maintenance tools you'll actually use.</p></div><span className="section-count">04 TOOLS</span></div>
            <div className="action-grid">
              <button className="action-card" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => void runAction("backup")}><div className="action-icon mint"><Archive size={19}/></div><div className="action-copy"><strong>Create a backup</strong><span>Save your current Spicetify state</span></div><ArrowUpRight size={16} className="action-arrow"/></button>
              <button className="action-card" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => void runAction("restore")}><div className="action-icon orange"><RotateCcw size={19}/></div><div className="action-copy"><strong>Restore Spotify</strong><span>Return Spotify to its original state</span></div><ArrowUpRight size={16} className="action-arrow"/></button>
              <button className="action-card" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => void runAction("config")}><div className="action-icon blue"><FileCog size={19}/></div><div className="action-copy"><strong>Inspect configuration</strong><span>Read your current Spicetify config</span></div><ArrowUpRight size={16} className="action-arrow"/></button>
              <button className="action-card" onClick={() => setSection("Logs")}><div className="action-icon purple"><Terminal size={19}/></div><div className="action-copy"><strong>View activity logs</strong><span>See commands, output, and errors</span></div><ArrowUpRight size={16} className="action-arrow"/></button>
            </div>
          </section>
          <div className="lower-grid">
            <section className="panel setup-panel"><div className="panel-heading"><div><h2>Current setup</h2><p>A quick read on this machine.</p></div><button className="subtle-button" onClick={() => void refreshStatus()}><RefreshCw size={14}/> Refresh</button></div>
              <div className="setup-row"><div className="setup-symbol"><Command size={16}/></div><div className="setup-label"><strong>Spicetify CLI</strong><span>{status?.version ? `Version ${status.version}` : "Installation status"}</span></div><span className={`tag ${status?.spicetifyFound ? "tag-good" : "tag-muted"}`}>{status?.spicetifyFound ? "Ready" : status ? "Missing" : "Checking"}</span></div>
              <div className="setup-row"><div className="setup-symbol"><FolderOpen size={16}/></div><div className="setup-label"><strong>Configuration path</strong><span className="path-value">{status?.configPath ?? "Not detected"}</span></div><button className="tiny-icon" title="View configuration" onClick={() => void runAction("config")}><ChevronRight size={16}/></button></div>
              <div className="setup-row"><div className="setup-symbol"><Archive size={16}/></div><div className="setup-label"><strong>Backups</strong><span>Run a backup before applying changes</span></div><span className="tag tag-muted">Manual</span></div>
              {status && !status.spicetifyFound && <div className="inline-help"><CircleHelp size={15}/><span>Install Spicetify using its <a href="https://spicetify.app/docs/advanced-usage/installation" target="_blank" rel="noreferrer">official instructions</a>, then refresh this dashboard.</span></div>}
            </section>
            <section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>What's happening under the hood.</p></div><button className="text-button" onClick={() => setSection("Logs")}>View all <ChevronRight size={14}/></button></div>
              <div className="activity-list">{logs.slice(0, 4).map((item, i) => <div className="activity-item" key={item.time + item.text + i}><span className={`activity-mark ${item.kind}`}>{item.kind === "success" ? <Check size={12}/> : item.kind === "error" ? <X size={12}/> : <span/>}</span><div><p>{item.text}</p><time>{item.time}</time></div></div>)}</div>
            </section>
          </div>
          {result && <section className="panel output-panel"><div className="panel-heading"><div><h2>Last command</h2><p><code>{result.command}</code></p></div><span className={`tag ${result.success ? "tag-good" : "tag-bad"}`}>{result.success ? "Success" : `Exit ${result.code ?? "error"}`}</span></div><pre>{[result.stdout, result.stderr].filter(Boolean).join("\n") || "Command completed without output."}</pre></section>}
          <footer className="footer"><span><Heart size={12}/> Open source, built for customization.</span><span>SpiceDeck is independent and not affiliated with Spotify or Spicetify.</span></footer>
        </>}

        {section === "Configuration" && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> PREFERENCES</div><h1>Configuration<span>.</span></h1><p>Inspect your Spicetify settings and current paths.</p></div><button className="button button-primary" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => void runAction("config")}><RefreshCw size={15}/>{runLabel("config")}</button></div><div className="panel config-panel"><div className="panel-heading"><div><h2>CLI configuration output</h2><p>Read-only for now. Editing comes after safe parsing and validation.</p></div><span className="tag tag-muted">Read only</span></div><pre className="config-output">{configText || "Select “Read configuration” to retrieve the current Spicetify configuration. Nothing is changed by this action."}</pre></div></>}

        {section === "Backups" && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> RECOVERY</div><h1>Backups<span>.</span></h1><p>Protect your setup before applying customizations.</p></div></div><div className="panel recovery-card"><div className="big-action-icon"><Archive size={24}/></div><h2>Make a restore point</h2><p>Spicetify's backup command saves the files needed for recovery. Create a backup before applying themes or extensions.</p><button className="button button-primary" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => void runAction("backup")}><Download size={15}/>{runLabel("backup")}</button><div className="warning-note"><ShieldCheck size={16}/><span>Restore replaces customized Spotify resources with Spicetify's backed-up originals. Review the command output before proceeding.</span></div><div className="recovery-divider"/><h3>Restore original Spotify files</h3><p>This runs the official <code>spicetify restore</code> command. It does not uninstall Spicetify itself.</p><button className="button button-danger" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => { if (window.confirm("Restore original Spotify files? This removes Spicetify's applied modifications.")) void runAction("restore"); }}><RotateCcw size={15}/>{runLabel("restore")}</button></div></>}

        {section === "Logs" && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> DIAGNOSTICS</div><h1>Activity logs<span>.</span></h1><p>Transparent command output, because mystery errors are nobody's hobby.</p></div><button className="button button-secondary" onClick={() => { setLogs([]); setResult(null); }}><X size={15}/> Clear logs</button></div><div className="panel logs-panel"><div className="log-toolbar"><div className="search-box"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter activity…"/></div><span>{filteredLogs.length} entries</span></div><div className="log-stream">{filteredLogs.map((item, i) => <div className="log-line" key={item.time + item.text + i}><time>{item.time}</time><span className={`log-level ${item.kind}`}>{item.kind.toUpperCase()}</span><span>{item.text}</span></div>)}{!filteredLogs.length && <div className="empty-state">No matching log entries.</div>}</div>{result && <><div className="panel-heading log-result-heading"><div><h2>Command output</h2><p>{result.command}</p></div><span className={`tag ${result.success ? "tag-good" : "tag-bad"}`}>{result.success ? "Success" : "Failed"}</span></div><pre className="config-output">{[result.stdout, result.stderr].filter(Boolean).join("\n") || "No output."}</pre></>}</div></>}

        {["Themes", "Extensions", "Custom Apps", "Color Schemes"].includes(section) && <div className="coming-soon"><div className="coming-icon"><Sparkles size={25}/></div><div className="eyebrow"><span className="eyebrow-line"/> IN THE WORKS</div><h1>{section}<span>.</span></h1><p>This part of the manager is on the roadmap. The foundation is being built around the official Spicetify CLI first, so these tools can manage real installations instead of pretending to.</p><div className="coming-checklist"><div><Check size={15}/> Cross-platform app shell</div><div><Check size={15}/> Local CLI detection</div><div><Check size={15}/> Safe maintenance actions</div><div className="pending"><Activity size={15}/> Browsing and installing customizations</div></div><button className="button button-secondary" onClick={() => setSection("Overview")}>Back to overview <ChevronRight size={15}/></button></div>}
      </div>
    </main>
  </div>;
}

export default App;