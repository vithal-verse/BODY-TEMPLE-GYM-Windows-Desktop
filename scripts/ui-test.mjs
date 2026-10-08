// End-to-end UI test: launches the real Electron app against a temporary data folder and drives it like a user.
//   npm run build && npm run test:ui          (on Linux CI: xvfb-run -a npm run test:ui)
// Native dialogs (Save as…, confirmations) are answered by patching Electron's `dialog` in the main process.
import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "btg-ui-"));
const shots = path.join(ROOT, "test-results", "ui");
fs.mkdirSync(shots, { recursive: true });
const csvPath = path.join(dataDir, "members-export.csv");
const PASSWORD = "Str0ng-pass!";
const NEW_PASSWORD = "An0ther-Str0ng!";

const launch = () =>
  electron.launch({
    executablePath: require("electron"),
    args: [process.env.BTG_APP_PATH || ROOT, "--disable-gpu", ...(process.getuid?.() === 0 || process.env.CI ? ["--no-sandbox"] : [])],
    env: { ...process.env, BTG_DATA_DIR: dataDir },
    timeout: 90_000,
  });

let app, page, n = 0;
const shot = (name) => page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, "0")}-${name}.png`) });
const visible = (text, opts) => page.getByText(text, opts).first().waitFor({ timeout: 15_000 });
const gone = (text) => page.getByText(text).first().waitFor({ state: "hidden", timeout: 15_000 });
const link = (name) => page.getByRole("link", { name }).first();
const button = (name, opts = {}) => page.getByRole("button", { name, ...opts }).first();
const go = async (name, url) => { await link(name).click(); await page.waitForURL(url, { timeout: 15_000 }); };
const gym = (fn, arg) => page.evaluate(fn, arg);

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}\n    ${String(e.message).split("\n").slice(0, 4).join("\n    ")}`);
    await page.screenshot({ path: path.join(shots, `FAIL-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
    throw e;
  }
}

async function stubDialogs() {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  }, csvPath);
}
async function signIn(password) {
  await page.getByPlaceholder("you@bodytemplegym.com").fill("owner@bodytemplegym.com");
  await page.locator('input[type="password"]').fill(password);
  await button("Log in", { exact: true }).click();
}

try {
  console.log("First launch");
  app = await launch();
  page = await app.firstWindow();
  await stubDialogs();

  await step("a brand-new install goes to the first-run setup screen", async () => {
    await page.waitForURL(/\/setup\/?$/, { timeout: 30_000 });
    await visible("Create the owner account");
    await shot("setup");
  });
  await step("setup rejects a weak password and a mismatch", async () => {
    await page.getByPlaceholder("you@bodytemplegym.com").fill("owner@bodytemplegym.com");
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill("password123"); await pw.nth(1).fill("password123");
    await button("Create account").click();
    await visible("too common");
    await pw.nth(0).fill(PASSWORD); await pw.nth(1).fill("different-Pass1");
    await button("Create account").click();
    await visible("don't match");
  });
  await step("setup creates the owner and shows the one-time recovery code", async () => {
    await page.getByPlaceholder("e.g. Vithal").fill("Vithal");
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill(PASSWORD); await pw.nth(1).fill(PASSWORD);
    await button("Create account").click();
    await visible("Save your recovery code");
    const code = await page.locator("code").first().innerText();
    assert.match(code, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    await shot("recovery-code");
    await page.getByRole("checkbox").check();
    await button("Open the dashboard").click();
    await page.waitForURL(/\/dashboard\/?$/, { timeout: 15_000 });
    await visible("Total members");
    await shot("dashboard-empty");
  });

  console.log("Members");
  await step("add a member with a part-payment (₹500 of ₹1,500)", async () => {
    await go("Add member", /\/members\/new\/?$/);
    await page.getByPlaceholder("Paras Bhonsle").fill("Asha Rao");
    await page.getByPlaceholder("28").fill("28");
    await page.getByPlaceholder("paras@example.com").fill("asha@example.com");
    await page.getByPlaceholder("+91 98765 43210").fill("+91 98765 11111");
    await shot("add-member-form");
    await page.locator('input[placeholder="1500"]').nth(1).fill("500");
    await button("Add member").click();
    await page.waitForURL(/\/dashboard\/members\/?$/, { timeout: 15_000 });
    await visible("Asha Rao");
    await visible("₹1,000 due");
    await shot("members-list");
  });
  await step("an invalid form shows a friendly message and saves nothing", async () => {
    await go("Add member", /\/members\/new\/?$/);
    await page.getByPlaceholder("Paras Bhonsle").fill("   ");
    await button("Add member").click();
    await visible("Name is required");
    const r = await gym(() => window.gym.members.list({}));
    assert.equal(r.data.total, 1);
  });
  await step("bulk-add 11 members, then paginate, search, filter and sort", async () => {
    await gym(async () => {
      for (let i = 1; i <= 11; i++) {
        const r = await window.gym.members.create({ name: `Member ${String(i).padStart(2, "0")}`, start_date: "2026-10-01", plan_id: 1, amount_due: 1500, initial_payment: i * 100 });
        if (!r.ok) throw new Error(r.error.message);
      }
    });
    await go("Members", /\/dashboard\/members\/?$/);
    await visible("12 members on record");
    await visible("Page 1 of 2");
    await button("Next").click();
    await visible("Page 2 of 2");
    await page.getByPlaceholder("Search by name, email, phone…").fill("asha@");
    await visible("Asha Rao");
    await gone("Member 01");
    await page.getByPlaceholder("Search by name, email, phone…").fill("zzzz");
    await visible("No members match");
    await page.getByPlaceholder("Search by name, email, phone…").fill("");
    await button("Expired").click();
    await visible("No members match");
    await button("All", { exact: true }).click();
    await page.getByRole("button", { name: "Fees paid" }).click();
    await page.getByRole("button", { name: "Fees paid" }).click(); // descending
    await visible("Member 11");
  });

  console.log("Member lifecycle");
  const open = async (name) => {
    await go("Members", /\/dashboard\/members\/?$/);
    await page.getByPlaceholder("Search by name, email, phone…").fill(name);
    await page.getByRole("link", { name }).first().click();
    await page.waitForURL(/\/members\/detail\/?\?id=/, { timeout: 15_000 });
    await visible(name);
  };
  await step("member detail shows the term, payment and outstanding balance", async () => {
    await open("Asha Rao");
    await visible("₹1,000");
    await shot("member-detail");
  });
  await step("record the remaining ₹1,000 against the current term", async () => {
    await link(/Record payment/).click();
    await page.waitForURL(/\/members\/pay\/?\?id=/);
    await shot("record-payment");
    await button("Record payment").click();
    await page.waitForURL(/\/members\/detail\/?\?id=/, { timeout: 15_000 });
    const r = await gym(() => window.gym.members.list({ query: "asha" }));
    assert.equal(r.data.rows[0].fees_paid, 1500);
  });
  await step("renew into a new term; history keeps the old one", async () => {
    await link(/Renew/).click();
    await page.waitForURL(/\/members\/renew\/?\?id=/);
    await shot("renew-form");
    await button("Confirm renewal").click();
    await page.waitForURL(/\/members\/detail\/?\?id=/, { timeout: 15_000 });
    const r = await gym(async () => {
      const m = (await window.gym.members.list({ query: "asha" })).data.rows[0];
      return (await window.gym.members.renewals({ memberId: m.id })).data.length;
    });
    assert.equal(r, 2);
  });
  await step("pause (in-app confirmation) then resume", async () => {
    await button("Pause").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Pause" }).click();
    await visible(/paused/i);
    await shot("paused");
    await button("Resume").click();
    await gone("Resume");
  });
  await step("edit changes details but never touches fees paid or history", async () => {
    const before = (await gym(() => window.gym.members.list({ query: "asha" }))).data.rows[0];
    await link(/Edit/).click();
    await page.waitForURL(/\/members\/edit\/?\?id=/);
    await page.locator('input[value="+91 98765 11111"]').fill("+91 98765 22222");
    await button("Save changes").click();
    await page.waitForURL(/\/dashboard\/members\/?$/, { timeout: 15_000 });
    const after = (await gym(() => window.gym.members.list({ query: "asha" }))).data.rows[0];
    assert.equal(after.phone, "+91 98765 22222");
    assert.equal(after.fees_paid, before.fees_paid);
    const terms = (await gym((id) => window.gym.members.renewals({ memberId: id }), after.id)).data;
    assert.equal(terms.length, 2, "editing never creates a term");
  });

  console.log("Attendance");
  await step("check in, see them on the floor, check out", async () => {
    await go("Attendance", /\/check-in\/?$/);
    const box = page.getByPlaceholder("Type a name, email, or phone…");
    await box.fill("asha");
    await visible("Asha Rao");
    await page.locator("li").getByRole("button", { name: "Check in", exact: true }).click();
    await visible("Start typing to find someone."); // the search box clears after a check-in, as in the original
    await shot("checked-in");
    await page.getByRole("button", { name: "Overview" }).click();
    await visible("On the floor now");
    await visible("Asha Rao");
    assert.equal((await gym(() => window.gym.attendance.active())).data.length, 1);
    await shot("attendance-overview");
    await page.getByRole("button", { name: "Check in", exact: true }).first().click(); // back to the first tab
    await box.fill("asha");
    await page.locator("li").getByRole("button", { name: /Check out/ }).click();
    await visible("Start typing to find someone.");
    assert.equal((await gym(() => window.gym.attendance.active())).data.length, 0);
    await page.getByRole("button", { name: "History" }).click();
    await visible("1 visit found");
    await shot("attendance-history");
  });

  console.log("Revenue & export");
  await step("revenue page totals come from real payments", async () => {
    await go("Revenue", /\/revenue\/?$/);
    await visible("Total revenue");
    await visible("Transactions");
    await shot("revenue");
  });
  await step("export writes a CSV through the (stubbed) Save dialog", async () => {
    await go("Export data", /\/export\/?$/);
    await visible("13 members").catch(() => visible("members"));
    await button("Download CSV").click();
    await visible("Saved to");
    const csv = fs.readFileSync(csvPath, "utf8");
    assert.ok(csv.charCodeAt(0) === 0xfeff, "BOM for Excel");
    assert.match(csv, /Name,Age,Email,Phone,Plan,Start date,End date,Amount due,Fees paid,Outstanding,Status/);
    assert.match(csv, /Asha Rao/);
    assert.equal(csv.trim().split("\n").length, 13);
  });

  console.log("Settings, backup & restore");
  await step("plans: add and remove a plan", async () => {
    await go("Settings", /\/settings\/?/);
    await link("Plans").click();
    await button("Add a plan").click();
    await page.getByPlaceholder("e.g. 6 Months").fill("6 Months");
    await page.locator('input[type="number"]').nth(1).fill("5000");
    await button("Save plan").click();
    await visible("6 Months");
    await page.getByRole("button", { name: "Delete 6 Months" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete plan" }).click();
    await gone("6 Months");
  });
  await step("backup now, verify it, then restore it after adding a stray member", async () => {
    await link("Data safety").click();
    await button("Backup Database").click();
    await visible("Backup saved");
    await shot("settings-data");
    await button("Verify").click();
    await visible("Verified");
    await gym(() => window.gym.members.create({ name: "Added After Backup", start_date: "2026-10-01", plan_id: 1 }));
    await button("Restore", { exact: true }).click(); // native confirmation answered by the stub
    await page.waitForURL(/\/login\/?$/, { timeout: 30_000 }); // restore ends the session
    await signIn(PASSWORD);
    await page.waitForURL(/\/dashboard\/?$/, { timeout: 15_000 });
    const r = await gym(() => window.gym.members.search({ query: "Added After Backup" }));
    assert.equal(r.data.length, 0, "member added after the backup is gone");
    const all = await gym(() => window.gym.members.list({ pageSize: 1 }));
    assert.equal(all.data.total, 12);
  });

  console.log("Account & sign-in");
  await step("change password, sign out, wrong password is refused, new password works", async () => {
    await go("Settings", /\/settings\/?/);
    await link("Account").click();
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill(PASSWORD); await pw.nth(1).fill(NEW_PASSWORD); await pw.nth(2).fill(NEW_PASSWORD);
    await button("Change password").click();
    await visible("Password changed");
    await button(/Sign out/i).click();
    await page.waitForURL(/\/login\/?$/, { timeout: 15_000 });
    await shot("login");
    await signIn(PASSWORD);
    await visible("don't match our records");
    await signIn(NEW_PASSWORD);
    await page.waitForURL(/\/dashboard\/?$/, { timeout: 15_000 });
  });
  await step("protected pages bounce to login when signed out", async () => {
    await button(/Sign out/i).click();
    await page.waitForURL(/\/login\/?$/);
    await page.evaluate(() => (window.location.href = "app://local/dashboard/members/"));
    await page.waitForURL(/\/login\/?$/, { timeout: 15_000 });
  });

  console.log("Restart");
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await step("after a restart the data is still there and setup does not reappear", async () => {
    await page.waitForURL(/\/login\/?$/, { timeout: 30_000 });
    await signIn(NEW_PASSWORD);
    await page.waitForURL(/\/dashboard\/?$/, { timeout: 15_000 });
    await visible("Total members");
    await shot("dashboard-after-restart");
    const r = await gym(() => window.gym.members.list({ pageSize: 1 }));
    assert.equal(r.data.total, 12);
  });
  await app.close();
  console.log("\nAll UI checks passed. Screenshots: test-results/ui/");
} catch (e) {
  console.error("\nUI TEST FAILED:", e.message.split("\n")[0]);
  try { await app?.close(); } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
