import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import path from "node:path";
import { EVENT_NAVIGATE, EVENT_SESSION_ENDED } from "@shared/api";
import { DatabaseManager } from "../database/manager";
import { Dispatcher } from "../ipc/dispatcher";
import type { HostInfo } from "../ipc/handlers";
import { registerIpc } from "../ipc/register";
import { createServices } from "../services";
import { createFileLogger } from "../services/logger";
import { resolvePaths } from "./paths";
import { createElectronPlatform } from "./platform";
import { APP_ORIGIN, registerAppProtocol, registerSchemePrivileges } from "./protocol";
import { buildAppMenu, createMainWindow } from "./window";

const DEV_URL = !app.isPackaged ? process.env.BTG_DEV_URL : undefined;
const TRUSTED_ORIGINS = [APP_ORIGIN, ...(DEV_URL ? [new URL(DEV_URL).origin] : [])];
const isTrustedUrl = (url: string) => TRUSTED_ORIGINS.some((o) => url === o || url.startsWith(o + "/"));

app.setAppUserModelId("com.bodytemple.gym"); // groups the taskbar icon + notifications correctly on Windows
registerSchemePrivileges();

// Web content can never attach <webview>s, open windows, or ask for device permissions.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (e) => e.preventDefault());
});

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit(); // a second copy would fight over the database file
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void start();
}

async function start(): Promise<void> {
  await app.whenReady();
  const paths = resolvePaths();
  const log = createFileLogger(paths.logDir, { level: app.isPackaged ? "info" : "debug", echo: !app.isPackaged });
  process.on("uncaughtException", (e) => log.error("uncaughtException", e));
  process.on("unhandledRejection", (e) => log.error("unhandledRejection", e));
  log.info(`Starting ${app.getName()} ${app.getVersion()} (Electron ${process.versions.electron}, Node ${process.versions.node}); data: ${paths.dataDir}`);

  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const mgr = new DatabaseManager(paths.dbPath, log);
  const platform = createElectronPlatform(() => mainWindow);
  const services = createServices({
    mgr, log, platform, backupDir: paths.backupDir,
    onSessionInvalidated: (reason) => mainWindow?.webContents.send(EVENT_SESSION_ENDED, reason),
  });

  try {
    await mgr.open(() => services.backup.snapshotBeforeMigration()); // existing data is copied aside before any schema upgrade
  } catch (err) {
    log.error("Database failed to open", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    const r = dialog.showMessageBoxSync({
      type: "error", title: "Body Temple Gym", message: "Body Temple Gym couldn't open its database.",
      detail: `${msg}\n\nNothing has been changed or deleted. Your backups are in:\n${paths.backupDir}`,
      buttons: ["Open backup folder", "Quit"], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (r === 0) await shell.openPath(paths.backupDir);
    app.exit(1);
    return;
  }

  services.backup.cleanupPartials();
  services.members.refreshStatuses();

  const host: HostInfo = {
    name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    node: process.versions.node, platform: process.platform, dataDir: paths.dataDir, dbPath: paths.dbPath,
    backupDir: paths.backupDir, logDir: paths.logDir,
  };
  registerIpc(new Dispatcher({ ...services, host }, log), isTrustedUrl);

  const root = path.join(app.getAppPath(), "out");
  if (!DEV_URL) registerAppProtocol(root);

  const send = (channel: string, value: string) => mainWindow?.webContents.send(channel, value);
  const info = (message: string, detail?: string, type: "info" | "error" = "info") =>
    mainWindow ? dialog.showMessageBox(mainWindow, { type, title: "Body Temple Gym", message, detail, noLink: true }) : dialog.showMessageBox({ type, title: "Body Temple Gym", message, detail, noLink: true });

  Menu.setApplicationMenu(
    buildAppMenu({
      isDev: !app.isPackaged,
      navigate: (p) => send(EVENT_NAVIGATE, p),
      backupNow: () => {
        void services.backup.create("manual").then(
          (b) => info("Backup complete", `Saved as ${b.fileName}\nin ${paths.backupDir}`),
          (e: unknown) => info("The backup failed", e instanceof Error ? e.message : String(e), "error")
        );
      },
      openLogs: () => void shell.openPath(paths.logDir),
      openData: () => void shell.openPath(paths.dataDir),
      about: () => void info(`Body Temple Gym ${app.getVersion()}`, `Works fully offline.\nYour data is stored on this PC in:\n${paths.dataDir}`),
    })
  );

  mainWindow = createMainWindow({
    preload: path.join(__dirname, "preload.js"),
    icon: path.join(app.getAppPath(), "build", "icon.png"),
    url: DEV_URL ?? `${APP_ORIGIN}/`,
    stateFile: paths.stateFile, isTrustedUrl, log,
  });
  mainWindow.on("closed", () => (mainWindow = null));
  mainWindow.on("focus", () => safe("status refresh", () => services.members.refreshStatuses()));

  // ---- background upkeep (all non-blocking, all failure-tolerant) ----
  const safe = (what: string, fn: () => unknown) => {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((e) => log.error(`${what} failed`, e));
    } catch (e) {
      log.error(`${what} failed`, e);
    }
  };
  const timers: NodeJS.Timeout[] = [
    setInterval(() => safe("status refresh", () => services.members.refreshStatuses()), 60 * 60_000),
    setTimeout(() => safe("automatic backup", () => services.backup.maybeAutoBackup()), 20_000),
    setInterval(() => safe("automatic backup", () => services.backup.maybeAutoBackup()), 30 * 60_000),
    setTimeout(() => safe("integrity check", () => services.backup.checkIntegrity()), 60_000),
  ];
  timers.forEach((t) => t.unref());

  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    timers.forEach((t) => clearTimeout(t));
    services.sheets.dispose();
    // let any backup that is mid-flight finish (max 8 s), then close the database cleanly
    void Promise.race([services.backup.drain(), new Promise((r) => setTimeout(r, 8000))]).finally(() => {
      try {
        mgr.close();
      } catch (err) {
        log.error("Closing the database failed", err);
      }
      log.info("Shut down cleanly");
      app.quit();
    });
  });
  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !quitting) app.relaunch();
  });
}
