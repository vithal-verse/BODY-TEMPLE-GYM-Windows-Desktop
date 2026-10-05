import crypto from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "@shared/errors";
import { EMAIL_RE, passwordProblem } from "@shared/validation";
import type { AdminProfile, AdminRole, AuthStatus, SessionInfo } from "@shared/types";
import type { DatabaseManager } from "../database/manager";
import type { Logger } from "./logger";
import { newId, type Clock, systemClock } from "./util";

const scrypt = promisify(crypto.scrypt) as (
  pw: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, opts: crypto.ScryptOptions
) => Promise<Buffer>;

export type ScryptCost = { N: number; r: number; p: number };
/** ~100 ms on a desktop CPU, 32 MiB of memory: comfortable for an interactive login. */
export const DEFAULT_SCRYPT: ScryptCost = { N: 32768, r: 8, p: 1 };

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const MAX_FREE_ATTEMPTS = 5;
const BAD_LOGIN = "That email and password don't match our records.";

type AdminRow = { id: string; email: string; full_name: string | null; role: AdminRole; created_at: string };
type CredRow = {
  admin_id: string; password_hash: string; recovery_hash: string | null; failed_attempts: number;
  locked_until: string | null; last_login_at: string | null;
};

export function displayNameFor(email: string, fullName: string | null): string {
  return fullName?.trim() || email.split("@")[0] || "Admin";
}
const normEmail = (e: string) => e.trim().toLowerCase();
const normRecovery = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export class AuthService {
  private session: SessionInfo | null = null;
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly mgr: DatabaseManager,
    private readonly log: Logger,
    private readonly clock: Clock = systemClock,
    private readonly cost: ScryptCost = DEFAULT_SCRYPT
  ) {}

  private get db() {
    return this.mgr.db;
  }

  // ---- hashing -----------------------------------------------------------
  async hash(secret: string): Promise<string> {
    const { N, r, p } = this.cost;
    const salt = crypto.randomBytes(16);
    const key = await scrypt(secret.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * N * r });
    return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(stored: string, secret: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    if (!(N >= 2 && N <= 1 << 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) return false;
    const expected = Buffer.from(parts[5], "base64");
    const key = await scrypt(secret.normalize("NFKC"), Buffer.from(parts[4], "base64"), expected.length, { N, r, p, maxmem: 256 * N * r });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  }

  private newRecoveryCode(): string {
    let raw = "";
    for (let i = 0; i < 20; i++) raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    return raw.match(/.{4}/g)!.join("-");
  }

  // ---- status / session --------------------------------------------------
  status(): AuthStatus {
    const n = (this.db.prepare("SELECT COUNT(*) c FROM admin_profiles").get() as { c: number }).c;
    return { hasAdmin: n > 0, session: this.current() };
  }

  /** Current session, re-validated against the database on every call. */
  current(): SessionInfo | null {
    if (!this.session) return null;
    const row = this.db.prepare("SELECT id, email, full_name, role FROM admin_profiles WHERE id = ?").get(this.session.adminId) as
      | Pick<AdminRow, "id" | "email" | "full_name" | "role"> | undefined;
    if (!row) {
      this.session = null;
      return null;
    }
    this.session = this.toSession(row);
    return this.session;
  }

  requireSession(): SessionInfo {
    const s = this.current();
    if (!s) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
    return s;
  }

  requireOwner(): SessionInfo {
    const s = this.requireSession();
    if (s.role !== "owner") throw new AppError("FORBIDDEN", "Only the owner account can do that.");
    return s;
  }

  /** Called after a restore/import replaces the database underneath a live session. */
  invalidate(): void {
    this.session = null;
  }

  logout(): void {
    this.session = null;
  }

  private toSession(row: Pick<AdminRow, "id" | "email" | "full_name" | "role">): SessionInfo {
    return {
      adminId: row.id, email: row.email, fullName: row.full_name,
      displayName: displayNameFor(row.email, row.full_name), role: row.role,
    };
  }

  // ---- setup / login -----------------------------------------------------
  async setup(input: { full_name: string; email: string; password: string }) {
    if (this.status().hasAdmin) throw new AppError("CONFLICT", "An administrator already exists. Please sign in.");
    const { admin, recoveryCode } = await this.insertAdmin({ ...input, role: "owner" });
    this.session = this.toSession(admin);
    this.log.info("First-run setup completed; owner account created");
    return { session: this.session, recoveryCode };
  }

  private async insertAdmin(input: { full_name: string; email: string; password: string; role: AdminRole }) {
    const email = normEmail(input.email);
    if (!EMAIL_RE.test(email)) throw new AppError("VALIDATION", "Enter a valid email address.");
    const problem = passwordProblem(input.password, email);
    if (problem) throw new AppError("VALIDATION", problem);
    const exists = this.db.prepare("SELECT 1 FROM admin_profiles WHERE email = ?").get(email);
    if (exists) throw new AppError("CONFLICT", "An administrator with that email already exists.");

    const id = newId();
    const recoveryCode = this.newRecoveryCode();
    const [passwordHash, recoveryHash] = await Promise.all([this.hash(input.password), this.hash(normRecovery(recoveryCode))]);
    const fullName = input.full_name.trim() || null;
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO admin_profiles (id, email, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, email, fullName, input.role, this.clock().toISOString());
      this.db.prepare("INSERT INTO admin_credentials (admin_id, password_hash, recovery_hash, password_changed_at) VALUES (?, ?, ?, ?)")
        .run(id, passwordHash, recoveryHash, this.clock().toISOString());
    }).immediate();
    const admin = { id, email, full_name: fullName, role: input.role, created_at: this.clock().toISOString() } as AdminRow;
    return { admin, recoveryCode };
  }

  private lockMessage(until: string): string | null {
    const ms = Date.parse(until) - this.clock().getTime();
    if (ms <= 0) return null;
    const s = Math.ceil(ms / 1000);
    return `Too many attempts. Try again in ${s >= 90 ? Math.ceil(s / 60) + " minutes" : s + " seconds"}.`;
  }

  private async recordFailure(cred: CredRow) {
    const attempts = cred.failed_attempts + 1;
    let lockedUntil: string | null = null;
    if (attempts >= MAX_FREE_ATTEMPTS) {
      const seconds = Math.min(15 * 60, 30 * 2 ** (attempts - MAX_FREE_ATTEMPTS));
      lockedUntil = new Date(this.clock().getTime() + seconds * 1000).toISOString();
    }
    this.db.prepare("UPDATE admin_credentials SET failed_attempts = ?, locked_until = ? WHERE admin_id = ?").run(attempts, lockedUntil, cred.admin_id);
  }

  async login(input: { email: string; password: string }): Promise<SessionInfo> {
    const email = normEmail(input.email);
    const admin = this.db.prepare("SELECT id, email, full_name, role, created_at FROM admin_profiles WHERE email = ?").get(email) as AdminRow | undefined;
    const cred = admin
      ? (this.db.prepare("SELECT * FROM admin_credentials WHERE admin_id = ?").get(admin.id) as CredRow | undefined)
      : undefined;

    if (!admin || !cred) {
      // Burn the same CPU time as a real check so response timing doesn't reveal which emails exist.
      this.dummyHash ??= this.hash("dummy-password-for-timing");
      await this.verify(await this.dummyHash, input.password);
      this.log.warn("Failed login (unknown account)");
      throw new AppError("UNAUTHENTICATED", BAD_LOGIN);
    }

    if (cred.locked_until) {
      const msg = this.lockMessage(cred.locked_until);
      if (msg) throw new AppError("RATE_LIMITED", msg);
    }

    if (!(await this.verify(cred.password_hash, input.password))) {
      await this.recordFailure(cred);
      this.log.warn("Failed login", { adminId: admin.id, attempts: cred.failed_attempts + 1 });
      const fresh = this.db.prepare("SELECT locked_until FROM admin_credentials WHERE admin_id = ?").get(admin.id) as { locked_until: string | null };
      const msg = fresh.locked_until ? this.lockMessage(fresh.locked_until) : null;
      throw new AppError(msg ? "RATE_LIMITED" : "UNAUTHENTICATED", msg ?? BAD_LOGIN);
    }

    this.db.prepare("UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE admin_id = ?")
      .run(this.clock().toISOString(), admin.id);
    this.session = this.toSession(admin);
    return this.session;
  }

  // ---- password management ----------------------------------------------
  async changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
    const s = this.requireSession();
    const cred = this.db.prepare("SELECT * FROM admin_credentials WHERE admin_id = ?").get(s.adminId) as CredRow;
    if (!(await this.verify(cred.password_hash, input.currentPassword))) {
      throw new AppError("UNAUTHENTICATED", "Your current password is incorrect.");
    }
    const problem = passwordProblem(input.newPassword, s.email);
    if (problem) throw new AppError("VALIDATION", problem);
    const hash = await this.hash(input.newPassword);
    this.db.prepare("UPDATE admin_credentials SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE admin_id = ?")
      .run(hash, this.clock().toISOString(), s.adminId);
    this.log.info("Password changed", { adminId: s.adminId });
  }

  async resetPassword(input: { email: string; recoveryCode: string; newPassword: string }): Promise<{ recoveryCode: string }> {
    const email = normEmail(input.email);
    const admin = this.db.prepare("SELECT id, email FROM admin_profiles WHERE email = ?").get(email) as { id: string; email: string } | undefined;
    const cred = admin ? (this.db.prepare("SELECT * FROM admin_credentials WHERE admin_id = ?").get(admin.id) as CredRow | undefined) : undefined;
    const bad = new AppError("UNAUTHENTICATED", "That email and recovery code don't match our records.");
    if (!admin || !cred?.recovery_hash) {
      this.dummyHash ??= this.hash("dummy-password-for-timing");
      await this.verify(await this.dummyHash, input.recoveryCode);
      throw bad;
    }
    if (cred.locked_until) {
      const msg = this.lockMessage(cred.locked_until);
      if (msg) throw new AppError("RATE_LIMITED", msg);
    }
    if (!(await this.verify(cred.recovery_hash, normRecovery(input.recoveryCode)))) {
      await this.recordFailure(cred);
      this.log.warn("Failed recovery attempt", { adminId: admin.id });
      throw bad;
    }
    const problem = passwordProblem(input.newPassword, email);
    if (problem) throw new AppError("VALIDATION", problem);

    const recoveryCode = this.newRecoveryCode();
    const [passwordHash, recoveryHash] = await Promise.all([this.hash(input.newPassword), this.hash(normRecovery(recoveryCode))]);
    this.db.prepare(
      "UPDATE admin_credentials SET password_hash = ?, recovery_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE admin_id = ?"
    ).run(passwordHash, recoveryHash, this.clock().toISOString(), admin.id);
    this.log.info("Password reset with recovery code", { adminId: admin.id });
    return { recoveryCode };
  }

  // ---- admin accounts ----------------------------------------------------
  listAdmins(): AdminProfile[] {
    this.requireSession();
    return this.db.prepare(
      `SELECT p.id, p.email, p.full_name, p.role, p.created_at, c.last_login_at
       FROM admin_profiles p LEFT JOIN admin_credentials c ON c.admin_id = p.id
       ORDER BY p.created_at ASC, p.rowid ASC`
    ).all() as AdminProfile[];
  }

  async createAdmin(input: { full_name: string; email: string; password: string; role: AdminRole }) {
    this.requireOwner();
    const { admin, recoveryCode } = await this.insertAdmin(input);
    return {
      admin: { id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role, created_at: admin.created_at, last_login_at: null },
      recoveryCode,
    };
  }

  removeAdmin(input: { id: string }): void {
    const me = this.requireOwner();
    if (input.id === me.adminId) throw new AppError("VALIDATION", "You can't remove the account you're signed in with.");
    const target = this.db.prepare("SELECT role FROM admin_profiles WHERE id = ?").get(input.id) as { role: AdminRole } | undefined;
    if (!target) throw new AppError("NOT_FOUND", "That administrator no longer exists.");
    this.db.prepare("DELETE FROM admin_profiles WHERE id = ?").run(input.id);
  }
}
