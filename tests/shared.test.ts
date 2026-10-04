import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toPaise, fromPaise, parseMoneyToPaise } from "@shared/money";
import { computeStatus } from "@shared/status";
import { buildCsv, csvToObjects, guardFormula, parseCsv, toCsvValue } from "@shared/csv";
import { attendanceTrend, revenueTrend } from "@shared/trends";
import { API_METHODS, channelFor } from "@shared/api";
import { createFileLogger, redact } from "../electron/services/logger";

describe("money", () => {
  it("round-trips rupees through integer paise without float drift", () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(1500)).toBe(150000);
    expect(toPaise(1499.995)).toBe(150000);
    expect(fromPaise(150050)).toBe(1500.5);
    expect(toPaise(null)).toBe(0);
    expect(toPaise(Number.NaN)).toBe(0);
  });

  it("parses Postgres numeric strings exactly", () => {
    expect(parseMoneyToPaise("1500.00")).toBe(150000);
    expect(parseMoneyToPaise("1,500.50")).toBe(150050);
    expect(parseMoneyToPaise("12.5")).toBe(1250);
    expect(parseMoneyToPaise("-3.07")).toBe(-307);
    expect(parseMoneyToPaise("")).toBe(0);
    expect(parseMoneyToPaise(null)).toBe(0);
    expect(parseMoneyToPaise("abc")).toBe(0);
  });
});

describe("member status (port of the Postgres set_member_status trigger)", () => {
  const today = "2026-10-03";
  it("never overrides an explicit pause", () => {
    expect(computeStatus("paused", "2020-01-01", today)).toBe("paused");
    expect(computeStatus("paused", null, today)).toBe("paused");
  });
  it("expires anyone whose end date has passed", () => {
    expect(computeStatus("active", "2026-10-02", today)).toBe("expired");
  });
  it("keeps today's end date active and revives expired rows with a future/no end date", () => {
    expect(computeStatus("active", "2026-10-03", today)).toBe("active");
    expect(computeStatus("expired", "2026-10-03", today)).toBe("active");
    expect(computeStatus("expired", null, today)).toBe("active");
    expect(computeStatus("expired", "2026-10-02", today)).toBe("expired");
  });
});

describe("csv", () => {
  it("quotes values the way the web app's export did", () => {
    expect(toCsvValue("plain")).toBe("plain");
    expect(toCsvValue("a,b")).toBe('"a,b"');
    expect(toCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvValue(null)).toBe("");
    expect(toCsvValue(0)).toBe("0");
  });

  it("round-trips awkward cells (commas, quotes, newlines, BOM)", () => {
    const csv = buildCsv(["Name", "Notes"], [["Rao, S.", 'He said "hello"\nsecond line'], ["Plain", ""]]);
    const parsed = parseCsv("\uFEFF" + csv);
    expect(parsed).toEqual([["Name", "Notes"], ["Rao, S.", 'He said "hello"\nsecond line'], ["Plain", ""]]);
    expect(csvToObjects(csv)[0]).toEqual({ Name: "Rao, S.", Notes: 'He said "hello"\nsecond line' });
  });

  it("neutralises spreadsheet formula injection but keeps phone numbers intact", () => {
    expect(guardFormula("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(guardFormula("@cmd")).toBe("'@cmd");
    expect(guardFormula("-5+3")).toBe("'-5+3");
    expect(guardFormula("+91 98765 43210", true)).toBe("+91 98765 43210");
    expect(guardFormula("Normal text")).toBe("Normal text");
  });
});

describe("trend bucketing (ported from the web app)", () => {
  const now = new Date(2026, 9, 3, 12, 0, 0); // 3 Oct 2026, local noon
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  it("daily: 14 buckets, today is last, 14+ days old falls off", () => {
    const pts = attendanceTrend([daysAgo(0), daysAgo(0), daysAgo(13), daysAgo(14)], "daily", now);
    expect(pts).toHaveLength(14);
    expect(pts[13].count).toBe(2);
    expect(pts[0].count).toBe(1);
    expect(pts.reduce((s, p) => s + p.count, 0)).toBe(3);
  });

  it("weekly: 8 buckets with this week last", () => {
    const pts = attendanceTrend([daysAgo(0), daysAgo(8)], "weekly", now);
    expect(pts).toHaveLength(8);
    expect(pts[7].count).toBe(1);
    expect(pts.reduce((s, p) => s + p.count, 0)).toBe(2);
  });

  it("monthly revenue: 6 buckets, amounts summed per calendar month", () => {
    const pts = revenueTrend(
      [
        { paid_at: new Date(2026, 9, 1).toISOString(), amount: 1500 },
        { paid_at: new Date(2026, 9, 2).toISOString(), amount: 500 },
        { paid_at: new Date(2026, 4, 20).toISOString(), amount: 999 }, // 5 months back -> first bucket
        { paid_at: new Date(2026, 3, 20).toISOString(), amount: 777 }, // 6 months back -> dropped
      ],
      "monthly",
      now
    );
    expect(pts).toHaveLength(6);
    expect(pts[5].amount).toBe(2000);
    expect(pts[0].amount).toBe(999);
  });
});

describe("IPC contract", () => {
  it("exposes only explicitly listed, uniquely named channels", () => {
    const channels = Object.entries(API_METHODS).flatMap(([ns, methods]) => methods.map((m) => channelFor(ns, m)));
    expect(channels.length).toBeGreaterThan(40);
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels.every((c) => /^gym:[a-z]+:[A-Za-z]+$/.test(c))).toBe(true);
  });
});

describe("logging", () => {
  it("redacts anything that looks like a secret, at any depth", () => {
    const out = redact({
      email: "a@b.com",
      password: "hunter2",
      nested: { serviceKey: "k", privateKey: "-----BEGIN", ok: 1 },
      list: [{ recoveryCode: "AAAA-BBBB" }],
    }) as Record<string, any>;
    expect(out.email).toBe("a@b.com");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.serviceKey).toBe("[REDACTED]");
    expect(out.nested.privateKey).toBe("[REDACTED]");
    expect(out.nested.ok).toBe(1);
    expect(out.list[0].recoveryCode).toBe("[REDACTED]");
  });

  it("writes dated log files and never leaks secrets into them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "btg-log-"));
    const log = createFileLogger(path.join(dir, "logs"));
    log.error("login failed", { email: "a@b.com", password: "hunter2" });
    const file = fs.readdirSync(path.join(dir, "logs"))[0];
    const text = fs.readFileSync(path.join(dir, "logs", file), "utf8");
    expect(file).toMatch(/^app-\d{4}-\d{2}-\d{2}\.log$/);
    expect(text).toContain("login failed");
    expect(text).not.toContain("hunter2");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
