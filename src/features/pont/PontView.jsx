import { useEffect, useState } from "react";
import { Bell, Compass } from "lucide-react";
import { loadKnowledge } from "../../lib/local-api.js";
import { rankProjects } from "../projects/project-ranking.js";

function IslandVisual({ kind }) {
  return (
    <span className={`island-art kind-${kind}`}>
      <span className="terrain" />
      <span className="feature feature-a" />
      <span className="feature feature-b" />
      <span className="feature feature-c" />
    </span>
  );
}

function SeaMap({ projects, onOpenProject }) {
  return (
    <section className="sea-map">
      <svg className="route-layer" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
        <path d="M175 205 C285 120 410 155 510 170 S735 200 815 305" />
        <path d="M175 205 C205 325 280 430 525 445 S740 425 815 305" />
        <path d="M510 170 C470 270 485 360 525 445" />
        <circle cx="175" cy="205" r="6" />
        <circle cx="510" cy="170" r="6" />
        <circle cx="815" cy="305" r="6" />
        <circle cx="525" cy="445" r="6" />
      </svg>
      <div className="compass-watermark"><Compass size={74} /></div>
      {!projects.length ? <div className="map-empty">Aucune île enregistrée dans la mémoire locale.</div> : null}
      {projects.map((project) => (
        <button className="island-node" key={project.slug} style={{ left: `${project.x}%`, top: `${project.y}%` }} onClick={() => onOpenProject(project)}>
          <IslandVisual kind={project.kind} />
          <span className="island-card">
            <strong>{project.name}</strong>
            <span>{project.detail}</span>
            <em className={project.tone}>{project.status}</em>
          </span>
        </button>
      ))}
    </section>
  );
}

function PriorityBoard({ projects, actions, loading, error, onOpenProject }) {
  // Classement transparent des projets à partir des actions reconnues.
  const priorities = rankProjects(projects, actions);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("all");
  const alerts = priorities.filter((project) => project.overdue > 0 || project.pending > 0 || project.upcoming > 0);
  const displayed = priorities.filter((project) => filter === "all" || (filter === "alerts" && (project.overdue > 0 || project.pending > 0 || project.upcoming > 0)));

  return (
    <section className="priorities-board" aria-label="Classement des îles">
      <div className="priorities-heading">
        <strong>Vue d’ensemble · Classement des îles</strong>
        <span>Actions en retard, validations attendues, actions ouvertes, puis échéance</span>
      </div>
      {loading ? <p className="data-state">Chargement des priorités…</p> : null}
      {error ? <p className="data-state error">{error}</p> : null}
      {!loading && !error && alerts.length ? <div className="pont-alerts" role="status"><Bell size={17} /><div><strong>{alerts.length} île{alerts.length > 1 ? "s" : ""} à surveiller</strong><div className="pont-alert-links">{alerts.map((project) => <button key={project.slug} type="button" onClick={() => onOpenProject(project)}>{project.name} · {project.overdue ? `${project.overdue} en retard` : project.upcoming ? `${project.upcoming} échéance(s) proche(s)` : `${project.pending} à valider`}</button>)}</div></div></div> : null}
      {!loading && !error ? <div className="priorities-grid">
        {priorities.slice(0, 3).map((project, index) => (
          <article className={`priority-card ${project.tone}`} key={project.slug}>
            <span className="priority-rank">{index + 1}</span>
            <div>
              <small>{project.overdue} en retard · {project.upcoming} à échéance proche · {project.pending} à valider · {project.activeCount} ouvertes</small>
              <strong>{project.name}</strong>
              <p>{project.nearest ? `Prochaine échéance : ${project.nearest}` : project.next}</p>
              <button type="button" onClick={() => onOpenProject(project)}>Ouvrir cette île →</button>
            </div>
          </article>
        ))}
        {!priorities.length ? <p className="data-state">Aucune île enregistrée pour le moment.</p> : null}
      </div> : null}
      {!loading && !error ? <div className="pont-island-list">
        <div className="pont-island-list-heading"><strong>Répertoire des îles</strong><button type="button" onClick={() => setShowAll((previous) => !previous)} aria-expanded={showAll}>{showAll ? "Masquer la liste" : `Voir les ${priorities.length} îles`}</button></div>
        {showAll ? <>
          <label>Afficher <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Toutes les îles</option><option value="alerts">Îles avec alertes</option></select></label>
          <ul className="pont-island-directory">{displayed.map((project) => <li key={project.slug}><button type="button" onClick={() => onOpenProject(project)}><span>{priorities.indexOf(project) + 1}. {project.name}</span><small>{project.overdue ? `${project.overdue} en retard · ` : ""}{project.pending ? `${project.pending} à valider · ` : ""}{project.upcoming ? `${project.upcoming} bientôt · ` : ""}{project.activeCount} actions ouvertes</small></button></li>)}</ul>
          {!displayed.length ? <p>Aucune île avec alerte.</p> : null}
        </> : null}
      </div> : null}
    </section>
  );
}

export default function PontView({ projects, onOpenProject }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadKnowledge("action").then(({ items }) => { if (active) setActions(items); })
      .catch((problem) => { if (active) setError(problem.message || "Actions indisponibles."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return (
    <section className="pont-view">
      <PriorityBoard projects={projects} actions={actions} loading={loading} error={error} onOpenProject={onOpenProject} />
      <SeaMap projects={projects} onOpenProject={onOpenProject} />
    </section>
  );
}

