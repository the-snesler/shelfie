import { localIsoDate } from "../media/libraryActions";

/** Local-time day arithmetic over ISO "YYYY-MM-DD" strings — constructing
 *  via `new Date(y, m, d)` keeps DST shifts from skipping or doubling a day. */
function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m - 1, d];
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return localIsoDate(new Date(y, m, d + days));
}

/** "YYYY-MM" from a `?month=` param, or null when absent/malformed. */
export function parseMonth(raw: string | null): string | null {
  return raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = parts(`${month}-01`);
  return localIsoDate(new Date(y, m + delta, 1)).slice(0, 7);
}

/** Every day of the Sunday-first weeks covering `month` ("YYYY-MM"),
 *  leading/trailing days of the neighbouring months included. */
export function monthGrid(month: string): string[] {
  const [y, m] = parts(`${month}-01`);
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const start = new Date(y, m, 1 - first.getDay());
  const count = first.getDay() + last.getDate() + (6 - last.getDay());
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    days.push(
      localIsoDate(
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
      ),
    );
  }
  return days;
}

export function monthTitle(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** "Today" / "Tomorrow" / "Fri, Oct 10" (year appended when not `today`'s). */
export function relativeDayLabel(iso: string, today: string): string {
  if (iso === today) return "Today";
  if (iso === addDays(today, 1)) return "Tomorrow";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: iso.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  });
}
