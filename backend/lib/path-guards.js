import path from "node:path";

export function safeSegment(value) {
  const segment = String(value || "").trim();
  // Examiner NFKC sans renommer les dossiers déjà enregistrés sur disque.
  const normalized = segment.normalize("NFKC");
  if (!normalized || normalized === "." || normalized.includes("..")) return "";
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("\0")) return "";
  // Contrôles C0, DEL et marques bidi pouvant masquer le nom réel.
  if (Array.from(normalized).some((character) => {
    const code = character.codePointAt(0);
    return code <= 0x1f || code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
  })) return "";
  return segment;
}

export function safePathInside(root, ...segments) {
  const resolved = path.resolve(root, ...segments);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (!resolved.startsWith(normalizedRoot)) throw new Error("Chemin de données invalide.");
  return resolved;
}
