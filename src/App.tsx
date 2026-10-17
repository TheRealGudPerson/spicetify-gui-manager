import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Activity, Archive, ArrowDownToLine, ArrowUpRight, Check, ChevronRight, CircleHelp,
  Command, Download, ExternalLink, FileCog, FolderOpen, Gauge, Heart, Layers3, Save, ToggleLeft, ToggleRight, FileDown,
  LayoutDashboard, LoaderCircle, Palette, Play, RefreshCw, RotateCcw, Search,
  Settings2, ShieldCheck, Sparkles, Terminal, WandSparkles, X, Globe, Star, Clock3, MonitorDown
} from "lucide-react";

type Status = { platform: string; spicetifyFound: boolean; version: string | null; spotifyFound: boolean; configPath: string | null };
type CommandResult = { success: boolean; command: string; code: number | null; stdout: string; stderr: string };
type Customization = { name: string; kind: string; path: string; enabled: boolean };
type Inventory = { themes: Customization[]; extensions: Customization[]; customApps: Customization[]; colorSchemes: string[]; currentTheme: string; currentColorScheme: string; enabledExtensions: string[]; enabledCustomApps: string[]; directories: string[]; scanDiagnostics: string[] };
type BackupEntry = { name: string; path: string; size: number; modified: number | null; isDirectory: boolean };

type Section = "Overview" | "Setup" | "Marketplace" | "Themes" | "Extensions" | "Custom Apps" | "Color Schemes" | "Configuration" | "Backups" | "Logs";

type MarketplaceCategory = "Themes" | "Extensions" | "Custom Apps";
type MarketplaceRepo = { id: number; full_name: string; description: string | null; html_url: string; stargazers_count: number; default_branch: string; pushed_at: string; language: string | null; archived: boolean };

