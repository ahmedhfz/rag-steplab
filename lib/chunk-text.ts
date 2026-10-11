/**
 * Splits chunk text into plain-text and Markdown-table blocks so pipe tables
 * can render as a real <table>. Cells stay plain strings: the caller renders
 * them as text nodes, never as HTML, because retrieved text is untrusted.
 */
export type ChunkTextBlock =
  | { type: "text"; text: string }
  | { type: "table"; header: string[]; rows: string[][] };

const SEPARATOR_CELL = /^:?-{2,}:?$/;

function isPipeRow(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.length > 1;
}

/** Splits on unescaped pipes; `\|` stays a literal pipe inside a cell. */
function splitCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(line: string) {
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

export function splitChunkText(text: string): ChunkTextBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ChunkTextBlock[] = [];
  let buffer: string[] = [];
  const flushText = () => {
    const value = buffer.join("\n").replace(/^\n+|\n+$/g, "");
    if (value.trim()) blocks.push({ type: "text", text: value });
    buffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (isPipeRow(lines[index]) && index + 1 < lines.length && isPipeRow(lines[index + 1]) && isSeparatorRow(lines[index + 1])) {
      const header = splitCells(lines[index]);
      const rows: string[][] = [];
      let next = index + 2;
      while (next < lines.length && isPipeRow(lines[next])) {
        const cells = splitCells(lines[next]);
        rows.push(Array.from({ length: header.length }, (_, cellIndex) => cells[cellIndex] ?? ""));
        next += 1;
      }
      flushText();
      blocks.push({ type: "table", header, rows });
      index = next - 1;
      continue;
    }
    buffer.push(lines[index]);
  }
  flushText();
  return blocks;
}
