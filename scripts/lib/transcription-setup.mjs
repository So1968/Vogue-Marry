import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { localPythonPath } from "../../backend/lib/runtime-paths.js";

export function findSetupPython(platform = process.platform, env = process.env, run = spawnSync) {
  const candidates = env.PYTHON_BIN ? [{ command: env.PYTHON_BIN, args: [] }]
    : platform === "win32" ? [{ command: "py", args: ["-3.12"] }, { command: "python", args: [] }]
      : [{ command: "python3", args: [] }];
  for (const candidate of candidates) {
    const result = run(candidate.command, [...candidate.args, "-c", "import json,sys; print(json.dumps(list(sys.version_info[:2])))"], {
      encoding: "utf8", windowsHide: true, timeout: 10_000
    });
    if (result.status !== 0 || result.error) continue;
    let version;
    try { version = JSON.parse(result.stdout); } catch { continue; }
    if (Array.isArray(version) && version[0] === 3 && Number.isInteger(version[1]) && version[1] >= 10 && version[1] < 14) {
      return { ...candidate, version: version.join(".") };
    }
  }
  throw new Error("Python 3.10 à 3.13 avec venv est requis. Python 3.12 est recommandé ; sous Windows, installer Python 3.12 et son lanceur py.");
}

export function transcriptionSetupPlan(projectRoot, python, platform = process.platform, exists = fs.existsSync) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const venv = paths.join(projectRoot, ".venv-transcription");
  const executable = localPythonPath(projectRoot, platform);
  if (exists(venv) && !exists(executable)) {
    throw new Error("Le venv existant est incompatible ou incomplet. Le conserver en le renommant avant de relancer l'installation ; aucun écrasement automatique.");
  }
  const steps = [];
  if (!exists(executable)) steps.push({ command: python.command, args: [...python.args, "-m", "venv", venv] });
  steps.push(
    { command: executable, args: ["-c", "import sys; assert (3,10) <= sys.version_info[:2] < (3,14), 'Version Python du venv incompatible'"] },
    { command: executable, args: ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"] },
    { command: executable, args: ["-m", "pip", "install", "-r", paths.join(projectRoot, "requirements-transcription.txt")] },
    { command: executable, args: ["-c", "import faster_whisper; import av; import pyannote.audio; print('Imports Python verifies.')"] }
  );
  return steps;
}
