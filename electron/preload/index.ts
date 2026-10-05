import { contextBridge, ipcRenderer } from "electron";
import { API_METHODS, channelFor, EVENT_NAVIGATE, EVENT_SESSION_ENDED } from "@shared/api";

/**
 * The only bridge between the web page and the app. It is generated from the static allow-list in
 * shared/api.ts: the page gets named functions that send one validated message each — no `ipcRenderer`,
 * no `require`, no generic invoke.
 */
const api: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {};
for (const [ns, methods] of Object.entries(API_METHODS)) {
  api[ns] = {};
  for (const method of methods as readonly string[]) {
    api[ns][method] = (input?: unknown) => ipcRenderer.invoke(channelFor(ns, method), input);
  }
}

const subscribe = (channel: string, cb: (value: string) => void) => {
  const handler = (_e: unknown, value: unknown) => {
    if (typeof value === "string") cb(value);
  };
  ipcRenderer.on(channel, handler);
  return () => void ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("gym", {
  ...api,
  events: {
    onNavigate: (cb: (path: string) => void) => subscribe(EVENT_NAVIGATE, cb),
    onSessionEnded: (cb: (reason: string) => void) => subscribe(EVENT_SESSION_ENDED, cb),
  },
  platform: process.platform,
});
