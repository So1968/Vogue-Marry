const ISLAND_KINDS = ["lighthouse", "palms", "mountain", "fortress", "lagoon"];
const MAP_POSITIONS = [
  { x: 19, y: 31 },
  { x: 51, y: 27 },
  { x: 82, y: 49 },
  { x: 54, y: 68 },
  { x: 22, y: 67 }
];

export function projectMeetings(project, meetings) {
  return meetings
    .filter((meeting) => meeting.projectSlug === project.slug)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export function makeProjectViewModel(project, meetings, index = 0) {
  const projectMeetingsList = projectMeetings(project, meetings);
  const pendingMeeting = projectMeetingsList.find((meeting) => meeting.status !== "Validé");
  const status = pendingMeeting?.status || (projectMeetingsList.length ? "À jour" : "Sans escale");
  const tone = status === "Validé" || status === "À jour" ? "green" : status === "Audio à transcrire" ? "red" : "blue";
  const position = MAP_POSITIONS[index % MAP_POSITIONS.length];

  return {
    ...project,
    island: project.name,
    kind: ISLAND_KINDS[index % ISLAND_KINDS.length],
    x: position.x,
    y: position.y,
    status,
    tone,
    detail: projectMeetingsList.length
      ? `${projectMeetingsList.length} escale${projectMeetingsList.length > 1 ? "s" : ""} enregistrée${projectMeetingsList.length > 1 ? "s" : ""}`
      : project.description || "Aucune escale enregistrée",
    cap: projectMeetingsList.length
      ? "La mémoire du projet est disponible dans ses escales et ses journaux."
      : project.description || "Créer une première escale pour commencer la mémoire du projet.",
    next: pendingMeeting
      ? `${pendingMeeting.title} · ${pendingMeeting.status}`
      : projectMeetingsList.length
        ? "Relire la dernière escale et poursuivre le fil."
        : "Préparer la première réunion du projet.",
    meetings: projectMeetingsList
  };
}
