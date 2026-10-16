import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeLogPoseReader } from "../backend/lib/log-pose-reader.js";
import { normalizeLogPoseManual } from "../backend/lib/log-pose-normalization.js";
import { safePathInside } from "../backend/lib/path-guards.js";

test("Log Pose : lit les notes JSON et préserve la reprise après redémarrage", () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-logpose-read-"));
 const directory = path.join(root, "ile_test", "10_log_pose");
 fs.mkdirSync(directory, {recursive:true});
 const defaults = { whatToRemember:"", openQuestions:[], documentsToFind:[], nextDirection:"" };
 const extractMarkdownSection = (content, headings) => {
  const lines = content.split(/\r?\n/u);
  const index = lines.findIndex(line => line === "## " + headings[0]);
  if (index < 0) return [];
  let end = index + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end += 1;
  return lines.slice(index + 1, end);
 };
 const read = makeLogPoseReader({projectsRoot:root,safePathInside,readJsonIfExists:(file)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):null,normalizeLogPoseManual,extractMarkdownSection,defaults});
 try {
  assert.deepEqual(read("ile_test"),defaults);
  fs.writeFileSync(path.join(directory,"log_pose.md"), "# Log Pose\n\n## Ce qu’il faut retenir\n\nUn rendez-vous important\n\n## Questions ouvertes\n\n- Quand ?\n\n## Documents à retrouver\n\n- Devis\n\n## Prochaine direction utile\n\nPréparer la suite\n");
  assert.deepEqual(read("ile_test"),{whatToRemember:"Un rendez-vous important",openQuestions:["Quand ?"],documentsToFind:["Devis"],nextDirection:"Préparer la suite"});
  fs.writeFileSync(path.join(directory,"log_pose.json"),JSON.stringify({manual:{whatToRemember:"JSON prioritaire",nextDirection:"Relancer"}}));
  assert.deepEqual(read("ile_test"),{whatToRemember:"JSON prioritaire",openQuestions:[],documentsToFind:[],nextDirection:"Relancer"});
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
