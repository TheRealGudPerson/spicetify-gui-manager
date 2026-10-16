import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Activity, Archive, ArrowDownToLine, ArrowUpRight, Check, ChevronRight, CircleHelp,
  Command, Download, ExternalLink, FileCog, FolderOpen, Gauge, Heart, Layers3, Save, ToggleLeft, ToggleRight, FileDown,
  LayoutDashboard, LoaderCircle, Palette, Play, RefreshCw, RotateCcw, Search,
  Settings2, ShieldCheck, Sparkles, Terminal, WandSparkles, X
} from "lucide-react";

type Status = { platform: string; spicetifyFound: boolean; version: string | null; spotifyFound: boolean; configPath: string | null };
type CommandResult = { success: boolean; command: string; code: number | null; stdout: string; stderr: string };
type Customization = { name: string; kind: string; path: string; enabled: boolean };
type Inventory = { themes: Customization[]; extensions: Customization[]; customApps: Customization[]; colorSchemes: string[]; currentTheme: string; currentColorScheme: string; enabledExtensions: string[]; enabledCustomApps: string[]; directories: string[]; scanDiagnostics: string[] };
type BackupEntry = { name: string; path: string; size: number; modified: number | null; isDirectory: boolean };

type Section = "Overview" | "Themes" | "Extensions" | "Custom Apps" | "Color Schemes" | "Configuration" | "Backups" | "Logs";

