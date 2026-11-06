import test from "node:test";
import assert from "node:assert/strict";
import { makeLogPoseSynthesis } from "../backend/lib/log-pose-synthesis.js";

function setup({ actions = [], decisions = [], needs = [], pending = [] } = {}) {
  const items = { action: actions, decision: decisions, need: needs };
  return makeLogPoseSynthesis({
    readKnowledgeEntries: (_slug, kind) => items[kind],
    readValidatedKnowledgeProposals: (_slug, kind) => pending.filter((entry) => entry.kind === kind),
    listProjectMeetings: () => [],
    readProjectRecord: (slug) => ({ name: slug }),
    readLogPoseManual: () => ({ whatToRemember: "", openQuestions: [], documentsToFind: [], nextDirection: "" })
  });
}

test("synthèse projet : actions ouvertes et besoins, sans les éléments terminés", () => {
  const { buildLogPose } = setup({
    actions: [
      { id:"fini", action:"Ancienne action", statut:"Terminé" },
      { id:"ouvert", action:"Prochaine manœuvre", statut:"En cours", date:"2026-10-16" }
    ],
    decisions: [{ id:"cap", decision:"Cap confirmé", date:"2026-10-15" }],
    needs: [{ id:"besoin", need:"Préparer dossier", statut:"À faire" }],
    pending: [{kind:"action",id:"proposition"}]
  });
  const result = buildLogPose("ile_test");
  assert.equal(result.priorityActions.length, 1);
  assert.equal(result.priorityActions[0].action, "Prochaine manœuvre");
  assert.equal(result.lastDecision.decision, "Cap confirmé");
  assert.equal(result.priorityNeeds[0].need, "Préparer dossier");
  assert.equal(result.pendingReview.total, 1);
  assert.equal(result.nextDirection, "Prochaine manœuvre");
});

test("synthèse globale : agrège toutes les îles sans confondre leurs projets", () => {
  const { buildGlobalLogPose } = setup({ actions:[{id:"a",action:"Relancer",statut:"À faire"}] });
  const result = buildGlobalLogPose(["ile_alpha","ile_beta"]);
  assert.equal(result.scope, "global");
  assert.equal(result.position, "2 îles suivies");
  assert.equal(result.priorityActions.length, 2);
  assert.deepEqual(result.priorityActions.map(a => a.projectName), ["ile_alpha","ile_beta"]);
  assert.equal(result.nextDirection, "Relancer");
});

test("synthèse globale : les priorités ne dépendent pas de l'ordre des îles", () => {
  const synthesis = makeLogPoseSynthesis({
    readKnowledgeEntries: (slug, kind) => {
      if (kind === "action") return slug === "ile_premiere"
        ? Array.from({ length: 5 }, (_, i) => ({ id: `attente-${i}`, action: "À préparer", statut: "À faire", date: "2026-11-05" }))
        : [{ id: "prioritaire", action: "Reprendre le travail engagé", statut: "En cours", date: "2026-11-06" }];
      if (kind === "need") return [{ id: slug, need: "Besoin fictif", date: slug === "ile_premiere" ? "2026-11-06" : "2026-11-01" }];
      return [];
    },
    readValidatedKnowledgeProposals: () => [], listProjectMeetings: () => [],
    readProjectRecord: (slug) => ({ name: slug }),
    readLogPoseManual: () => ({ whatToRemember: "", openQuestions: [], documentsToFind: [], nextDirection: "" })
  });
  for (const slugs of [["ile_premiere", "ile_seconde"], ["ile_seconde", "ile_premiere"]]) {
    const result = synthesis.buildGlobalLogPose(slugs);
    assert.equal(result.priorityActions.length, 5);
    assert.equal(result.priorityActions[0].id, "prioritaire");
    assert.equal(result.priorityActions[0].projectName, "ile_seconde");
    assert.equal(result.nextDirection, "Reprendre le travail engagé");
    assert.equal(result.priorityNeeds[0].id, "ile_seconde");
  }
});
