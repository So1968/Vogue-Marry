import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeLogPoseWriter } from "../backend/lib/log-pose-writer.js";
import { normalizeLogPoseManual } from "../backend/lib/log-pose-normalization.js";
import { safePathInside } from "../backend/lib/path-guards.js";

test("écrit et relit les fichiers Log Pose fictifs sans modifier leurs rubriques", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-logpose-write-"));
  const write = makeLogPoseWriter({
    projectsRoot:root,
    safePathInside,
    ensureDir:(dir)=>fs.mkdirSync(dir,{recursive:true}),
    normalizeLogPoseManual,
    knowledgeMarkdownValue:(value)=>String(value ?? "")
  });
  const snapshot = {
    projectName:"Île test", updatedAt:"2026-10-16",
    priorityActions:[{action:"Préparer le devis",responsable:"Mateo",echeance:"2026-11-20",statut:"À faire"}],
    priorityNeeds:[],
    lastDecision:{decision:"Valider le cap",statut:"Validé"},
    whatToRemember:"Reprendre le dossier",
    nextDirection:"Téléphoner",
    pendingReview:{total:1,actions:1,decisions:0,needs:0}
  };
  try {
    const payload = write("ile_test",snapshot,{openQuestions:["Quand ?"],documentsToFind:["devis"],nextDirection:"Téléphoner"});
    const folder = path.join(root,"ile_test","10_log_pose");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,"log_pose.json"),"utf8")),payload);
    const markdown = fs.readFileSync(path.join(folder,"log_pose.md"),"utf8");
    for(const text of ["# Log Pose — Île test","## Dernier cap validé","## Manœuvres prioritaires","Préparer le devis","## Questions ouvertes","- Quand ?","## Documents à retrouver","- devis","## Prochaine direction utile"]) assert.ok(markdown.includes(text),text);
    assert.equal(payload.manual.nextDirection,"Téléphoner");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
