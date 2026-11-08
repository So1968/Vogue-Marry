import test from "node:test";
import assert from "node:assert/strict";
import { runJsonLines } from "../backend/lib/json-lines-process.js";

const run = (source, onEvent = () => {}) => runJsonLines(process.execPath, ["--input-type=module", "-e", source], onEvent);
const emit = (events) => `process.stdout.write(${JSON.stringify(events.map((event) => JSON.stringify(event)).join("\n"))});`;

test("moteur local : flux complet UTF-8 fragmenté sans retour final", async () => {
  const events = [{ type: "segment", text: "Réunion fictive — décision", start: 0, end: 1 }, { type: "done", segments: 1 }];
  const received = [];
  const data = events.map((event) => JSON.stringify(event)).join("\r\n");
  await run(`const b = Buffer.from(${JSON.stringify(data)}); for (const byte of b) { process.stdout.write(Buffer.from([byte])); await new Promise(r => setTimeout(r, 1)); }`, (event) => received.push(event));
  assert.deepEqual(received, events);
});

test("moteur local : silence terminé et diarisation terminée acceptés", async () => {
  await run(emit([{ type: "done", segments: 0 }]));
  await run(emit([{ type: "speaker_segment", speaker: "SPEAKER_00", start: 0, end: 1 }, { type: "done", segments: 1 }]));
});

test("moteur local : code zéro sans fin ou JSON tronqué refusé", async () => {
  await assert.rejects(run(""), /événement de fin.*absent/u);
  await assert.rejects(run(emit([{ type: "segment", text: "Texte partiel fictif" }])), /événement de fin.*absent/u);
  await assert.rejects(run('process.stdout.write(\'{"type":"done"\');'), /JSON invalide/u);
});

test("moteur local : décompte incohérent, doublon de fin et événement tardif refusés", async () => {
  await assert.rejects(run(emit([{ type: "done", segments: 1 }])), /segments incohérent/u);
  await assert.rejects(run(emit([{ type: "segment" }, { type: "done", segments: 0 }])), /segments incohérent/u);
  await assert.rejects(run(emit([{ type: "done", segments: 0 }, { type: "done", segments: 0 }])), /après la fin/u);
  await assert.rejects(run(emit([{ type: "done", segments: 0 }, { type: "segment" }])), /après la fin/u);
});

test("moteur local : erreur déclarée, arrêt non nul et callback échoué refusés", async () => {
  await assert.rejects(run(emit([{ type: "error", message: "Erreur fictive du modèle" }])), /Erreur fictive/u);
  await assert.rejects(run(emit([{ type: "done", segments: 0 }]) + "process.exitCode = 7;"), /arrêté/u);
  const failure = new Error("Écriture fictive refusée");
  await assert.rejects(run(emit([{ type: "segment" }, { type: "done", segments: 1 }]), () => { throw failure; }), (error) => error === failure);
});

test("moteur local : flux invalide interrompt aussi un processus qui reste actif", { timeout: 5000 }, async () => {
  await assert.rejects(run('process.stdout.write("invalide\\n"); setInterval(() => {}, 1000);'), /JSON invalide/u);
});

test("moteur local : événement démesuré et exécutable absent refusés", async () => {
  await assert.rejects(run('process.stdout.write("x".repeat(1024 * 1024 + 1));'), /trop volumineux/u);
  await assert.rejects(runJsonLines("vogue-executable-fictif-absent", [], () => {}), { code: "ENOENT" });
});
