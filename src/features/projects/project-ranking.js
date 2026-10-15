const closed = /^(terminé|termine|fait|clos|clôturé|cloture|annulé|annule|validé|valide)$/iu;
function localDateISO(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function validDateISO(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
export function rankProjects(projects, actions = [], today = new Date()) {
  const todayIso = localDateISO(today);
  const upcomingLimit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
  const upcomingIso = localDateISO(upcomingLimit);
  const byProject = new Map();
  for (const item of actions) {
    if (!byProject.has(item.projectSlug)) byProject.set(item.projectSlug, []);
    byProject.get(item.projectSlug).push(item);
  }
  return projects.map((project) => {
    const items = byProject.get(project.slug) || [];
    const pending = items.filter((item) => item.reviewStatus === "à valider").length;
    const active = items.filter((item) => item.reviewStatus !== "à valider" && !closed.test(String(item.statut || "").trim()));
    const overdue = active.filter((item) => validDateISO(item.echeance) && item.echeance < todayIso).length;
    const upcoming = active.filter((item) => validDateISO(item.echeance) && item.echeance >= todayIso && item.echeance <= upcomingIso).length;
    const nearest = active.map((item) => item.echeance).filter((d) => validDateISO(d)).sort()[0] || null;
    return { ...project, pending, activeCount: active.length, overdue, upcoming, nearest };
  }).sort((a, b) =>
    b.overdue - a.overdue ||
    b.pending - a.pending ||
    b.activeCount - a.activeCount ||
    (a.nearest || "9999-12-31").localeCompare(b.nearest || "9999-12-31") ||
    a.name.localeCompare(b.name, "fr")
  );
}
