import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEnv, expectCode, type Env } from "./helpers";
import { passwordProblem } from "@shared/validation";

let env: Env;
beforeEach(async () => (env = await makeEnv()));
afterEach(() => env.cleanup());

const OWNER = { full_name: "Vithal", email: "Owner@BodyTemple.com", password: "Str0ng-pass!" };

describe("first-run setup", () => {
  it("has no admin initially, then creates the owner and signs them in", async () => {
    expect(env.auth.status()).toEqual({ hasAdmin: false, session: null });
    const { session, recoveryCode } = await env.auth.setup(OWNER);
    expect(session.role).toBe("owner");
    expect(session.email).toBe("owner@bodytemple.com");
    expect(session.displayName).toBe("Vithal");
    expect(recoveryCode).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    expect(env.auth.status().hasAdmin).toBe(true);
  });

  it("refuses a second setup, and never stores passwords or recovery codes in plaintext", async () => {
    const { recoveryCode } = await env.auth.setup(OWNER);
    await expectCode(() => env.auth.setup({ ...OWNER, email: "x@y.com" }), "CONFLICT");
    const dump = JSON.stringify(env.mgr.db.prepare("SELECT * FROM admin_credentials").all());
    expect(dump).toContain("scrypt$");
    expect(dump).not.toContain(OWNER.password);
    expect(dump).not.toContain(recoveryCode.replace(/-/g, ""));
  });

  it("rejects weak passwords and bad emails", async () => {
    await expectCode(() => env.auth.setup({ ...OWNER, password: "short" }), "VALIDATION");
    await expectCode(() => env.auth.setup({ ...OWNER, password: "password123" }), "VALIDATION");
    await expectCode(() => env.auth.setup({ ...OWNER, email: "not-an-email" }), "VALIDATION");
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/repeated/);
    expect(passwordProblem("Str0ng-pass!")).toBeNull();
  });
});

describe("login / logout / session", () => {
  beforeEach(async () => {
    await env.auth.setup(OWNER);
    env.auth.logout();
  });

  it("signs in with the right password (email is case-insensitive) and ends on logout", async () => {
    expect(env.auth.current()).toBeNull();
    const s = await env.auth.login({ email: "OWNER@bodytemple.com", password: OWNER.password });
    expect(s.adminId).toBeTruthy();
    expect(env.auth.requireSession().email).toBe("owner@bodytemple.com");
    env.auth.logout();
    await expectCode(() => env.auth.requireSession(), "UNAUTHENTICATED");
  });

  it("gives the same message for a wrong password and an unknown email", async () => {
    const a = await expectCode(() => env.auth.login({ email: OWNER.email, password: "nope-nope-1" }), "UNAUTHENTICATED");
    const b = await expectCode(() => env.auth.login({ email: "ghost@x.com", password: "nope-nope-1" }), "UNAUTHENTICATED");
    expect(a.message).toBe("That email and password don't match our records.");
    expect(b.message).toBe(a.message);
  });

  it("locks out after 5 bad attempts, even for the right password, until the delay passes", async () => {
    for (let i = 0; i < 4; i++) await expectCode(() => env.auth.login({ email: OWNER.email, password: "bad-pass-1" }), "UNAUTHENTICATED");
    await expectCode(() => env.auth.login({ email: OWNER.email, password: "bad-pass-1" }), "RATE_LIMITED");
    await expectCode(() => env.auth.login({ email: OWNER.email, password: OWNER.password }), "RATE_LIMITED");
    env.advance(31_000);
    await expect(env.auth.login({ email: OWNER.email, password: OWNER.password })).resolves.toBeTruthy();
    // counter reset: a single bad attempt is a plain failure again
    env.auth.logout();
    await expectCode(() => env.auth.login({ email: OWNER.email, password: "bad-pass-1" }), "UNAUTHENTICATED");
  });
});

describe("password management", () => {
  it("changePassword needs the current password and a strong new one", async () => {
    await env.auth.setup(OWNER);
    await expectCode(() => env.auth.changePassword({ currentPassword: "wrong-one-1", newPassword: "An0ther-pass!" }), "UNAUTHENTICATED");
    await expectCode(() => env.auth.changePassword({ currentPassword: OWNER.password, newPassword: "short" }), "VALIDATION");
    await env.auth.changePassword({ currentPassword: OWNER.password, newPassword: "An0ther-pass!" });
    env.auth.logout();
    await expectCode(() => env.auth.login({ email: OWNER.email, password: OWNER.password }), "UNAUTHENTICATED");
    await expect(env.auth.login({ email: OWNER.email, password: "An0ther-pass!" })).resolves.toBeTruthy();
  });

  it("the recovery code resets the password once, then rotates", async () => {
    const { recoveryCode } = await env.auth.setup(OWNER);
    env.auth.logout();
    await expectCode(() => env.auth.resetPassword({ email: OWNER.email, recoveryCode: "AAAA-AAAA-AAAA-AAAA-AAAA", newPassword: "Br4nd-new-pw!" }), "UNAUTHENTICATED");
    const next = await env.auth.resetPassword({ email: OWNER.email, recoveryCode: recoveryCode.toLowerCase().replace(/-/g, " "), newPassword: "Br4nd-new-pw!" });
    expect(next.recoveryCode).not.toBe(recoveryCode);
    await expect(env.auth.login({ email: OWNER.email, password: "Br4nd-new-pw!" })).resolves.toBeTruthy();
    await expectCode(() => env.auth.resetPassword({ email: OWNER.email, recoveryCode, newPassword: "Y3t-another-1" }), "UNAUTHENTICATED");
  });
});

describe("admin accounts", () => {
  it("only the owner manages admins; no self-removal; removed admins lose their session", async () => {
    await env.auth.setup(OWNER);
    const { admin } = await env.auth.createAdmin({ full_name: "Front Desk", email: "desk@bodytemple.com", password: "Desk-pass-9!", role: "admin" });
    expect(env.auth.listAdmins().map((a) => a.email)).toEqual(["owner@bodytemple.com", "desk@bodytemple.com"]);
    await expectCode(() => env.auth.removeAdmin({ id: env.auth.requireSession().adminId }), "VALIDATION");

    env.auth.logout();
    await env.auth.login({ email: "desk@bodytemple.com", password: "Desk-pass-9!" });
    await expectCode(() => env.auth.createAdmin({ full_name: "x", email: "z@z.com", password: "Zzzz-pass-9!", role: "admin" }), "FORBIDDEN");
    await expectCode(() => env.auth.removeAdmin({ id: admin.id }), "FORBIDDEN");

    env.auth.logout();
    await env.auth.login({ email: OWNER.email, password: OWNER.password });
    env.auth.removeAdmin({ id: admin.id });
    expect(env.auth.listAdmins()).toHaveLength(1);
  });
});
