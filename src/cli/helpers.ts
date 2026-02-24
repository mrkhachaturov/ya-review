export function isJsonMode(opts: { json?: boolean }): boolean {
  return opts.json === true || !process.stdout.isTTY;
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );
  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');

  const fmtRow = (cells: string[]) =>
    cells.map((c, i) => ` ${(c ?? '').padEnd(widths[i])} `).join('│');

  console.log(fmtRow(headers));
  console.log(sep);
  for (const row of rows) {
    console.log(fmtRow(row));
  }
}

export function truncate(s: string | null, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
