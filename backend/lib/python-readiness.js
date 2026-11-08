import fs from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { pythonProcessEnv } from "./runtime-paths.js";

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
  return parseProbe(result.stdout, result.status === 0);
}

function emptyReport(state = "missing") {
  return { pythonAvailable: false, supportedVersion: false, fasterWhisper: false, av: false, pyannote: false, state };
}

function parseProbe(stdout, success) {
  const report = emptyReport();
  const seen = new Set();
  for (const line of String(stdout || "").split(/\r?\n/u)) {
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
  report.state = success && seen.size === 3 && report.pythonAvailable ? "checked" : "incomplete";
  return report;
}

export function probePythonDependenciesAsync(python) {
  if (!fs.existsSync(python)) return Promise.resolve(emptyReport());
  return new Promise((resolve) => {
    execFile(python, ["-c", source], {
      encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 128 * 1024, windowsHide: true,
      env: pythonProcessEnv({ ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", PYANNOTE_METRICS_ENABLED: "0" })
    }, (error, stdout) => resolve(parseProbe(stdout, !error)));
  });
}

export function probeExecutable(command, args = ["-version"]) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000, killSignal: "SIGKILL", maxBuffer: 128 * 1024, windowsHide: true },
      (error) => resolve(!error));
  });
}

export function createCachedPythonProbe(python, { probe = probePythonDependenciesAsync, now = Date.now, ttlMs = 30000 } = {}) {
  let cached, expiresAt = 0, pending;
  return () => {
    if (cached && now() < expiresAt) return Promise.resolve(cached);
    if (!pending) {
      pending = Promise.resolve().then(() => probe(python)).catch(() => emptyReport("incomplete")).then((report) => {
        cached = report;
        expiresAt = now() + ttlMs;
        return report;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}
