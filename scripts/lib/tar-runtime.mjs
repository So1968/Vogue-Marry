import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

let runtime;

// Les contrôles de cohérence utilisent --compare : bsdtar ne suffit pas.
// Aucun téléchargement ni shell ; un chemin explicite désigne un exécutable.
export function tarRuntime() {
  if (runtime) return runtime;
  const explicit = process.env.VOGUE_TAR_PATH;
  const candidates = explicit ? [explicit] : ["tar"];
  if (!explicit && process.platform === "win32") {
    for (const root of [process.env.ProgramW6432, process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
      if (root) candidates.push(path.join(root, "Git", "usr", "bin", "tar.exe"));
    }
  }
  for (const command of [...new Set(candidates)]) {
    const env = { ...process.env };
    if (path.isAbsolute(command)) env.PATH = path.dirname(command) + path.delimiter + process.env.PATH;
    const result = spawnSync(command, ["--version"], { env, encoding: "utf8", timeout: 10000, windowsHide: true });
    if (result.status === 0 && /\bGNU tar\b/u.test(result.stdout)) {
      runtime = { command, env };
      return runtime;
    }
  }
  throw new Error("GNU tar est requis pour vérifier les sauvegardes. Installer GNU tar (par exemple avec Git for Windows), ou définir VOGUE_TAR_PATH vers son exécutable. Le tar intégré à Windows ne suffit pas.");
}

export function spawnTar(args, options = {}) {
  const { command, env } = tarRuntime();
  return spawn(command, ["--force-local", ...args], { ...options, env, windowsHide: true });
}

export function spawnTarSync(args, options = {}) {
  const { command, env } = tarRuntime();
  return spawnSync(command, ["--force-local", ...args], { ...options, env, windowsHide: true });
}
