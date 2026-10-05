import { ipcMain } from "electron";
import { API_METHODS, channelFor } from "@shared/api";
import type { Dispatcher } from "./dispatcher";

/** Registers exactly one ipcMain handler per allow-listed method; nothing else is reachable. */
export function registerIpc(dispatcher: Dispatcher, isTrustedUrl: (url: string) => boolean): void {
  for (const [ns, methods] of Object.entries(API_METHODS)) {
    for (const method of methods as readonly string[]) {
      ipcMain.handle(channelFor(ns, method), (event, input: unknown) => {
        const frame = event.senderFrame;
        const trusted = !!frame && frame === event.sender.mainFrame && isTrustedUrl(frame.url);
        return dispatcher.invoke(ns, method, input, { trusted });
      });
    }
  }
}
