const closed = /^(terminé|termine|fait|clos|clôturé|cloture|annulé|annule|validé|valide)$/iu;
export function rankProjects(projects, actions = [], today = new Date()) {
  const todayIso = today.toISOString().slice(0, 10);
  const upcomingLimit = new Date(today);
  upcomingLimit.setUTCDate(upcomingLimit.getUTCDate() + 2);
  const upcomingIso = upcomingLimit.toISOString().slice(0, 10);
  const byProject = new Map();
  for (const item of actions) {
    if (!byProject.has(item.projectSlug)) byProject.set(item.projectSlug, []);
    byProject.get(item.projectSlug).push(item);
  }
  return projects.map((project) => {
    const items = byProject.get(project.slug) || [];
    const pending = items.filter((item) => item.reviewStatus === "à valider").length;
    const active = items.filter((item) => item.reviewStatus !== "à valider" && !closed.test(String(item.statut || "").trim()));
    const overdue = active.filter((item) => /^\d{4}-\d{2}-\d{2}$/u.test(item.echeance || "") && item.echeance < todayIso).length;
    const upcoming = active.filter((item) => /^\d{4}-\d{2}-\d{2}$/u.test(item.echeance || "") && item.echeance >= todayIso && item.echeance <= upcomingIso).length;
    const nearest = active.map((item) => item.echeance).filter((d) => /^\d{4}-\d{2}-\d{2}$/u.test(d || "")).sort()[0] || null;
    return { ...project, pending, activeCount: active.length, overdue, upcoming, nearest };
  }).sort((a, b) =>
    b.overdue - a.overdue ||
    b.pending - a.pending ||
    b.activeCount - a.activeCount ||
    (a.nearest || "9999-12-31").localeCompare(b.nearest || "9999-12-31") ||
    a.name.localeCompare(b.name, "fr")
  );
}
