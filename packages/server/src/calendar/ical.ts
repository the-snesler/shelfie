import { createHash } from "node:crypto";
import { shiftDay, type CalendarEntry } from "./events.js";

/** RFC 5545 TEXT escaping, before folding into 75-octet physical lines. */
export function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function foldCalendarLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const length = Buffer.byteLength(char, "utf8");
    if (bytes + length > 75) {
      parts.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += length;
  }
  parts.push(current);
  return parts.join("\r\n");
}

function timestamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function renderCalendar(entries: readonly CalendarEntry[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Shelfie//Library Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Shelfie",
  ];
  for (const entry of entries) {
    // Opaque stable identities survive title and release-date changes.
    const uid = createHash("sha256").update(entry.key).digest("hex");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@shelfie`,
      `DTSTAMP:${timestamp(entry.updatedAt)}`,
      `LAST-MODIFIED:${timestamp(entry.updatedAt)}`,
      `DTSTART;VALUE=DATE:${entry.date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${shiftDay(entry.date, 1).replace(/-/g, "")}`,
      `SUMMARY:${escapeCalendarText(entry.title)}`,
      `DESCRIPTION:${escapeCalendarText(entry.description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}
