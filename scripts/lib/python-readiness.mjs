import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pythonProcessEnv } from "../../backend/lib/runtime-paths.js";

const marker = "__VOGUE_DEPENDENCY__";
const source = `import importlib,json,sys
print('${marker}'+json.dumps({'version':list(sys.version_info[:2])}),flush=True)
for name,module in [('fasterWhisper','faster_whisper'),('av','av'),('pyannote','pyannote.audio')]:
    try:
        importlib.import_module(module)
        available=True
    except Exception:
        available=False
    print('${marker}'+json.dumps({'name':name,'available':available}),flush=True)
`;

export function probePythonDependencies(python, { exists = fs.existsSync, run = spawnSync } = {}) {
  const report = { pythonAvailable: false, supportedVersion: false, fasterWhisper: false, av: false, pyannote: false, state: "missing" };
  if (!exists(python)) return report;
  const result = run(python, ["-c", source], {
    encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 128 * 1024, windowsHide: true,
    env: pythonProcessEnv({ ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", PYANNOTE_METRICS_ENABLED: "0" })
  });
  const seen = new Set();
  for (const line of String(result.stdout || "").split(/\r?\n/u)) {
    if (!line.startsWith(marker)) continue;
    let event;
    try { event = JSON.parse(line.slice(marker.length)); } catch { continue; }
    if (!event || typeof event !== "object") continue;
    if (Array.isArray(event.version) && event.version.length === 2 && event.version.every(Number.isInteger)) {
      report.pythonAvailable = true;
      report.version = event.version.join(".");
      report.supportedVersion = event.version[0] === 3 && event.version[1] >= 10 && event.version[1] < 14;
    }
    if (["fasterWhisper", "av", "pyannote"].includes(event.name) && typeof event.available === "boolean") {
      report[event.name] = event.available;
      seen.add(event.name);
    }
  }
  report.state = result.status === 0 && seen.size === 3 && report.pythonAvailable ? "checked" : "incomplete";
  return report;
}
