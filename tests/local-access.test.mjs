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
