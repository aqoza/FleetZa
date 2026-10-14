/** Quote delimiters and keep user-entered text from becoming spreadsheet formulas. */
export function csvEscape(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^(?:\s*[=+\-@]|[\t\r\n])/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  // Excel needs the UTF-8 BOM to recognize Arabic names and headers reliably.
  return "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, rows: ReadonlyArray<ReadonlyArray<string | number>>): void {
  const url = URL.createObjectURL(new Blob([serializeCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
