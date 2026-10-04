/** Rupees <-> integer paise. All persisted money is integer paise. */
export function toPaise(rupees: number | null | undefined): number {
  if (rupees === null || rupees === undefined || Number.isNaN(rupees)) return 0;
  return Math.round(rupees * 100);
}

export function fromPaise(paise: number | null | undefined): number {
  if (paise === null || paise === undefined) return 0;
  return paise / 100;
}

/** Parse a Postgres numeric string ("1500.00", "1,500") into paise without float drift. */
export function parseMoneyToPaise(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return toPaise(value);
  const cleaned = value.trim().replace(/,/g, "");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? toPaise(n) : 0;
  }
  const [, sign, whole, frac = ""] = match;
  const cents = Number((frac + "00").slice(0, 2));
  const paise = Number(whole) * 100 + cents;
  return sign === "-" ? -paise : paise;
}
