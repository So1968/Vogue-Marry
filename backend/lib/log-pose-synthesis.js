import { normalizeKnowledgeText } from "./knowledge-markdown.js";

export function makeLogPoseSynthesis({ readKnowledgeEntries, readValidatedKnowledgeProposals, listProjectMeetings, readProjectRecord, readLogPoseManual }) {
function isClosedKnowledgeStatus(value) {
  return /^(fait|faite|termine|terminee|clos|close|annule|annulee|abandonne|abandonnee)$/u.test(normalizeKnowledgeText(value));
}

function sortKnowledgeByDate(entries) {
  return [...entries].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function knowledgeReviewCounts(projectSlug, kind) {
  const accepted = readKnowledgeEntries(projectSlug, kind);
  const acceptedIds = new Set(accepted.map((item) => item.id));
  const pending = readValidatedKnowledgeProposals(projectSlug, kind)
    .filter((item) => !acceptedIds.has(item.id));
  return { accepted, pending };
}

function buildLogPose(projectSlug, manual = readLogPoseManual(projectSlug)) {
  const meetings = listProjectMeetings(projectSlug);
  const { accepted: decisions, pending: pendingDecisions } = knowledgeReviewCounts(projectSlug, "decision");
  const { accepted: actions, pending: pendingActions } = knowledgeReviewCounts(projectSlug, "action");
  const { accepted: needs, pending: pendingNeeds } = knowledgeReviewCounts(projectSlug, "need");
  const orderedDecisions = sortKnowledgeByDate(decisions);
  const latestDecision = orderedDecisions[0] || null;
  const priorityActions = actions
    .filter((item) => !isClosedKnowledgeStatus(item.statut))
    .sort((a, b) => {
      const statusRank = (value) => normalizeKnowledgeText(value) === "en cours" ? 0 : 1;
      return statusRank(a.statut) - statusRank(b.statut) || String(a.date || "").localeCompare(String(b.date || ""));
    })
    .slice(0, 5);
  const priorityNeeds = needs
    .filter((item) => !isClosedKnowledgeStatus(item.statut))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(0, 5);
  const latestMeeting = meetings[0] || null;
  const projectName = latestDecision?.projectName
    || priorityActions[0]?.projectName
    || priorityNeeds[0]?.projectName
    || readProjectRecord(projectSlug).name;
  const fallbackRemember = latestDecision?.decision
    || priorityNeeds[0]?.need
    || (latestMeeting ? `Dernière escale : ${latestMeeting.title}` : "Aucun repère validé pour le moment.");
  const fallbackDirection = priorityActions[0]?.action
    || (priorityNeeds[0] ? `Cadrer le besoin : ${priorityNeeds[0].need}` : "")
    || (pendingActions.length || pendingDecisions.length || pendingNeeds.length
      ? "Relire les propositions en attente de validation."
      : latestMeeting
        ? "Relire la dernière escale et poursuivre le fil."
        : "Préparer la première escale du projet.");

  return {
    version: 1,
    scope: "project",
    projectSlug,
    projectName,
    position: projectName,
    updatedAt: new Date().toISOString(),
    whatToRemember: manual.whatToRemember || fallbackRemember,
    lastMeeting: latestMeeting,
    lastDecision: latestDecision,
    priorityActions,
    priorityNeeds,
    openQuestions: manual.openQuestions,
    documentsToFind: manual.documentsToFind,
    nextDirection: manual.nextDirection || fallbackDirection,
    pendingReview: {
      actions: pendingActions.length,
      decisions: pendingDecisions.length,
      needs: pendingNeeds.length,
      total: pendingActions.length + pendingDecisions.length + pendingNeeds.length
    }
  };
}


function buildGlobalLogPose(projectSlugs) {
  const projectSnapshots = projectSlugs.map((projectSlug) => buildLogPose(projectSlug));
  const meetings = projectSnapshots
    .map((snapshot) => snapshot.lastMeeting ? { ...snapshot.lastMeeting, projectName: snapshot.projectName } : null)
    .filter(Boolean)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const decisions = projectSnapshots
    .map((snapshot) => snapshot.lastDecision ? { ...snapshot.lastDecision, projectName: snapshot.projectName } : null)
    .filter(Boolean)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const priorityActions = projectSnapshots
    .flatMap((snapshot) => snapshot.priorityActions.map((item) => ({ ...item, projectName: snapshot.projectName })))
    .slice(0, 5);
  const priorityNeeds = projectSnapshots
    .flatMap((snapshot) => (snapshot.priorityNeeds || []).map((item) => ({ ...item, projectName: snapshot.projectName })))
    .slice(0, 5);
  const pendingReview = projectSnapshots.reduce((total, snapshot) => ({
    actions: total.actions + snapshot.pendingReview.actions,
    decisions: total.decisions + snapshot.pendingReview.decisions,
    needs: total.needs + (snapshot.pendingReview.needs || 0),
    total: total.total + snapshot.pendingReview.total
  }), { actions: 0, decisions: 0, needs: 0, total: 0 });

  return {
    version: 1,
    scope: "global",
    projectSlug: "",
    projectName: "Mémoire globale",
    position: projectSlugs.length ? `${projectSlugs.length} île${projectSlugs.length > 1 ? "s" : ""} suivie${projectSlugs.length > 1 ? "s" : ""}` : "Aucune île enregistrée",
    updatedAt: new Date().toISOString(),
    whatToRemember: decisions[0]?.decision || priorityNeeds[0]?.need || (meetings[0] ? `Dernière escale : ${meetings[0].title}` : "Aucun repère validé pour le moment."),
    lastMeeting: meetings[0] || null,
    lastDecision: decisions[0] || null,
    priorityActions,
    priorityNeeds,
    openQuestions: [],
    documentsToFind: [],
    nextDirection: priorityActions[0]?.action || (priorityNeeds[0] ? `Cadrer le besoin : ${priorityNeeds[0].need}` : null) || (pendingReview.total ? "Relire les propositions en attente de validation." : "Choisir une île pour reprendre le fil."),
    pendingReview
  };
}

  return { buildLogPose, buildGlobalLogPose };
}
