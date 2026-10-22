import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("diagnostic local : renvoie du JSON sans données personnelles ni secrets", () => {
  const run = spawnSync(process.execPath, ["scripts/check-local-readiness.mjs"], {
    encoding: "utf8", timeout: 15000
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(typeof report.supportedNode, "boolean");
  assert.equal(typeof report.api.reachable, "boolean");
  assert.equal(typeof report.transcription.reachable, "boolean");
  assert.equal(Object.hasOwn(report, "contents"), false);
  assert.equal(Object.hasOwn(report, "password"), false);
});
