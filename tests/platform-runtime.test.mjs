import test from "node:test";
import assert from "node:assert/strict";
import { localPythonPath } from "../backend/lib/runtime-paths.js";
import { protectWindowsPrivatePath } from "../backend/lib/windows-private-path.js";
import { findSetupPython, transcriptionSetupPlan } from "../scripts/lib/transcription-setup.mjs";

test("runtime : chemins Python natifs Windows et Unix avec espaces", () => {
  assert.equal(localPythonPath("C:\\Projet fictif\\Vogue Marry", "win32"), "C:\\Projet fictif\\Vogue Marry\\.venv-transcription\\Scripts\\python.exe");
  assert.equal(localPythonPath("/tmp/Projet fictif", "linux"), "/tmp/Projet fictif/.venv-transcription/bin/python");
});

test("installation : lanceur py Windows, versions incompatibles et exécutable explicite", () => {
  const calls = [];
  const run = (command, args) => { calls.push({ command, args }); return { status: 0, stdout: "[3,12]" }; };
  const found = findSetupPython("win32", {}, run);
  assert.equal(found.command, "py"); assert.deepEqual(found.args, ["-3.12"]);
  assert.deepEqual(calls[0].args.slice(0, 2), ["-3.12", "-c"]);
  assert.throws(() => findSetupPython("win32", {}, () => ({ status: 0, stdout: "[3,9]" })), /Python 3.10/u);
  const executable = "C:\\Python fictif\\python.exe";
  assert.equal(findSetupPython("win32", { PYTHON_BIN: executable }, run).command, executable);
});

test("installation : plan sans shell et refus de remplacer un venv incompatible", () => {
  const root = "C:\\Projet fictif\\Vogue Marry";
  const python = { command: "py", args: ["-3.12"] };
  const plan = transcriptionSetupPlan(root, python, "win32", () => false);
  assert.deepEqual(plan[0], { command: "py", args: ["-3.12", "-m", "venv", `${root}\\.venv-transcription`] });
  assert.equal(plan[3].command, `${root}\\.venv-transcription\\Scripts\\python.exe`);
  assert.equal(plan[3].args.at(-1), `${root}\\requirements-transcription.txt`);
  assert.throws(() => transcriptionSetupPlan(root, python, "win32", (file) => file.endsWith(".venv-transcription")), /aucun écrasement/u);
});

test("secrets Windows : chemin transmis comme donnée et échec ACL bloquant", () => {
  const target = "C:\\Dossier fictif ' & $env:NE_PAS_EXECUTER\\secret";
  let seen;
  protectWindowsPrivatePath(target, true, (command, args, options) => {
    seen = { command, args, options }; return { status: 0 };
  });
  assert.equal(seen.command, "powershell.exe");
  assert.equal(seen.options.env.VOGUE_PRIVATE_PATH, target);
  assert.equal(seen.options.env.VOGUE_PRIVATE_DIRECTORY, "1");
  assert.ok(!seen.args.join(" ").includes(target));
  assert.ok(!seen.args.includes("-ExecutionPolicy"));
  assert.throws(() => protectWindowsPrivatePath(target, false, () => ({ status: 1, stderr: "secret à ne pas recopier" })),
    /Protection Windows des secrets impossible/u);
});