const navigation: { name: Section; icon: typeof LayoutDashboard; note?: string }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Setup", icon: MonitorDown, note: "START" },
  { name: "Marketplace", icon: Globe, note: "NEW" },
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
  const [appVersion, setAppVersion] = useState("0.1.0");
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
  const [marketplaceCategory, setMarketplaceCategory] = useState<MarketplaceCategory>("Themes");
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceRepo[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState("");
  const [marketplaceLoadedCategory, setMarketplaceLoadedCategory] = useState<MarketplaceCategory | "">("");
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [installerBusy, setInstallerBusy] = useState("");

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

  useEffect(() => { void getVersion().then(setAppVersion).catch(() => undefined); }, []);

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
        if (!quiet) setUpdateMessage("SpiceDeck is already up to date.");
        if (!quiet) addLog("SpiceDeck is up to date", "success");
      }
    } catch (error) {
      const message = String(error);
      if (!quiet) {
        setUpdateError(message);
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
      if (action === "apply" || action === "backup" || action === "restore" || action === "setup") await refreshStatus();
    } catch (error) {
      setNotice(String(error));
      addLog(String(error), "error");
    } finally {
      setBusyAction("");
    }
  }, [addLog, refreshStatus]);


  const installSoftware = useCallback(async (target: "spotify" | "spicetify") => {
    if (installerBusy) return;
    setInstallerBusy(target);
    setNotice("");
    setResult(null);
    addLog(target === "spotify" ? "Starting OS-aware Spotify installation" : "Downloading the official Spicetify CLI release", "info");
    try {
      const response = await invoke<CommandResult>("install_software", { target });
      setResult(response);
      addLog(response.command, "command");
      if (response.stdout.trim()) addLog(response.stdout.trim().slice(-1200), "output");
      if (response.stderr.trim()) addLog(response.stderr.trim().slice(-1200), response.success ? "warning" : "error");
      addLog(response.success ? (target === "spotify" ? "Spotify installation completed" : "Spicetify installation completed") : "Installation failed", response.success ? "success" : "error");
      if (!response.success) setNotice(response.stderr || response.stdout || "The installer did not report success.");
      await refreshStatus();
    } catch (error) {
      setNotice(String(error));
      addLog("Installation failed: " + String(error), "error");
    } finally {
      setInstallerBusy("");
    }
  }, [installerBusy, addLog, refreshStatus]);

  const refreshMarketplace = useCallback(async (category: MarketplaceCategory) => {
    setMarketplaceLoading(true);
    setMarketplaceError("");
    try {
      const topic = category === "Themes" ? "spicetify-themes" : category === "Extensions" ? "spicetify-extensions" : "spicetify-apps";
      const cacheKey = "spicedeck-marketplace-" + topic;
      const cached = sessionStorage.getItem(cacheKey);
      let repos: MarketplaceRepo[] | null = null;
      if (cached) {
        try {
          const entry = JSON.parse(cached) as { savedAt: number; items: MarketplaceRepo[] };
          if (Date.now() - entry.savedAt < 10 * 60 * 1000 && Array.isArray(entry.items)) repos = entry.items;
        } catch { sessionStorage.removeItem(cacheKey); }
      }
      if (!repos) {
        const response = await fetch("https://api.github.com/search/repositories?q=" + encodeURIComponent("topic:" + topic) + "&sort=stars&order=desc&per_page=30", { headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) {
          if (response.status === 403 || response.status === 429) throw new Error("GitHub's search rate limit was reached. Wait a few minutes, then refresh.");
          throw new Error("GitHub returned HTTP " + response.status + ".");
        }
        const data = await response.json() as { items?: MarketplaceRepo[] };
        if (!Array.isArray(data.items)) throw new Error("GitHub returned an unexpected repository list.");
        repos = data.items.filter(item => !item.archived && item.full_name && item.html_url);
        sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), items: repos }));
      }
      setMarketplaceItems(repos);
      setMarketplaceLoadedCategory(category);
      addLog("Loaded " + repos.length + " community repositories for " + category, "success");
    } catch (error) {
      setMarketplaceError(String(error));
      setMarketplaceLoadedCategory(category);
      setMarketplaceItems([]);
      addLog("Marketplace discovery failed: " + String(error), "warning");
    } finally { setMarketplaceLoading(false); }
  }, [addLog]);

  useEffect(() => {
    if (section === "Marketplace" && marketplaceLoadedCategory !== marketplaceCategory && !marketplaceLoading) void refreshMarketplace(marketplaceCategory);
  }, [section, marketplaceCategory, marketplaceLoadedCategory, marketplaceLoading, refreshMarketplace]);

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
        <div className="profile"><div className="avatar">SD</div><div className="profile-copy"><strong>SpiceDeck</strong><span>Early access · v{appVersion}</span></div><div className="online-dot"/></div>
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

        {section === "Setup" && <>
          <div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> FIRST-RUN ASSISTANT</div><h1>Get set up<span>.</span></h1><p>Install Spotify, install Spicetify, then let SpiceDeck verify the setup.</p></div><button className="button button-secondary" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Recheck setup</button></div>
          {notice && <div className="notice"><X size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div>}
          <div className="setup-wizard-progress">
            <div className={status?.spotifyFound ? "wizard-progress-step complete" : "wizard-progress-step current"}><span>{status?.spotifyFound ? <Check size={14}/> : "1"}</span><div><strong>Spotify</strong><small>{status?.spotifyFound ? "Detected" : "Install the desktop app"}</small></div></div>
            <div className="wizard-progress-connector"/>
            <div className={status?.spicetifyFound ? "wizard-progress-step complete" : !status?.spotifyFound ? "wizard-progress-step" : "wizard-progress-step current"}><span>{status?.spicetifyFound ? <Check size={14}/> : "2"}</span><div><strong>Spicetify CLI</strong><small>{status?.spicetifyFound ? "Detected" : "Install the official CLI"}</small></div></div>
            <div className="wizard-progress-connector"/>
            <div className={status?.spotifyFound && status?.spicetifyFound ? "wizard-progress-step current" : "wizard-progress-step"}><span>3</span><div><strong>Verify</strong><small>Log in and refresh status</small></div></div>
          </div>
          {!status?.spotifyFound && <section className="panel wizard-card">
            <div className="wizard-card-icon spotify"><Activity size={21}/></div><div className="wizard-card-body"><div className="eyebrow">STEP 1</div><h2>Install Spotify</h2><p>SpiceDeck downloads Spotify from its official CDN and runs the platform-specific installation flow. Linux uses Spotify's official APT repository on Debian/Ubuntu-based systems, or a user-scoped Flathub install when Flatpak is available.</p>
              {status?.platform === "Windows" && <button className="button button-primary" onClick={() => void installSoftware("spotify")} disabled={!!installerBusy}><Download size={15}/> {installerBusy === "spotify" ? "Downloading and installing…" : "Download and install Spotify"}</button>}
              {status?.platform === "macOS" && <button className="button button-primary" onClick={() => void installSoftware("spotify")} disabled={!!installerBusy}><Download size={15}/> {installerBusy === "spotify" ? "Downloading and installing…" : "Download and install Spotify"}</button>}
              {status?.platform === "Linux" && <div className="wizard-platform-note"><strong>Linux installation depends on your distribution.</strong><p>SpiceDeck checks your Linux distribution and chooses the official Spotify APT repository on Debian/Ubuntu-based systems, or a user-scoped Flatpak install when Flatpak is available. Snap is not used because Spicetify cannot modify Snap Spotify.</p><button className="button button-primary" onClick={() => void installSoftware("spotify")} disabled={!!installerBusy}><Download size={15}/> {installerBusy === "spotify" ? "Installing Spotify…" : "Install Spotify automatically"}</button></div>}
              {!status?.platform && <p>Detecting your operating system…</p>}
              <div className="wizard-footnote">After installing, launch Spotify and sign in. Spicetify recommends leaving it open for at least 60 seconds so it can generate the files it needs.</div>
            </div>
          </section>}
          {status?.spotifyFound && <section className="panel wizard-card wizard-card-done"><div className="wizard-card-icon"><Check size={21}/></div><div className="wizard-card-body"><div className="eyebrow">STEP 1 COMPLETE</div><h2>Spotify detected</h2><p>SpiceDeck found a Spotify installation. It will still check compatibility before applying any modifications.</p></div></section>}
          {!status?.spicetifyFound && <section className="panel wizard-card">
            <div className="wizard-card-icon cli"><Terminal size={21}/></div><div className="wizard-card-body"><div className="eyebrow">STEP 2</div><h2>Install Spicetify CLI</h2><p>SpiceDeck downloads the latest stable CLI release directly from the official Spicetify GitHub releases, selects the correct OS and CPU build, installs it in your user profile, and verifies the executable.</p>
<button className="button button-primary" onClick={() => void installSoftware("spicetify")} disabled={!!installerBusy || !status?.spotifyFound}><Download size={15}/>{installerBusy === "spicetify" ? "Downloading and installing…" : "Install Spicetify automatically"}</button>
              {status?.platform === "Windows" && <p className="wizard-footnote">SpiceDeck installs the official release into your user-local application data folder. It does not require a global PATH change.</p>}
              {(status?.platform === "Linux" || status?.platform === "macOS") && <p className="wizard-footnote">SpiceDeck installs the official release into your user profile without running as root or modifying shell startup files.</p>}
              <button className="text-button wizard-doc-link" onClick={() => window.open("https://spicetify.co/docs/getting-started/", "_blank", "noopener,noreferrer")}>Read the official Spicetify guide <ExternalLink size={13}/></button>
            </div>
          </section>}
          {status?.spicetifyFound && <section className="panel wizard-card wizard-card-done"><div className="wizard-card-icon"><Check size={21}/></div><div className="wizard-card-body"><div className="eyebrow">STEP 2 COMPLETE</div><h2>Spicetify CLI detected</h2><p>Version {status.version ?? "detected"}. SpiceDeck can now use its existing maintenance and customization features.</p></div></section>}
          <section className="panel wizard-card">
            <div className="wizard-card-icon verify"><ShieldCheck size={21}/></div><div className="wizard-card-body"><div className="eyebrow">STEP 3</div><h2>Verify and continue</h2><p>Once Spotify and Spicetify are installed, launch Spotify, sign in, and leave it open for at least 60 seconds. Then refresh the status check.</p>
              <div className="wizard-checklist"><span className={status?.spotifyFound ? "checklist-item done" : "checklist-item"}>{status?.spotifyFound ? <Check size={14}/> : <span/>} Spotify detected</span><span className={status?.spicetifyFound ? "checklist-item done" : "checklist-item"}>{status?.spicetifyFound ? <Check size={14}/> : <span/>} Spicetify CLI detected</span></div>
              <div className="wizard-actions"><button className="button button-secondary" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Recheck status</button><button className="button button-primary" onClick={() => setSection(status?.spicetifyFound ? "Marketplace" : "Overview")} disabled={!status?.spicetifyFound}><Check size={14}/> Continue to SpiceDeck</button></div>
              {status?.spotifyFound && status?.spicetifyFound && <div className="wizard-initialize"><p>Have you opened Spotify, signed in, and left it running for at least 60 seconds? SpiceDeck can now create Spicetify's backup and apply its initial customization files.</p><button className="button button-primary" disabled={!!busyAction || !!installerBusy} onClick={() => { if (window.confirm("Initialize Spicetify? This creates a backup and applies Spicetify's default modifications to Spotify.")) void runAction("setup"); }}><ShieldCheck size={15}/>{busyAction === "setup" ? "Initializing…" : "Initialize and apply Spicetify"}</button></div>}
              {status?.spicetifyFound && !status.spotifyFound && <p className="wizard-warning">Spicetify was found, but Spotify was not detected at a known path. Confirm Spotify's install type and path before applying changes.</p>}
            </div>
          </section>
          <div className="marketplace-footnote">SpiceDeck selects an installer based on the OS and Linux distribution. System package installation may trigger the OS authorization prompt. The Spicetify CLI is installed in your user profile, and existing installations are checked before downloading.</div>
        </>}

        {section === "Marketplace" && <>
          <div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> COMMUNITY CATALOG</div><h1>Marketplace<span>.</span></h1><p>Discover community themes, extensions, and custom apps from GitHub.</p></div><button className="button button-secondary" onClick={() => { setMarketplaceLoadedCategory(""); void refreshMarketplace(marketplaceCategory); }} disabled={marketplaceLoading}><RefreshCw size={14} className={marketplaceLoading ? "spin" : ""}/> Refresh catalog</button></div>
          <div className="marketplace-safety"><ShieldCheck size={17}/><div><strong>Browse first, inspect before installing.</strong><span>These projects are community-maintained repositories, not an endorsement by SpiceDeck or Spicetify. Customizations can execute code inside Spotify. Review the source before installing.</span></div></div>
          <div className="marketplace-toolbar"><div className="marketplace-tabs" role="tablist" aria-label="Marketplace category">
            {(["Themes", "Extensions", "Custom Apps"] as MarketplaceCategory[]).map(category => <button key={category} role="tab" aria-selected={marketplaceCategory === category} className={marketplaceCategory === category ? "marketplace-tab active" : "marketplace-tab"} onClick={() => { setMarketplaceCategory(category); setMarketplaceLoadedCategory(""); }}>{category}</button>)}
          </div><label className="search-box marketplace-search"><Search size={15}/><input value={marketplaceQuery} onChange={event => setMarketplaceQuery(event.target.value)} placeholder={"Search " + marketplaceCategory.toLowerCase() + "…"}/></label></div>
          {marketplaceError && <div className="notice"><X size={16}/><span>{marketplaceError}</span><button onClick={() => { setMarketplaceError(""); setMarketplaceLoadedCategory(""); void refreshMarketplace(marketplaceCategory); }}><RefreshCw size={14}/></button></div>}
          {marketplaceLoading ? <div className="panel marketplace-empty"><LoaderCircle size={22} className="spin"/><strong>Loading community catalog…</strong><span>Fetching public GitHub repository metadata.</span></div> : <>
            <div className="marketplace-results-heading"><span>{marketplaceItems.filter(item => (item.full_name + " " + (item.description ?? "")).toLowerCase().includes(marketplaceQuery.toLowerCase())).length} repositories</span><span>Source: GitHub topic <code>spicetify-{marketplaceCategory === "Custom Apps" ? "apps" : marketplaceCategory.toLowerCase()}</code></span></div>
            <div className="marketplace-grid">{marketplaceItems.filter(item => (item.full_name + " " + (item.description ?? "")).toLowerCase().includes(marketplaceQuery.toLowerCase())).map(item => <article className="marketplace-card" key={item.id}>
              <div className="marketplace-card-top"><div className="marketplace-card-icon"><Globe size={18}/></div><span className="marketplace-source">GitHub repository</span></div>
              <h3>{item.full_name}</h3><p>{item.description || "No description provided by the repository owner."}</p>
              <div className="marketplace-meta"><span><Star size={13}/>{item.stargazers_count.toLocaleString()}</span><span><Clock3 size={13}/>Updated {new Date(item.pushed_at).toLocaleDateString()}</span>{item.language && <span>{item.language}</span>}</div>
              <div className="marketplace-card-footer"><span className="tag tag-muted">{marketplaceCategory === "Custom Apps" ? "Custom app" : marketplaceCategory.slice(0, -1)}</span><button className="button button-secondary" onClick={() => window.open(item.html_url, "_blank", "noopener,noreferrer")}>Inspect source <ExternalLink size={13}/></button></div>
            </article>)}</div>
            {!marketplaceItems.length && !marketplaceError && <div className="panel marketplace-empty"><Globe size={22}/><strong>No repositories found</strong><span>The GitHub topic may have no matching repositories right now.</span></div>}
            {marketplaceItems.length > 0 && !marketplaceItems.some(item => (item.full_name + " " + (item.description ?? "")).toLowerCase().includes(marketplaceQuery.toLowerCase())) && <div className="panel marketplace-empty"><Search size={22}/><strong>No matches</strong><span>Try a shorter search phrase.</span></div>}
          </>}
          <div className="marketplace-footnote">Discovery is read-only in this initial marketplace milestone. Installation and removal will be added after package validation and safe file handling are in place.</div>
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