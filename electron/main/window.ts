import { app, BrowserWindow, Menu, screen, shell, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../services/logger";

type WindowState = { width?: number; height?: number; x?: number; y?: number; maximized?: boolean };

function loadState(file: string): WindowState {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as WindowState;
    const fits = s.x !== undefined && s.y !== undefined && screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return s.x! >= b.x - 50 && s.y! >= b.y - 50 && s.x! < b.x + b.width - 100 && s.y! < b.y + b.height - 100;
    });
    return { width: s.width, height: s.height, maximized: s.maximized, ...(fits ? { x: s.x, y: s.y } : {}) };
  } catch {
    return {};
  }
}

export interface WindowOptions {
  preload: string;
  icon?: string;
  url: string;
  stateFile: string;
  isTrustedUrl: (url: string) => boolean;
  log: Logger;
}

export function createMainWindow(o: WindowOptions): BrowserWindow {
  const st = loadState(o.stateFile);
  const win = new BrowserWindow({
    width: st.width ?? 1360, height: st.height ?? 860, x: st.x, y: st.y, minWidth: 1024, minHeight: 680,
    show: false, backgroundColor: "#0a0908", title: "Body Temple Gym", icon: o.icon && fs.existsSync(o.icon) ? o.icon : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: o.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged,
    },
  });
  if (st.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  let saveTimer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    try {
      fs.mkdirSync(path.dirname(o.stateFile), { recursive: true });
      fs.writeFileSync(o.stateFile, JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch {
      /* not critical */
    }
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", save);

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url); // e.g. a docs link; never opens inside the app
    return { action: "deny" };
  });
  const lock = (e: Electron.Event, url: string) => {
    if (!o.isTrustedUrl(url)) {
      e.preventDefault();
      o.log.warn("Blocked navigation to an external address");
    }
  };
  wc.on("will-navigate", lock);
  wc.on("will-redirect", lock);
  wc.on("render-process-gone", (_e, d) => {
    o.log.error("Renderer process gone", d);
    if (d.reason !== "clean-exit" && !win.isDestroyed()) wc.reload();
  });
  wc.on("did-fail-load", (_e, code, desc, url) => o.log.error(`Page failed to load (${code} ${desc})`, { url }));
  wc.on("context-menu", (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    if (p.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" });
    else if (p.selectionText) items.push({ role: "copy" });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  void win.loadURL(o.url);
  return win;
}

export function buildAppMenu(h: {
  navigate: (path: string) => void;
  backupNow: () => void;
  openLogs: () => void;
  openData: () => void;
  about: () => void;
  isDev: boolean;
}): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "&File",
      submenu: [
        { label: "Back up database now", accelerator: "CmdOrCtrl+B", click: h.backupNow },
        { label: "Backup && restore…", click: () => h.navigate("/dashboard/settings/?tab=data") },
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => h.navigate("/dashboard/settings/") },
        { type: "separator" },
        { role: "quit", label: "Exit" },
      ],
    },
    {
      label: "&View",
      submenu: [
        { role: "resetZoom", label: "Actual size" }, { role: "zoomIn", label: "Zoom in" }, { role: "zoomOut", label: "Zoom out" },
        { type: "separator" }, { role: "togglefullscreen", label: "Full screen" },
        ...(h.isDev ? ([{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }] as MenuItemConstructorOptions[]) : []),
      ],
    },
    {
      label: "&Help",
      submenu: [
        { label: "Open log folder", click: h.openLogs },
        { label: "Open data folder", click: h.openData },
        { type: "separator" },
        { label: "About Body Temple Gym", click: h.about },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
