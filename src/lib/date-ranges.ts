export type DateRangePreset = "today" | "this-week" | "this-month" | "last-3-months" | "custom";

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  "this-week": "This Week",
  "this-month": "This Month",
  "last-3-months": "Last 3 Months",
  custom: "Custom Range",
};

/**
 * Resolves a preset (or explicit custom bounds) to a concrete [start, end)
 * window. `end` is always exclusive-of-tomorrow so "Today" correctly
 * includes anything logged in the last few minutes.
 */
export function resolveDateRange(
  preset: DateRangePreset,
  custom?: { start: string; end: string }
): { start: Date; end: Date } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  switch (preset) {
    case "today":
      return { start: startOfToday, end: startOfTomorrow };
    case "this-week": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - start.getDay()); // back to Sunday
      return { start, end: startOfTomorrow };
    }
    case "this-month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: startOfTomorrow };
    }
    case "last-3-months": {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      start.setHours(0, 0, 0, 0);
      return { start, end: startOfTomorrow };
    }
    case "custom": {
      if (!custom?.start || !custom?.end) {
        return { start: startOfToday, end: startOfTomorrow };
      }
      const start = new Date(`${custom.start}T00:00:00`);
      const end = new Date(`${custom.end}T23:59:59.999`);
      return { start, end };
    }
  }
}
