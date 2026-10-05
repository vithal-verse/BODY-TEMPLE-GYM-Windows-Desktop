import type { Result } from "@shared/errors";
import type { Logger } from "../services/logger";
import { toApiError } from "./errors";
import { buildHandlers, type Def, type HandlerCtx, type HandlerMap } from "./handlers";

type AnyDef = Def<unknown, unknown>;

/**
 * Transport-agnostic request pipeline: sender check → allow-list lookup → session check →
 * payload validation → handler → friendly Result. Electron's ipcMain is wired to this in register.ts,
 * which keeps every security rule unit-testable without Electron.
 */
export class Dispatcher {
  private readonly map: Record<string, Record<string, AnyDef>>;

  constructor(private readonly ctx: HandlerCtx, private readonly log: Logger, handlers: HandlerMap = buildHandlers()) {
    this.map = handlers as unknown as Record<string, Record<string, AnyDef>>;
  }

  has(ns: string, method: string): boolean {
    return Object.hasOwn(this.map, ns) && Object.hasOwn(this.map[ns], method);
  }

  async invoke(ns: string, method: string, raw: unknown, opts: { trusted: boolean }): Promise<Result<unknown>> {
    const where = `${ns}.${method}`;
    if (!opts.trusted) {
      this.log.warn(`Blocked ${where}: request did not come from the app's own window`);
      return { ok: false, error: { code: "FORBIDDEN", message: "That request was blocked." } };
    }
    if (!this.has(ns, method)) return { ok: false, error: { code: "NOT_FOUND", message: "Unknown action." } };
    const def = this.map[ns][method];
    try {
      await this.ctx.backup.whenIdle(); // a restore may be swapping the database file
      if (def.access === "owner") this.ctx.auth.requireOwner();
      else if (def.access === "session") this.ctx.auth.requireSession();
      const parsed = def.schema.safeParse(raw === null ? undefined : raw);
      if (!parsed.success) throw parsed.error;
      return { ok: true, data: await def.run(parsed.data, this.ctx) };
    } catch (e) {
      return { ok: false, error: toApiError(e, this.log, where) };
    }
  }
}
