import { localPythonPath } from "../backend/lib/runtime-paths.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
test("diagnostic local : renvoie du JSON sans données personnelles ni secrets", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-readiness-home-fictif-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const run = spawnSync(process.execPath, ["scripts/check-local-readiness.mjs"], {
    encoding: "utf8", timeout: 45000, env: { ...process.env, HOME: home, USERPROFILE: home }
  });
  assert.ok(run.status === 0 || run.status === 1, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(run.status, report.readyForLocalAttempt ? 0 : 1);
  assert.equal(report.modelsTested, false);
  assert.equal(report.microphoneTested, false);
  assert.equal(fs.existsSync(path.join(home, "VOGUE-MERRY-DONNEES")), false);
  assert.equal(typeof report.supportedNode, "boolean");
  assert.equal(typeof report.api.reachable, "boolean");
  assert.equal(typeof report.transcription.reachable, "boolean");
  assert.equal(Object.hasOwn(report, "contents"), false);
  assert.equal(Object.hasOwn(report, "password"), false);
});


test("diagnostic local : retrouver le venv du dépôt depuis un autre répertoire", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-readiness-cwd-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [path.resolve("scripts/check-local-readiness.mjs")], {
    cwd, encoding: "utf8", timeout: 45000
  });
  assert.ok(run.status === 0 || run.status === 1, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(run.status, report.readyForLocalAttempt ? 0 : 1);
  assert.equal(report.localPythonEnvironment, fs.existsSync(localPythonPath(process.cwd())));
  assert.equal(typeof report.api.healthy, "boolean");
  assert.equal(typeof report.transcription.healthy, "boolean");
});
