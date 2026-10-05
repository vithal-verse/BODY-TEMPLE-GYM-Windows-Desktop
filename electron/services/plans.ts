import { AppError } from "@shared/errors";
import { toPaise } from "@shared/money";
import type { MembershipPlan, PlanInput } from "@shared/types";
import type { DatabaseManager } from "../database/manager";
import { type PlanRow, toPlan } from "./mappers";

export class PlansService {
  constructor(private readonly mgr: DatabaseManager) {}
  private get db() {
    return this.mgr.db;
  }

  list(): MembershipPlan[] {
    const rows = this.db.prepare("SELECT * FROM membership_plans ORDER BY fee_paise ASC, id ASC").all() as PlanRow[];
    return rows.map(toPlan);
  }

  private clean(input: PlanInput) {
    const name = input.name.trim();
    if (!name) throw new AppError("VALIDATION", "Plan name is required.");
    if (!Number.isInteger(input.duration_months) || input.duration_months < 1 || input.duration_months > 60) {
      throw new AppError("VALIDATION", "Duration must be a whole number of months between 1 and 60.");
    }
    if (!(input.fee_amount >= 0) || !Number.isFinite(input.fee_amount)) throw new AppError("VALIDATION", "Enter a valid fee.");
    return { name, months: input.duration_months, fee: toPaise(input.fee_amount) };
  }

  private assertUnique(name: string, exceptId?: number) {
    const dup = this.db.prepare("SELECT id FROM membership_plans WHERE name = ? COLLATE NOCASE AND id IS NOT ?").get(name, exceptId ?? null);
    if (dup) throw new AppError("CONFLICT", "A plan with that name already exists.");
  }

  create(input: PlanInput): MembershipPlan {
    const c = this.clean(input);
    this.assertUnique(c.name);
    const info = this.db.prepare("INSERT INTO membership_plans (name, duration_months, fee_paise) VALUES (?, ?, ?)").run(c.name, c.months, c.fee);
    return toPlan(this.db.prepare("SELECT * FROM membership_plans WHERE id = ?").get(info.lastInsertRowid) as PlanRow);
  }

  update(input: { id: number; patch: PlanInput }): MembershipPlan {
    const c = this.clean(input.patch);
    this.assertUnique(c.name, input.id);
    const info = this.db.prepare("UPDATE membership_plans SET name = ?, duration_months = ?, fee_paise = ? WHERE id = ?").run(c.name, c.months, c.fee, input.id);
    if (info.changes === 0) throw new AppError("NOT_FOUND", "That plan no longer exists.");
    return toPlan(this.db.prepare("SELECT * FROM membership_plans WHERE id = ?").get(input.id) as PlanRow);
  }

  /** Members keep their plan_name snapshot; only the link is cleared (ON DELETE SET NULL). */
  remove(input: { id: number }): void {
    const info = this.db.prepare("DELETE FROM membership_plans WHERE id = ?").run(input.id);
    if (info.changes === 0) throw new AppError("NOT_FOUND", "That plan no longer exists.");
  }
}
