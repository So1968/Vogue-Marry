import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { probePythonDependencies } from "../scripts/lib/python-readiness.mjs";
import { localPythonPath } from "../backend/lib/runtime-paths.js";

const marker = "__VOGUE_DEPENDENCY__";
const line = (value) => marker + JSON.stringify(value) + "\n";

test("diagnostic Python : absence sans exécution ni création de données", () => {
  const report = probePythonDependencies("python-fictif", { exists: () => false, run: () => { throw new Error("Ne pas exécuter"); } });
  assert.equal(report.state, "missing");
  assert.equal(report.pythonAvailable, false);
  assert.equal(report.fasterWhisper, false);
});

test("diagnostic Python : imports contrôlés hors ligne et diagnostics privés ignorés", () => {
  const report = probePythonDependencies("python-fictif", { exists: () => true, run: (_command, _args, options) => {
    assert.equal(options.env.HF_HUB_OFFLINE, "1");
    assert.equal(options.env.TRANSFORMERS_OFFLINE, "1");
    assert.equal(options.env.PYANNOTE_METRICS_ENABLED, "0");
    assert.equal(options.env.PYTHONUTF8, "1");
    return { status: 0, stdout: "SECRET_FICTIF_NE_PAS_AFFICHER\n" + line({ version: [3, 12] }) +
      line({ name: "fasterWhisper", available: true }) + line({ name: "av", available: true }) + line({ name: "pyannote", available: false }),
    stderr: "CHEMIN_PRIVE_FICTIF_NE_PAS_AFFICHER" };
  } });
  assert.equal(report.state, "checked");
  assert.equal(report.supportedVersion, true);
  assert.equal(report.fasterWhisper, true);
  assert.equal(report.pyannote, false);
  assert.ok(!JSON.stringify(report).includes("NE_PAS_AFFICHER"));
});

test("diagnostic Python : sonde interrompue et version incompatible restent visibles", () => {
  const report = probePythonDependencies("python-fictif", { exists: () => true, run: () => ({ status: null,
    stdout: line({ version: [3, 14] }) + line({ name: "fasterWhisper", available: true }) }) });
  assert.equal(report.state, "incomplete");
  assert.equal(report.supportedVersion, false);
  assert.equal(report.pyannote, false);
});

test("diagnostic Python : un vrai venv vide ne vaut pas moteur installé", { timeout: 30000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue prerequis fictifs "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const created = spawnSync(process.platform === "win32" ? "python" : "python3", ["-m", "venv", "--without-pip", path.join(root, ".venv-transcription")], {
    encoding: "utf8", timeout: 15000, windowsHide: true
  });
  assert.equal(created.status, 0, created.stderr);
  const python = localPythonPath(root);
  assert.equal(fs.existsSync(python), true);
  const report = probePythonDependencies(python);
  assert.equal(report.pythonAvailable, true);
  assert.equal(report.supportedVersion, true);
  assert.equal(report.state, "checked");
  assert.equal(report.fasterWhisper, false);
  assert.equal(report.av, false);
  assert.equal(report.pyannote, false);
});
