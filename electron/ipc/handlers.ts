import { z } from "zod";
import type { GymApi } from "@shared/api";
import { AppError } from "@shared/errors";
import { MEMBER_STATUS_VALUES, PAYMENT_METHOD_VALUES, type ActionResult, type AppInfo } from "@shared/types";
import type { Services } from "../services";
import { isDateStr, writeFileAtomic } from "../services/util";

export type Access = "public" | "session" | "owner";
export type HostInfo = Omit<AppInfo, "schemaVersion" | "dbSizeBytes" | "lastIntegrityCheck">;
export type HandlerCtx = Services & { host: HostInfo };
export type Def<I, O> = { access: Access; schema: z.ZodType<I>; run: (input: I, ctx: HandlerCtx) => O | Promise<O> };

/** One handler per GymApi method — a missing or mistyped entry is a compile error. */
export type HandlerMap = {
  [NS in keyof GymApi]: {
    [M in keyof GymApi[NS]]: GymApi[NS][M] extends (...a: infer A) => Promise<infer O> ? Def<A extends [infer I] ? I : undefined, O> : never;
  };
};

// ---- reusable field schemas ----------------------------------------------------
const id = z.string().min(1).max(100);
const planId = z.number().int().positive();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format yyyy-mm-dd.").refine(isDateStr, "That date doesn't exist.");
const money = z.number().finite().min(0, "Amounts can't be negative.").max(100_000_000, "That amount is too large.");
const method = z.enum(PAYMENT_METHOD_VALUES);
const optText = (max: number) => z.string().max(max).nullable().optional();
const page = z.number().int().min(1).max(1_000_000).optional();
const sortDir = z.enum(["asc", "desc"]).optional();
const none = z.undefined();

const idOnly = z.object({ id });
const memberIdOnly = z.object({ memberId: id });
const planInput = z.object({
  name: z.string().trim().min(1, "Plan name is required.").max(80),
  duration_months: z.number().int().min(1).max(60),
  fee_amount: money,
});
const memberCommon = {
  name: z.string().trim().min(1, "Name is required.").max(120),
  age: z.number().int().min(1).max(120).nullable().optional(),
  email: optText(200),
  phone: optText(40),
  plan_id: planId.nullable().optional(),
  start_date: dateStr,
  end_date: dateStr.nullable().optional(),
  amount_due: money.optional(),
  notes: optText(2000),
};
const memberCreate = z.object({ ...memberCommon, initial_payment: money.optional(), payment_method: method.optional() });
const memberUpdate = z.object(memberCommon);
const renewInput = z.object({
  plan_id: planId.nullable().optional(), start_date: dateStr, end_date: dateStr.nullable().optional(),
  amount_due: money.optional(), paid_now: money.optional(), method: method.optional(),
});
const paymentInput = z.object({ amount: money, method, notes: optText(500) });
const memberList = z.object({
  query: z.string().max(200).optional(),
  status: z.enum(["all", ...MEMBER_STATUS_VALUES, "expiring"]).optional(),
  sortKey: z.enum(["name", "start_date", "end_date", "fees_paid", "created_at"]).optional(),
  sortDir, page, pageSize: z.number().int().min(1).max(500).optional(),
});
const revenueQuery = z.object({
  startIso: z.string().min(10).max(40), endIso: z.string().min(10).max(40),
  method: z.enum(["all", ...PAYMENT_METHOD_VALUES]).optional(), query: z.string().max(200).optional(),
  sortKey: z.enum(["paid_at", "amount"]).optional(), sortDir, page, pageSize: z.number().int().min(1).max(500).optional(),
});
const historyQuery = z.object({
  query: z.string().max(200).optional(), startDate: dateStr.optional(), endDate: dateStr.optional(),
  page, pageSize: z.number().int().min(1).max(200).optional(),
});
const password = z.string().min(1).max(128);
const email = z.string().trim().min(3).max(200);
const fileName = z.object({ fileName: z.string().min(1).max(200) });
const importMode = z.enum(["merge", "replace"]);

const CSV = [{ name: "CSV file", extensions: ["csv"] }];
const DB = [{ name: "Body Temple Gym backup", extensions: ["sqlite"] }];
const stamp = (d: Date) => d.toISOString().slice(0, 10);
const when = (iso: string) => new Date(iso).toLocaleString();

async function saveCsv(ctx: HandlerCtx, f: { fileName: string; content: string }, title: string): Promise<ActionResult> {
  const dest = await ctx.platform.saveFile({ defaultName: f.fileName, title, filters: CSV });
  if (!dest) return { done: false };
  writeFileAtomic(dest, f.content);
  return { done: true, path: dest };
}

