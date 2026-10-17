/** Five-field cron in UTC, including lists, ranges and steps. Sunday = 0 or 7. */
export function parseCron(expression: string): (date: Date) => boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Use five cron fields: minute hour day month weekday (UTC).");
  const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const sets = fields.map((field, i) => {
    const [min, max] = limits[i];
    const values = new Set<number>();
    for (const part of field.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) throw new Error("Invalid cron field.");
      const step = match[2] ? Number(match[2]) : 1;
      if (step < 1 || step > max + 1) throw new Error("Invalid cron step.");
      const range = match[1] === "*" ? [min, max] : match[1].split("-").map(Number);
      const start = range[0];
      const end = range[1] ?? (match[2] ? max : start);
      if (start < min || end > max || end < start) throw new Error("Cron value out of range.");
      for (let value = start; value <= end; value += step) values.add(i === 4 && value === 7 ? 0 : value);
    }
    return values;
  });
  // Vixie cron: when both day fields are restricted, either may match.
  const domAny = fields[2].startsWith("*");
  const dowAny = fields[4].startsWith("*");
  return (date) => {
    const day = sets[2].has(date.getUTCDate());
    const weekday = sets[4].has(date.getUTCDay());
    return sets[0].has(date.getUTCMinutes()) && sets[1].has(date.getUTCHours()) && sets[3].has(date.getUTCMonth() + 1) && (domAny || dowAny ? day && weekday : day || weekday);
  };
}
