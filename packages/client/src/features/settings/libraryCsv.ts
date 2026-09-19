import { libraryItemDocSchema, type LibraryItem } from "@shelfie/shared";

const HEADERS = [
  "id",
  "mediaType",
  "sourceId",
  "status",
  "progressFormat",
  "progressValue",
  "platforms",
  "rating",
  "completedDates",
  "notes",
  "watchedEpisodes",
  "addedAt",
] as const;

export interface PreparedImport {
  documents: LibraryItem[];
  added: number;
  updated: number;
}

export function exportLibraryCsv(items: readonly LibraryItem[]): string {
  const rows = [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => [
      item.id,
      item.mediaType,
      item.sourceId,
      item.status,
      item.progressFormat,
      item.progressValue == null ? "" : String(item.progressValue),
      JSON.stringify(item.platforms),
      item.rating == null ? "" : String(item.rating),
      JSON.stringify(item.completedDates),
      item.notes,
      JSON.stringify(item.watchedEpisodes),
      String(item.addedAt),
    ]);
  return [HEADERS, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
}

export function importLibraryCsv(csv: string): LibraryItem[] {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (rows.length === 0) throw new Error("The CSV file is empty.");
  if (
    rows[0]?.length !== HEADERS.length ||
    rows[0].some((cell, index) => cell !== HEADERS[index])
  ) {
    throw new Error(`Expected header: ${HEADERS.join(",")}`);
  }
  if (rows.length === 1) throw new Error("The CSV file has no library items.");

  const seen = new Set<string>();
  return rows.slice(1).map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== HEADERS.length) {
      throw new Error(`Row ${rowNumber}: expected ${HEADERS.length} columns.`);
    }
    const [
      id,
      mediaType,
      sourceId,
      status,
      progressFormat,
      progressValue,
      platforms,
      rating,
      completedDates,
      notes,
      watchedEpisodes,
      addedAt,
    ] = row as [string, ...string[]];
    if (seen.has(id)) throw new Error(`Row ${rowNumber}: duplicate id ${id}.`);
    seen.add(id);
    if (id !== `${mediaType}:${sourceId}`) {
      throw new Error(
        `Row ${rowNumber}: id does not match mediaType/sourceId.`,
      );
    }

    try {
      const parsed = libraryItemDocSchema.parse({
        id,
        mediaType,
        sourceId,
        status,
        progressFormat,
        progressValue: nullableNumber(progressValue),
        platforms: JSON.parse(platforms),
        rating: nullableNumber(rating),
        completedDates: JSON.parse(completedDates),
        notes,
        watchedEpisodes: JSON.parse(watchedEpisodes),
        addedAt: requiredNumber(addedAt),
        updatedAt: 1,
        _deleted: false,
      });
      const { _deleted: _, ...item } = parsed;
      return item;
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid data";
      throw new Error(`Row ${rowNumber}: ${message}`);
    }
  });
}

export function prepareLibraryImport(
  imported: readonly LibraryItem[],
  existing: ReadonlyMap<string, LibraryItem>,
  now = Date.now(),
): PreparedImport {
  let added = 0;
  let updated = 0;
  const documents = imported.map((item) => {
    const current = existing.get(item.id);
    if (current) updated += 1;
    else added += 1;
    return {
      ...item,
      addedAt: current ? Math.min(current.addedAt, item.addedAt) : item.addedAt,
      updatedAt: now,
    };
  });
  return { documents, added, updated };
}

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function nullableNumber(value: string): number | null {
  return value === "" ? null : requiredNumber(value);
}

function requiredNumber(value: string): number {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    throw new Error(`invalid number ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseCsv(csv: string): string[][] {
  if (csv === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (afterQuote && char !== "," && char !== "\r" && char !== "\n") {
      throw new Error("Invalid character after a closing quote.");
    }
    if (char === '"') {
      if (cell !== "") throw new Error("Unexpected quote in an unquoted cell.");
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
      afterQuote = false;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      afterQuote = false;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("Unclosed quoted cell.");
  if (row.length > 0 || cell !== "" || !/[\r\n]$/.test(csv)) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