const confirmReplace = (ctx: HandlerCtx, detail: string) =>
  ctx.platform.confirm({
    title: "Replace all current data?", message: "This will replace ALL current gym data.", confirmLabel: "Replace data", cancelLabel: "Cancel",
    detail: `${detail}\n\nA safety copy of your current data is saved first, so this can be undone from Settings → Data safety.`,
  });

export function buildHandlers(): HandlerMap {
  return {
    auth: {
      status: { access: "public", schema: none, run: (_, c) => c.auth.status() },
      setup: { access: "public", schema: z.object({ full_name: z.string().max(120), email, password }), run: (i, c) => c.auth.setup(i) },
      login: { access: "public", schema: z.object({ email, password }), run: (i, c) => c.auth.login(i) },
      logout: { access: "public", schema: none, run: (_, c) => c.auth.logout() },
      changePassword: { access: "session", schema: z.object({ currentPassword: password, newPassword: password }), run: (i, c) => c.auth.changePassword(i) },
      resetPassword: { access: "public", schema: z.object({ email, recoveryCode: z.string().min(1).max(64), newPassword: password }), run: (i, c) => c.auth.resetPassword(i) },
      listAdmins: { access: "session", schema: none, run: (_, c) => c.auth.listAdmins() },
      createAdmin: { access: "owner", schema: z.object({ full_name: z.string().max(120), email, password, role: z.enum(["admin", "owner"]) }), run: (i, c) => c.auth.createAdmin(i) },
      removeAdmin: { access: "owner", schema: idOnly, run: (i, c) => c.auth.removeAdmin(i) },
    },
    plans: {
      list: { access: "session", schema: none, run: (_, c) => c.plans.list() },
      create: { access: "session", schema: planInput, run: (i, c) => c.plans.create(i) },
      update: { access: "session", schema: z.object({ id: planId, patch: planInput }), run: (i, c) => c.plans.update(i) },
      remove: { access: "session", schema: z.object({ id: planId }), run: (i, c) => c.plans.remove(i) },
    },
    members: {
      list: { access: "session", schema: memberList, run: (i, c) => c.members.list(i) },
      get: { access: "session", schema: idOnly, run: (i, c) => c.members.get(i.id) },
      search: { access: "session", schema: z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(50).optional() }), run: (i, c) => c.members.search(i.query, i.limit) },
      create: { access: "session", schema: memberCreate, run: (i, c) => c.members.create(i) },
      update: { access: "session", schema: z.object({ id, patch: memberUpdate }), run: (i, c) => c.members.update(i.id, i.patch) },
      remove: { access: "session", schema: idOnly, run: (i, c) => c.members.remove(i.id) },
      pause: { access: "session", schema: idOnly, run: (i, c) => c.members.pause(i.id) },
      resume: { access: "session", schema: idOnly, run: (i, c) => c.members.resume(i.id) },
      renew: { access: "session", schema: z.object({ id, input: renewInput }), run: (i, c) => c.members.renew(i.id, i.input) },
      recordPayment: { access: "session", schema: z.object({ id, input: paymentInput }), run: (i, c) => c.members.recordPayment(i.id, i.input) },
      renewals: { access: "session", schema: memberIdOnly, run: (i, c) => c.members.renewals(i.memberId) },
      currentRenewal: { access: "session", schema: memberIdOnly, run: (i, c) => c.members.currentRenewal(i.memberId) },
      payments: { access: "session", schema: memberIdOnly, run: (i, c) => c.members.payments(i.memberId) },
    },
    attendance: {
      checkIn: { access: "session", schema: memberIdOnly, run: (i, c) => c.attendance.checkIn(i.memberId) },
      checkOut: { access: "session", schema: z.object({ sessionId: id }), run: (i, c) => c.attendance.checkOut(i.sessionId) },
      active: { access: "session", schema: none, run: (_, c) => c.attendance.active() },
      stats: { access: "session", schema: none, run: (_, c) => c.attendance.stats() },
      trend: { access: "session", schema: none, run: (_, c) => c.attendance.trend() },
      history: { access: "session", schema: historyQuery, run: (i, c) => c.attendance.history(i) },
      memberHistory: { access: "session", schema: z.object({ memberId: id, limit: z.number().int().min(1).max(500).optional() }), run: (i, c) => c.attendance.memberHistory(i) },
    },
    dashboard: { stats: { access: "session", schema: none, run: (_, c) => c.dashboard.stats() } },
    revenue: {
      report: { access: "session", schema: revenueQuery, run: (i, c) => c.revenue.report(i) },
      trend: { access: "session", schema: none, run: (_, c) => c.revenue.trend() },
    },
    exports: {
      members: { access: "session", schema: none, run: (_, c) => saveCsv(c, c.exports.members(), "Export members") },
      revenue: { access: "session", schema: revenueQuery, run: (i, c) => saveCsv(c, c.exports.revenueCsv(i), "Export revenue") },
    },
    backup: {
      list: { access: "session", schema: none, run: (_, c) => c.backup.list() },
      create: { access: "session", schema: none, run: (_, c) => c.backup.create("manual") },
      exportTo: {
        access: "session", schema: none,
        run: async (_, c) => {
          const dest = await c.platform.saveFile({ defaultName: `BodyTempleGym-backup-${stamp(c.clock())}.sqlite`, title: "Export a backup of the database", filters: DB });
          return dest ? c.backup.exportTo(dest) : { done: false };
        },
      },
      restoreFromList: {
        access: "owner", schema: fileName,
        run: async (i, c) => {
          const entry = c.backup.list().find((b) => b.fileName === i.fileName);
          if (!entry) throw new AppError("NOT_FOUND", "That backup file no longer exists.");
          const ok = await confirmReplace(c, `Everything will go back to how it was on ${when(entry.createdAt)}.`);
          return ok ? c.backup.restoreFromList(i.fileName) : { done: false };
        },
      },
      restoreFromFile: {
        access: "owner", schema: none,
        run: async (_, c) => {
          const file = await c.platform.openFile({ title: "Choose a backup to restore", filters: DB });
          if (!file) return { done: false };
          const v = c.backup.verifyFile(file);
          if (!v.ok) throw new AppError("VALIDATION", `That file can't be restored: ${v.message}`);
          const ok = await confirmReplace(c, `The file contains ${v.memberCount} member${v.memberCount === 1 ? "" : "s"}.`);
          return ok ? c.backup.restore(file) : { done: false };
        },
      },
      verify: { access: "session", schema: fileName, run: (i, c) => c.backup.verify(i.fileName) },
      remove: { access: "owner", schema: fileName, run: (i, c) => c.backup.remove(i.fileName) },
      getSettings: { access: "session", schema: none, run: (_, c) => c.backup.getSettings() },
      saveSettings: {
        access: "session",
        schema: z.object({ autoEnabled: z.boolean(), intervalHours: z.number().int().min(1).max(720), keepAuto: z.number().int().min(1).max(365), secondaryDir: z.string().max(500).nullable() }),
        run: (i, c) => c.backup.saveSettings(i),
      },
      chooseSecondaryDir: { access: "session", schema: none, run: (_, c) => c.platform.openFolder({ title: "Choose a second folder for backup copies (e.g. a USB drive or OneDrive)" }) },
      checkIntegrity: { access: "session", schema: none, run: (_, c) => c.backup.checkIntegrity() },
    },
    sheets: {
      getConfig: { access: "session", schema: none, run: (_, c) => c.sheets.getConfig() },
      saveConfig: {
        access: "session",
        schema: z.object({ spreadsheetId: z.string().max(400), clientEmail: z.string().max(200), privateKey: z.string().max(20_000).optional(), autoSync: z.boolean() }),
        run: (i, c) => c.sheets.saveConfig(i),
      },
      test: { access: "session", schema: none, run: (_, c) => c.sheets.test() },
      push: { access: "session", schema: none, run: (_, c) => c.sheets.push() },
      pull: { access: "session", schema: none, run: (_, c) => c.sheets.pull() },
    },
    importer: {
      fromFolder: {
        access: "owner", schema: z.object({ mode: importMode }),
        run: async (i, c) => {
          const dir = await c.platform.openFolder({ title: "Choose the folder containing the exported Supabase tables" });
          if (!dir) return null;
          if (i.mode === "replace" && !(await confirmReplace(c, "Members, payments and attendance in this folder will replace what's in the app now."))) return null;
          return c.importer.fromFolder(dir, i.mode);
        },
      },
      fromSupabase: {
        access: "owner", schema: z.object({ url: z.string().max(300), serviceKey: z.string().max(5000), mode: importMode }),
        run: async (i, c) => {
          if (i.mode === "replace" && !(await confirmReplace(c, "Everything currently in the app will be replaced by what's in Supabase."))) {
            throw new AppError("VALIDATION", "Import cancelled. Nothing was changed.");
          }
          return c.importer.fromSupabase(i);
        },
      },
    },
    system: {
      info: {
        access: "session", schema: none,
        run: (_, c) => ({ ...c.host, schemaVersion: c.mgr.schemaVersion, dbSizeBytes: c.mgr.sizeBytes, lastIntegrityCheck: c.backup.lastIntegrity() }),
      },
      openLogs: { access: "session", schema: none, run: (_, c) => c.platform.openPath(c.host.logDir) },
      openDataFolder: { access: "session", schema: none, run: (_, c) => c.platform.openPath(c.host.dataDir) },
    },
  };
}
