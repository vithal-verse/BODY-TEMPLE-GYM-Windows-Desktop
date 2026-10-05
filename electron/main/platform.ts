import { BrowserWindow, dialog, safeStorage, shell } from "electron";
import type { Platform } from "../services/platform";

/** Native dialogs, shell access and OS-level (DPAPI on Windows) secret encryption for the services. */
export function createElectronPlatform(getWindow: () => BrowserWindow | null): Platform {
  const win = () => getWindow() ?? undefined;
  return {
    async saveFile({ defaultName, title, filters }) {
      const opts = { title, defaultPath: defaultName, filters, properties: ["createDirectory", "showOverwriteConfirmation"] as ("createDirectory" | "showOverwriteConfirmation")[] };
      const r = win() ? await dialog.showSaveDialog(win()!, opts) : await dialog.showSaveDialog(opts);
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    async openFile({ title, filters }) {
      const opts = { title, filters, properties: ["openFile"] as "openFile"[] };
      const r = win() ? await dialog.showOpenDialog(win()!, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    },
    async openFolder(o) {
      const opts = { title: o?.title, properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
      const r = win() ? await dialog.showOpenDialog(win()!, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    },
    async confirm({ title, message, detail, confirmLabel, cancelLabel }) {
      const opts = { type: "warning" as const, title, message, detail, buttons: [confirmLabel, cancelLabel ?? "Cancel"], defaultId: 1, cancelId: 1, noLink: true };
      const r = win() ? await dialog.showMessageBox(win()!, opts) : await dialog.showMessageBox(opts);
      return r.response === 0; // the safe choice (Cancel) is the default
    },
    async openPath(p) {
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
    },
    secretsAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptSecret: (plain) => safeStorage.encryptString(plain).toString("base64"),
    decryptSecret: (cipher) => safeStorage.decryptString(Buffer.from(cipher, "base64")),
  };
}
