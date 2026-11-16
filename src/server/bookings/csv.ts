import "server-only";

export type CsvValue = string | number | boolean | Date | null | undefined;

// A spreadsheet treats a cell starting with one of these as a formula (OWASP
// "CSV Injection"): = + - @, tab, carriage return, line feed, and the
// full-width forms of the first four.
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;

/**
 * One CSV field. Text that could be read as a formula gets a leading single
 * quote so it stays text; quotes are doubled and the field is wrapped when it
 * contains a delimiter. Numbers are written by this code, never by a
 * customer, so they are passed through unchanged.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value instanceof Date) return value.toISOString();
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180 document: CRLF line ends, header row first. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Minor units as a plain decimal for spreadsheets, e.g. `69000` USD → `690.00`. */
export function minorToDecimal(minorUnits: number, currency: string): string {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown currency code: keep two decimals rather than fail an export.
  }
  return (minorUnits / 10 ** digits).toFixed(digits);
}
