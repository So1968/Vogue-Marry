import fs from "node:fs";
import path from "node:path";

export function makeLogPoseWriter({ projectsRoot, safePathInside, ensureDir, normalizeLogPoseManual, knowledgeMarkdownValue }) {
  function logPoseMarkdownList(items, emptyText) {
  return items.length ? items.map((item) => `- ${knowledgeMarkdownValue(item)}`) : [`- ${emptyText}`];
}

function writeLogPose(projectSlug, snapshot, manual) {
  const directory = safePathInside(projectsRoot, projectSlug, "10_log_pose");
  ensureDir(directory);
  const normalizedManual = normalizeLogPoseManual(manual);
  const payload = { ...snapshot, manual: normalizedManual };
  fs.writeFileSync(path.join(directory, "log_pose.json"), JSON.stringify(payload, null, 2), "utf8");

  const actionLines = snapshot.priorityActions.length
    ? snapshot.priorityActions.map((item) => {
      const details = [item.responsable, item.echeance].filter(Boolean).join(" · ");
      return `- [${knowledgeMarkdownValue(item.statut || "À préciser")}] ${knowledgeMarkdownValue(item.action)}${details ? ` — ${knowledgeMarkdownValue(details)}` : ""}`;
    })
    : ["- Aucune manœuvre prioritaire validée."];
  const decisionLine = snapshot.lastDecision
    ? `- ${knowledgeMarkdownValue(snapshot.lastDecision.decision)} (${knowledgeMarkdownValue(snapshot.lastDecision.statut || "À préciser")})`
    : "- Aucun cap validé pour le moment.";
  const needLines = snapshot.priorityNeeds?.length
    ? snapshot.priorityNeeds.map((item) => `- [${knowledgeMarkdownValue(item.priority || "À préciser")}] ${knowledgeMarkdownValue(item.need)}${item.context ? ` — ${knowledgeMarkdownValue(item.context)}` : ""}`)
    : ["- Aucun besoin validé pour le moment."];
  const lines = [
    `# Log Pose — ${knowledgeMarkdownValue(snapshot.projectName)}`,
    "",
    `_Mise à jour : ${snapshot.updatedAt}_`,
    "",
    "## Ce qu’il faut retenir",
    "",
    knowledgeMarkdownValue(snapshot.whatToRemember || "Aucun repère validé pour le moment."),
    "",
    "## Dernier cap validé",
    "",
    decisionLine,
    "",
    "## Manœuvres prioritaires",
    "",
    ...actionLines,
    "",
    "## Besoins à cadrer",
    "",
    ...needLines,
    "",
    "## Questions ouvertes",
    "",
    ...logPoseMarkdownList(normalizedManual.openQuestions, "Aucune question ouverte enregistrée."),
    "",
    "## Documents à retrouver",
    "",
    ...logPoseMarkdownList(normalizedManual.documentsToFind, "Aucun document à retrouver enregistré."),
    "",
    "## Prochaine direction utile",
    "",
    knowledgeMarkdownValue(snapshot.nextDirection || "Aucune direction définie."),
    "",
    "## État de validation",
    "",
    `- ${snapshot.pendingReview.total} élément${snapshot.pendingReview.total > 1 ? "s" : ""} en attente de validation (${snapshot.pendingReview.actions} manœuvre${snapshot.pendingReview.actions > 1 ? "s" : ""}, ${snapshot.pendingReview.decisions} cap${snapshot.pendingReview.decisions > 1 ? "s" : ""}, ${snapshot.pendingReview.needs || 0} besoin${(snapshot.pendingReview.needs || 0) > 1 ? "s" : ""}).`
  ];
  fs.writeFileSync(path.join(directory, "log_pose.md"), `${lines.join("\n")}\n`, "utf8");
  return payload;
}


  return writeLogPose;
}
