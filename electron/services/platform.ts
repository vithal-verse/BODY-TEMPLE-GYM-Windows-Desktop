/**
 * Everything the services need from the host that isn't plain Node: native dialogs, shell and
 * OS-level secret encryption. Electron implements it (main/platform.ts); tests use a fake.
 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Platform {
  saveFile(o: { defaultName: string; title?: string; filters?: FileFilter[] }): Promise<string | null>;
  openFile(o: { title?: string; filters?: FileFilter[] }): Promise<string | null>;
  openFolder(o?: { title?: string }): Promise<string | null>;
  confirm(o: { title: string; message: string; detail?: string; confirmLabel: string; cancelLabel?: string }): Promise<boolean>;
  openPath(path: string): Promise<void>;
  secretsAvailable(): boolean;
  encryptSecret(plain: string): string;
  decryptSecret(cipher: string): string;
}
