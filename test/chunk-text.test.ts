import { describe, expect, it } from "vitest";

import { splitChunkText } from "@/lib/chunk-text";

describe("chunk text blocks", () => {
  it("splits a Markdown pipe table out of surrounding prose", () => {
    const blocks = splitChunkText([
      "Purpose of the document.",
      "",
      "| Field | Value |",
      "|---|:---:|",
      "| Document ID | DL-RAG-2026-09 |",
      "| Version | 2.4 |",
      "",
      "Note: synthetic data.",
    ].join("\n"));

    expect(blocks).toEqual([
      { type: "text", text: "Purpose of the document." },
      { type: "table", header: ["Field", "Value"], rows: [["Document ID", "DL-RAG-2026-09"], ["Version", "2.4"]] },
      { type: "text", text: "Note: synthetic data." },
    ]);
  });

  it("keeps escaped pipes in a cell and pads short rows to the header width", () => {
    const [table] = splitChunkText("| A | B | C |\n| --- | --- | --- |\n| x \\| y | z |");
    expect(table).toEqual({ type: "table", header: ["A", "B", "C"], rows: [["x | y", "z", ""]] });
  });

  it("leaves pipe lines without a separator row as plain text", () => {
    expect(splitChunkText("| not | a table |\n| still text |")).toEqual([{ type: "text", text: "| not | a table |\n| still text |" }]);
    expect(splitChunkText("")).toEqual([]);
  });
});
