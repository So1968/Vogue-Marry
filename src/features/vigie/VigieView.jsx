import { useEffect, useState } from "react";
import { loadKnowledge } from "../../lib/local-api.js";
import { rankProjects } from "../projects/project-ranking.js";

export default function VigieView({ projects, onOpenProject }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    loadKnowledge("action").then(({ items }) => { if (current) setActions(items); })
      .catch((cause) => { if (current) setError(cause.message || "La Vigie est indisponible."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);
  const today = new Date();
  const alerts = rankProjects(projects, actions, today).filter((p) => p.overdue || p.upcoming || p.pending);
  return (
    <section className="generic-view vigie-view">
      <div className="data-toolbar"><div><p className="data-kicker">La Vigie</p><h3>Îles à surveiller</h3><p>Retards, échéances dans les deux jours et validations en attente, même hors des trois priorités.</p></div></div>
      {loading ? <p className="data-state">Lecture des alertes…</p> : null}
      {error ? <p className="data-state error">{error}</p> : null}
      {!loading && !error && !alerts.length ? <p className="data-state">Aucune alerte connue pour le moment.</p> : null}
      {!loading && !error ? <div className="vigie-list">{alerts.map((p) => (
        <article className="generic-card" key={p.slug}>
          <h3>{p.name}</h3>
          <p>{p.overdue ? `${p.overdue} action(s) en retard · ` : ""}{p.upcoming ? `${p.upcoming} échéance(s) proche(s) · ` : ""}{p.pending ? `${p.pending} à valider` : ""}</p>
          <button type="button" onClick={() => onOpenProject(p)}>Rejoindre cette île →</button>
        </article>
      ))}</div> : null}
    </section>
  );
}

