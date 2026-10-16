import path from "node:path";

export function safeSegment(value) {
  const segment = String(value || "").trim();
  if (!segment || segment === "." || segment === ".." || segment.includes("..")) return "";
  if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return "";
  return segment;
}

export function safePathInside(root, ...segments) {
  const resolved = path.resolve(root, ...segments);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (!resolved.startsWith(normalizedRoot)) throw new Error("Chemin de données invalide.");
  return resolved;
}