const navigation: { name: Section; icon: typeof LayoutDashboard; note?: string }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Themes", icon: Palette },
  { name: "Extensions", icon: Layers3 },
  { name: "Custom Apps", icon: Sparkles },
  { name: "Color Schemes", icon: WandSparkles },
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
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [availableUpdate, setAvailableUpdate] = useState<Awaited<ReturnType<typeof check>>>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateError, setUpdateError] = useState("");

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

  const checkForUpdates = useCallback(async (quiet = false) => {
    setUpdateBusy(true);
    setUpdateError("");
    if (!quiet) setUpdateMessage("");
    try {
      const update = await check();
      setAvailableUpdate(update);
      if (update) {
        setUpdateMessage("SpiceDeck " + update.version + " is available.");
        addLog("Update available: SpiceDeck " + update.version, "success");
      } else {
        setUpdateMessage("SpiceDeck is already up to date.");
        if (!quiet) addLog("SpiceDeck is up to date", "success");
      }
    } catch (error) {
      const message = String(error);
      setUpdateError(message);
      if (!quiet) {
        setUpdateMessage("Could not check for updates.");
        addLog("Update check failed: " + message, "warning");
      }
    } finally {
      setUpdateBusy(false);
    }
  }, [addLog]);

  const installUpdate = useCallback(async () => {
    if (!availableUpdate) {
      await checkForUpdates();
      return;
    }
    setUpdateBusy(true);
    setUpdateError("");
    setUpdateMessage("Downloading SpiceDeck " + availableUpdate.version + "...");
    try {
      await availableUpdate.downloadAndInstall();
      setUpdateMessage("Update installed. Restarting SpiceDeck...");
      addLog("Installed SpiceDeck " + availableUpdate.version + "; restarting", "success");
      await relaunch();
    } catch (error) {
      const message = String(error);
      setUpdateError(message);
      setUpdateMessage("The update could not be installed.");
      addLog("Update installation failed: " + message, "error");
    } finally {
      setUpdateBusy(false);
    }
  }, [availableUpdate, addLog, checkForUpdates]);

  useEffect(() => {
    // Avoid updater network traffic in development mode.
    if (import.meta.env.PROD) void checkForUpdates(true);
  }, [checkForUpdates]);

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


  const refreshInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const next = await invoke<Inventory>("get_customizations");
      setInventory(next);
      addLog("Refreshed installed customization inventory", "success");
    } catch (error) {
      setNotice(String(error));
      addLog(`Customization scan failed: ${String(error)}`, "error");
    } finally { setInventoryLoading(false); }
  }, [addLog]);

  const refreshBackups = useCallback(async () => {
    setBackupLoading(true);
    try { setBackups(await invoke<BackupEntry[]>("get_backups")); }
    catch (error) { setNotice(String(error)); addLog(`Backup history could not be read: ${String(error)}`, "warning"); }
    finally { setBackupLoading(false); }
  }, [addLog]);

  useEffect(() => {
    if (["Themes", "Extensions", "Custom Apps", "Color Schemes", "Configuration"].includes(section) && status?.spicetifyFound) void refreshInventory();
    if (section === "Backups" && status?.spicetifyFound) void refreshBackups();
  }, [section, status?.spicetifyFound, refreshInventory, refreshBackups]);

  const saveConfigValue = useCallback(async (key: string, value: string) => {
    setBusyAction(`config:${key}`);
    setNotice("");
    try {
      const response = await invoke<CommandResult>("set_config_value", { key, value });
      setResult(response);
      addLog(`$ ${response.command}`, "command");
      if (response.stdout) addLog(response.stdout, "output");
      if (response.stderr) addLog(response.stderr, response.success ? "warning" : "error");
      addLog(response.success ? `Saved ${key}` : `Could not save ${key}`, response.success ? "success" : "error");
      if (!response.success) setNotice(response.stderr || response.stdout || `Spicetify could not save ${key}.`);
      if (response.success) {
        await refreshInventory();
        if (["current_theme", "color_scheme", "extensions", "custom_apps"].includes(key)) setNotice(`${key} saved. Select Apply changes to apply it to Spotify.`);
      }
    } catch (error) { setNotice(String(error)); addLog(String(error), "error"); }
    finally { setBusyAction(""); }
  }, [addLog, refreshInventory]);

  const toggleCustomization = useCallback(async (item: Customization, kind: "extensions" | "custom_apps") => {
    if (!inventory) return;
    const items = kind === "extensions" ? inventory.extensions : inventory.customApps;
    const next = items.filter(entry => entry.name !== item.name && entry.enabled).map(entry => entry.name);
    if (!item.enabled) next.push(item.name);
    await saveConfigValue(kind, next.join(", "));
  }, [inventory, saveConfigValue]);

  const exportLogs = useCallback(() => {
    const text = logs.map(item => `[${item.time}] [${item.kind.toUpperCase()}] ${item.text}`).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `spicedeck-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    addLog("Exported activity log", "success");
  }, [logs, addLog]);

  const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const formatDate = (seconds: number | null) => seconds ? new Date(seconds * 1000).toLocaleString() : "Date unavailable";

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
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{section}</strong></div><div className="top-actions"><span className="platform-pill"><span className="pulse-dot"/>{status?.platform ?? "Detecting platform"}</span><button className={"update-top-button " + (availableUpdate ? "has-update" : "")} title={availableUpdate ? "Install SpiceDeck " + availableUpdate.version : "Check for updates"} onClick={() => availableUpdate ? void installUpdate() : void checkForUpdates()} disabled={updateBusy}>{updateBusy ? <LoaderCircle size={15} className="spin"/> : availableUpdate ? <Download size={15}/> : <RefreshCw size={15}/>}<span>{updateBusy ? "Updating..." : availableUpdate ? "Update " + availableUpdate.version : "Check updates"}</span></button><button className="icon-button" title="Refresh status" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""}/></button></div></header>
      {(availableUpdate || updateMessage || updateError) && <div className={"update-banner " + (availableUpdate ? "update-banner-ready" : updateError ? "update-banner-error" : "")}><div className="update-banner-icon">{availableUpdate ? <Download size={18}/> : updateError ? <CircleHelp size={18}/> : <RefreshCw size={18}/>}</div><div className="update-banner-copy"><strong>{availableUpdate ? "SpiceDeck " + availableUpdate.version + " is ready" : updateMessage || "Update status"}</strong><span>{availableUpdate ? (availableUpdate.body?.trim() || "A newer version is available. Install it now and SpiceDeck will restart.") : updateError ? updateError : "You can keep working while the app checks for updates."}</span></div>{availableUpdate && <button className="button button-primary" onClick={() => void installUpdate()} disabled={updateBusy}>{updateBusy ? <LoaderCircle size={15} className="spin"/> : <Download size={15}/>}Install and restart</button>}{!availableUpdate && <button className="icon-button" title="Dismiss update message" onClick={() => { setUpdateMessage(""); setUpdateError(""); }}><X size={15}/></button>}</div>}
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

        {section === "Configuration" && <>
          <div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> PREFERENCES</div><h1>Configuration<span>.</span></h1><p>Edit supported Spicetify settings. Changes may require applying to Spotify.</p></div><button className="button button-primary" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => void runAction("config")}><RefreshCw size={15}/>{runLabel("config")}</button></div>
          {notice && <div className="notice"><X size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div>}
          <div className="panel config-panel"><div className="panel-heading"><div><h2>Editable settings</h2><p>Only allowlisted keys are written as separate CLI arguments.</p></div><span className="tag tag-muted">Validated</span></div>
            <div className="config-form">{[
              ["current_theme", "Current theme", inventory?.currentTheme ?? ""],
              ["color_scheme", "Color scheme", inventory?.currentColorScheme ?? ""],
              ["extensions", "Enabled extensions (comma-separated)", inventory?.enabledExtensions.join(", ") ?? ""],
              ["custom_apps", "Enabled custom apps (comma-separated)", inventory?.enabledCustomApps.join(", ") ?? ""],
              ["inject_css", "Inject custom CSS (1 or 0)", ""],
              ["replace_colors", "Replace colors (1 or 0)", ""],
              ["overwrite_assets", "Overwrite assets (1 or 0)", ""],
              ["experimental_features", "Experimental features (1 or 0)", ""]
            ].map(([key, label, current]) => <label className="config-field" key={key}><span>{label}</span><input value={configDraft[key] ?? current} onChange={event => setConfigDraft(prev => ({ ...prev, [key]: event.target.value }))} placeholder={key === "extensions" || key === "custom_apps" ? "e.g. extension.js, another.js" : "Current value"} /><button className="button button-secondary" disabled={!!busyAction || !status?.spicetifyFound || (!inventory && ["current_theme", "color_scheme", "extensions", "custom_apps"].includes(key))} onClick={() => void saveConfigValue(key, configDraft[key] ?? current)}><Save size={14}/> Save</button></label>)}</div>
            <div className="inline-help"><ShieldCheck size={15}/><span>Saving changes configuration only. Use Apply changes to rebuild Spotify's customized resources.</span></div>
          </div>
          <div className="panel config-panel" style={{marginTop:14}}><div className="panel-heading"><div><h2>Raw configuration output</h2><p>Exact output from the Spicetify CLI.</p></div></div><pre className="config-output">{configText || "Use Read configuration to inspect the current CLI output."}</pre></div>
        </>}
        
        {section === "Backups" && <>
          <div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> RECOVERY</div><h1>Backups<span>.</span></h1><p>Inspect backup files and create recovery points before applying changes.</p></div><button className="button button-secondary" onClick={() => void refreshBackups()} disabled={backupLoading}><RefreshCw size={14} className={backupLoading ? "spin" : ""}/> Refresh history</button></div>
          {notice && <div className="notice"><X size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div>}
          <div className="panel recovery-card"><div className="big-action-icon"><Archive size={24}/></div><h2>Create a restore point</h2><p>Spicetify's backup command creates the recovery data. SpiceDeck lists entries it can find in the CLI-reported backup directory.</p><button className="button button-primary" disabled={!status?.spicetifyFound || !!busyAction} onClick={async () => { await runAction("backup"); await refreshBackups(); }}><Download size={15}/>{runLabel("backup")}</button><div className="warning-note"><ShieldCheck size={16}/><span>Restore replaces customized Spotify resources with backed-up originals. Review CLI output before proceeding.</span></div><div className="recovery-divider"/><div className="panel-heading"><div><h2>Backup history</h2><p>{backups.length} entries discovered</p></div><span className="tag tag-muted">{backupLoading ? "Scanning…" : "Local files"}</span></div>
            {backups.length ? <div className="backup-list">{backups.map(item => <div className="backup-row" key={item.path}><div className="setup-symbol"><Archive size={15}/></div><div className="setup-label"><strong>{item.name}</strong><span>{formatDate(item.modified)} · {item.isDirectory ? "Folder" : formatBytes(item.size)}</span><span className="path-value">{item.path}</span></div></div>)}</div> : <div className="empty-state">{backupLoading ? "Scanning backup directory…" : "No backup entries found. Create a backup to generate recovery data."}</div>}
          </div>
          <div className="panel recovery-card" style={{marginTop:14}}><h3>Restore original Spotify files</h3><p>This runs the official <code>spicetify restore</code> command. It does not uninstall Spicetify itself.</p><button className="button button-danger" disabled={!status?.spicetifyFound || !!busyAction} onClick={() => { if (window.confirm("Restore original Spotify files? This removes Spicetify's applied modifications.")) void runAction("restore"); }}><RotateCcw size={15}/>{runLabel("restore")}</button></div>
        </>}
        
        {section === "Logs" && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> DIAGNOSTICS</div><h1>Activity logs<span>.</span></h1><p>Transparent command output, because mystery errors are nobody's hobby.</p></div><div style={{display:"flex",gap:8}}><button className="button button-secondary" onClick={exportLogs}><FileDown size={15}/> Export logs</button><button className="button button-secondary" onClick={() => { setLogs([]); setResult(null); }}><X size={15}/> Clear logs</button></div></div><div className="panel logs-panel"><div className="log-toolbar"><div className="search-box"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter activity…"/></div><span>{filteredLogs.length} entries</span></div><div className="log-stream">{filteredLogs.map((item, i) => <div className="log-line" key={item.time + item.text + i}><time>{item.time}</time><span className={`log-level ${item.kind}`}>{item.kind.toUpperCase()}</span><span>{item.text}</span></div>)}{!filteredLogs.length && <div className="empty-state">No matching log entries.</div>}</div>{result && <><div className="panel-heading log-result-heading"><div><h2>Command output</h2><p>{result.command}</p></div><span className={`tag ${result.success ? "tag-good" : "tag-bad"}`}>{result.success ? "Success" : "Failed"}</span></div><pre className="config-output">{[result.stdout, result.stderr].filter(Boolean).join("\n") || "No output."}</pre></>}</div></>}

        {["Themes", "Extensions", "Custom Apps", "Color Schemes"].includes(section) && <>
          <div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> LOCAL LIBRARY</div><h1>{section}<span>.</span></h1><p>Manage customizations already installed in your Spicetify folders.</p></div><button className="button button-secondary" onClick={() => void refreshInventory()} disabled={inventoryLoading}><RefreshCw size={14} className={inventoryLoading ? "spin" : ""}/> Scan folders</button></div>
          {notice && <div className="notice"><X size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div>}
          {!status?.spicetifyFound && <div className="panel config-panel"><p>Install Spicetify CLI and refresh status before managing customizations.</p></div>}
          {status?.spicetifyFound && !inventory && <div className="panel config-panel"><p>{inventoryLoading ? "Scanning Spicetify directories…" : "No inventory loaded yet."}</p><button className="button button-primary" onClick={() => void refreshInventory()}>Scan now</button></div>}
          {inventory && section === "Themes" && <div className="panel library-panel"><div className="panel-heading"><div><h2>Installed themes</h2><p>Select a theme, then apply it to Spotify.</p></div><span className="tag tag-muted">{inventory.themes.length} found</span></div>
            {inventory.themes.length ? <div className="library-list">{inventory.themes.map(item => <div className="library-row" key={item.path}><div className="action-icon purple"><Palette size={17}/></div><div className="setup-label"><strong>{item.name === "marketplace" ? "marketplace · Marketplace-managed folder" : item.name}</strong><span className="path-value">{item.path}</span></div>{item.enabled ? <span className="tag tag-good">Configured as current theme</span> : <button className="button button-secondary" disabled={!!busyAction} onClick={() => void saveConfigValue("current_theme", item.name)}>Use theme</button>}</div>)}</div> : <div className="empty-state">No theme folders found in the Spicetify themes directory.</div>}
            <div className="inline-help"><FolderOpen size={15}/><span>{inventory.directories[0] ?? "Theme directory unavailable"}</span></div></div>}
          {inventory && section === "Extensions" && <div className="panel library-panel"><div className="panel-heading"><div><h2>Installed extensions</h2><p>Enable or disable extensions in configuration, then apply changes.</p></div><span className="tag tag-muted">{inventory.extensions.length} found</span></div>
            {inventory.extensions.length ? <div className="library-list">{inventory.extensions.map(item => <div className="library-row" key={item.path}><div className="action-icon blue"><Layers3 size={17}/></div><div className="setup-label"><strong>{item.name}</strong><span className="path-value">{item.path}</span></div><button className={item.enabled ? "toggle-button enabled" : "toggle-button"} disabled={!!busyAction} onClick={() => void toggleCustomization(item, "extensions")} title={item.enabled ? "Disable extension" : "Enable extension"}>{item.enabled ? <ToggleRight size={24}/> : <ToggleLeft size={24}/>}<span>{item.enabled ? "Enabled" : "Disabled"}</span></button></div>)}</div> : <div className="empty-state">No extensions found in the Spicetify extensions directory.</div>}
            <div className="inline-help"><FolderOpen size={15}/><span>{inventory.directories[1] ?? "Extension directory unavailable"}</span></div></div>}
          {inventory && section === "Custom Apps" && <div className="panel library-panel"><div className="panel-heading"><div><h2>Installed custom apps</h2><p>Toggle custom apps in configuration, then apply changes.</p></div><span className="tag tag-muted">{inventory.customApps.length} found</span></div>
            {inventory.customApps.length ? <div className="library-list">{inventory.customApps.map(item => <div className="library-row" key={item.path}><div className="action-icon mint"><Sparkles size={17}/></div><div className="setup-label"><strong>{item.name}</strong><span className="path-value">{item.path}</span></div><button className={item.enabled ? "toggle-button enabled" : "toggle-button"} disabled={!!busyAction} onClick={() => void toggleCustomization(item, "custom_apps")} title={item.enabled ? "Disable custom app" : "Enable custom app"}>{item.enabled ? <ToggleRight size={24}/> : <ToggleLeft size={24}/>}<span>{item.enabled ? "Enabled" : "Disabled"}</span></button></div>)}</div> : <div className="empty-state">No custom app folders found in the Spicetify custom apps directory.</div>}
            <div className="inline-help"><FolderOpen size={15}/><span>{inventory.directories[2] ?? "Custom app directory unavailable"}</span></div></div>}
          {inventory && <details className="panel scan-details"><summary><span><strong>Scan diagnostics</strong><small>Actual folders and configuration values SpiceDeck read</small></span><span className="tag tag-muted">{inventory.scanDiagnostics.length} checks</span></summary><div className="scan-detail-list">{inventory.scanDiagnostics.map((line) => <code key={line}>{line}</code>)}</div></details>}
          {inventory && section === "Color Schemes" && <div className="panel library-panel"><div className="panel-heading"><div><h2>Theme color schemes</h2><p>Color schemes are discovered from the selected theme's color.ini file.</p></div><span className="tag tag-muted">{Math.max(0, inventory.colorSchemes.length - 1)} found</span></div>
            <div className="scheme-current"><span>Current theme</span><strong>{inventory.currentTheme || "Spicetify default"}</strong><span>Current scheme</span><strong>{inventory.currentColorScheme || "Default"}</strong></div>
            {inventory.colorSchemes.length > 1 ? <div className="scheme-grid">{inventory.colorSchemes.filter(Boolean).map(scheme => <button className={scheme === inventory.currentColorScheme ? "scheme-card selected" : "scheme-card"} key={scheme} disabled={!!busyAction} onClick={() => void saveConfigValue("color_scheme", scheme)}><div className="scheme-swatches"><i/><i/><i/><i/></div><strong>{scheme}</strong><span>{scheme === inventory.currentColorScheme ? "Currently selected" : "Select scheme"}</span></button>)}</div> : <div className="empty-state">No named schemes found for this theme. Choose a theme with a color.ini file containing named sections.</div>}
            <div className="inline-help"><Palette size={15}/><span>Choose a scheme, then use Apply changes on Overview to rebuild Spotify's resources.</span></div></div>}
        </>}
      </div>
    </main>
  </div>;
}

export default App;