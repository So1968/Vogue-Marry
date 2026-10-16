export function normalizeKnowledgeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function markdownCells(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function isMarkdownSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(String(line || "").trim());
}

export function extractMarkdownSection(content, headings) {
  const wanted = new Set(headings.map(normalizeKnowledgeText));
  const lines = String(content || "").split(/\r?\n/u);
  const start = lines.findIndex((line) => {
    if (!/^#{2,6}\s+/u.test(line.trim())) return false;
    return wanted.has(normalizeKnowledgeText(line.replace(/^#{2,6}\s+/u, "")));
  });
  if (start < 0) return [];

  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/u.test(line.trim())) break;
    section.push(line);
  }
  return section;
}

export function parseKnowledgeSection(lines, kind) {
  const meaningfulLines = lines.map((line) => line.trim()).filter(Boolean);
  if (!meaningfulLines.length) return [];

  const tableLines = meaningfulLines.filter((line) => line.startsWith("|"));
  if (tableLines.length >= 2 && isMarkdownSeparator(tableLines[1])) {
    const headers = markdownCells(tableLines[0]).map(normalizeKnowledgeText);
    return tableLines.slice(2)
      .filter((line) => !isMarkdownSeparator(line))
      .map((line) => {
        const values = markdownCells(line);
        return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
      })
      .filter((row) => Object.values(row).some(Boolean));
  }

  return meaningfulLines
    .map((line) => line.replace(/^[-*]\s+/u, "").replace(/^\d+[.)]\s+/u, "").trim())
    .filter(Boolean)
    .map((text) => ({ [kind === "action" ? "action" : kind === "decision" ? "decision" : "need"]: text }));
}

export function pickKnowledgeValue(row, names) {
  for (const name of names) {
    const value = row[normalizeKnowledgeText(name)];
    if (value) return value.trim();
  }
  return "";
}

