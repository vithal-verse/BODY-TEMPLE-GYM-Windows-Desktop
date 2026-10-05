import { app } from "electron";
import path from "node:path";

export interface AppPaths {
  dataDir: string;
  dbPath: string;
  backupDir: string;
  logDir: string;
  stateFile: string;
}

/**
 * Everything lives under Electron's per-user data directory (%APPDATA%\Body Temple Gym on Windows) —
 * never next to the program files, so updates and uninstalls leave the data alone.
 * BTG_DATA_DIR is honoured only in development/testing builds.
 */
export function resolvePaths(): AppPaths {
  const override = !app.isPackaged ? process.env.BTG_DATA_DIR : undefined;
  const root = override ? path.resolve(override) : app.getPath("userData");
  return {
    dataDir: root,
    dbPath: path.join(root, "data", "gym.sqlite"),
    backupDir: path.join(root, "backups"),
    logDir: path.join(root, "logs"),
    stateFile: path.join(root, "window-state.json"),
  };
}
