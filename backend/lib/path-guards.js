import fs from "node:fs";
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

export class PathConfinementError extends Error {
  constructor(cause) {
    super("Chemin de données invalide ou hors de la racine autorisée.", cause ? { cause } : undefined);
    this.code = "VOGUE_PATH_OUTSIDE_ROOT";
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

// Résoudre aussi les destinations non encore créées. Un lien cassé existant
// doit échouer, plutôt qu'être traité comme un simple fichier absent.
function physicalPath(candidate) {
  try { fs.lstatSync(candidate); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = path.dirname(candidate);
    if (parent === candidate) throw error;
    return path.join(physicalPath(parent), path.basename(candidate));
  }
  return fs.realpathSync(candidate);
}

export function safePathInside(root, ...segments) {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...segments);
  if (!isInside(normalizedRoot, resolved)) throw new PathConfinementError();
  try {
    if (!isInside(physicalPath(normalizedRoot), physicalPath(resolved))) throw new PathConfinementError();
  } catch (error) {
    if (error instanceof PathConfinementError) throw error;
    throw new PathConfinementError(error);
  }
  return resolved;
}

// Les chemins complets, pas seulement leurs répertoires parents, sont contrôlés.
// Une partition ne doit pas rediriger vers une autre partition de la mémoire.
export function createDataPath(dataRoot, partitions) {
  const roots = partitions.map((name) => path.resolve(dataRoot, name));
  return (...segments) => {
    const candidate = path.resolve(path.join(...segments));
    safePathInside(dataRoot, path.relative(dataRoot, candidate));
    for (const root of roots) {
      if (isInside(root, candidate)) safePathInside(root, path.relative(root, candidate));
    }
    return candidate;
  };
}
