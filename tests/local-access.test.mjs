import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadInternalToken } from "../backend/lib/local-access.js";

test("secret interne : persistant, privé et refus des fichiers non sûrs", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-secret-fictif-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = path.join(dir, "config");
  const token = loadInternalToken(config);
  assert.match(token, /^[a-f0-9]{64}$/u);
  assert.equal(loadInternalToken(config), token);
  const file = path.join(config, "internal_api_token");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.chmodSync(file, 0o644);
  assert.throws(() => loadInternalToken(config), /Permissions/u);
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, "invalide");
  assert.throws(() => loadInternalToken(config), /invalide/u);
  fs.unlinkSync(file);
  const outside = path.join(dir, "secret-fictif");
  fs.writeFileSync(outside, token, { mode: 0o600 });
  fs.symlinkSync(outside, file);
  assert.throws(() => loadInternalToken(config), { code: "ELOOP" });
  assert.equal(fs.readFileSync(outside, "utf8"), token);
});

test("secret interne : huit créations concurrentes publient un seul token complet", { timeout: 60000 }, async (t) => {
  const { spawn } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-token-concurrent-fictif-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = `import { loadInternalToken } from './backend/lib/local-access.js';
    import { createHash } from 'node:crypto';
    const token = loadInternalToken(process.env.VOGUE_TEST_CONFIG_DIR);
    process.stdout.write(createHash('sha256').update(token).digest('hex'));`;
  const results = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: process.cwd(), env: { ...process.env, VOGUE_TEST_CONFIG_DIR: dir }, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (value) => { stdout += String(value); });
    child.stderr.on("data", (value) => { stderr += String(value); });
    child.on("error", reject);
    child.on("close", (code) => { resolve({ code, stdout, stderr }); });
  })));
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^[a-f0-9]{64}$/u);
  }
  assert.equal(new Set(results.map((result) => result.stdout)).size, 1);
  assert.match(fs.readFileSync(path.join(dir, "internal_api_token"), "utf8"), /^[a-f0-9]{64}$/u);
  assert.deepEqual(fs.readdirSync(dir), ["internal_api_token"]);
});
