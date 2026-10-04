import type { MemberStatus } from "./types";

/**
 * Port of the Postgres `set_member_status` trigger.
 *
 * - `paused` is always an explicit state and is never inferred or overridden.
 * - An end date in the past forces `expired`.
 * - An `expired` row whose end date is today/in the future (or null) flips
 *   back to `active`.
 *
 * `today` is a local yyyy-MM-dd string.
 */
export function computeStatus(
  status: MemberStatus,
  endDate: string | null,
  today: string
): MemberStatus {
  if (status === "paused") return "paused";
  if (endDate && endDate < today) return "expired";
  if (status === "expired") return "active";
  return status;
}
