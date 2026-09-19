import { useCallback, useEffect, useState } from "react";
import { loadKnowledge, validateKnowledge } from "../../lib/local-api.js";

const VIEW_CONFIG = {
  action: {
    title: "Manœuvres",
    kicker: "Actions à mener",
    description: "Les propositions viennent uniquement des journaux de bord validés. Vérifiez chaque action avant de la conserver.",
    emptyTitle: "Aucune manœuvre validée",
    emptyText: "Les actions apparaîtront ici après validation d’un journal de bord.",
    textLabel: "Action à mener"
  },
  decision: {
    title: "Caps validés",
    kicker: "Décisions actées",
    description: "Les propositions viennent uniquement des journaux de bord validés. Une décision n’entre ici qu’après votre validation.",
    emptyTitle: "Aucun cap validé",
    emptyText: "Les décisions apparaîtront ici après validation d’un journal de bord.",
    textLabel: "Décision"
  },
  need: {
    title: "Besoins",
    kicker: "Construction",
    description: "Les besoins repérés en réunion restent à préciser et à valider avant d’orienter la construction.",
    emptyTitle: "Aucun besoin identifié",
    emptyText: "Les besoins apparaîtront ici après validation d’un journal de bord ou d’un marqueur d’escale.",
    textLabel: "Besoin utilisateur"
  }
};

function formatDate(value) {
  if (!value) return "Date à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function draftFromItem(item, kind) {
  return kind === "action"
    ? {
      action: item.action || "",
      responsable: item.responsable || "",
      echeance: item.echeance || "",
      statut: item.statut || "À préciser",
      decisionId: item.decisionId || "",
      documentId: item.documentId || ""
    }
    : kind === "decision"
      ? {
      decision: item.decision || "",
      date: item.date || "",
      statut: item.statut || "À préciser",
      impact: item.impact || ""
    }
      : {
        need: item.need || "",
        context: item.context || "",
        priority: item.priority || "À préciser",
        statut: item.statut || "À préciser"
      };
}

function KnowledgeCard({ item, kind, onValidate, busy }) {
  const config = VIEW_CONFIG[kind];
  const [draft, setDraft] = useState(() => draftFromItem(item, kind));
  const pending = item.reviewStatus === "à valider";

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <article className={`generic-card knowledge-card${pending ? " knowledge-card-pending" : ""}`}>
      <div className="knowledge-card-heading">
        <div>
          <small>{item.projectName || "Île non renseignée"}</small>
          <h3>{pending ? config.textLabel : (kind === "action" ? item.action : kind === "decision" ? item.decision : item.need)}</h3>
        </div>
        <span className={`knowledge-status${pending ? " pending" : ""}`}>{pending ? "À valider" : "Validé"}</span>
      </div>

      <p className="knowledge-meta">{formatDate(item.date)} · {item.source}</p>
      {item.origin === "marqueur" ? <p className="knowledge-warning">Repère posé pendant l’escale : précision nécessaire.</p> : null}

      {pending ? (
        <div className="knowledge-edit-form">
          <label>
            {config.textLabel}
            <textarea value={draft[kind === "action" ? "action" : "decision"]} onChange={(event) => updateField(kind === "action" ? "action" : "decision", event.target.value)} rows={3} />
          </label>
          {kind === "action" ? (
            <div className="knowledge-edit-grid">
              <label>Responsable<input value={draft.responsable} onChange={(event) => updateField("responsable", event.target.value)} placeholder="À préciser" /></label>
              <label>Échéance<input value={draft.echeance} onChange={(event) => updateField("echeance", event.target.value)} placeholder="À préciser" /></label>
              <label>Statut<input value={draft.statut} onChange={(event) => updateField("statut", event.target.value)} /></label>
              <label>Décision liée<input value={draft.decisionId} onChange={(event) => updateField("decisionId", event.target.value)} placeholder="Facultatif" /></label>
              <label>Document lié<input value={draft.documentId} onChange={(event) => updateField("documentId", event.target.value)} placeholder="Facultatif" /></label>
            </div>
          ) : kind === "decision" ? (
            <div className="knowledge-edit-grid">
              <label>Date<input value={draft.date} onChange={(event) => updateField("date", event.target.value)} /></label>
              <label>Statut<input value={draft.statut} onChange={(event) => updateField("statut", event.target.value)} /></label>
              <label className="knowledge-wide-field">Impact / conséquence<textarea value={draft.impact} onChange={(event) => updateField("impact", event.target.value)} rows={2} placeholder="À préciser" /></label>
            </div>
          ) : (
            <div className="knowledge-edit-grid">
              <label className="knowledge-wide-field">Contexte / preuve<textarea value={draft.context} onChange={(event) => updateField("context", event.target.value)} rows={2} placeholder="Qui l’a exprimé, dans quel contexte, avec quelle preuve ?" /></label>
              <label>Priorité<input value={draft.priority} onChange={(event) => updateField("priority", event.target.value)} placeholder="À préciser" /></label>
              <label>Statut<input value={draft.statut} onChange={(event) => updateField("statut", event.target.value)} /></label>
            </div>
          )}
          <button type="button" className="knowledge-validate-button" onClick={() => onValidate(item, draft)} disabled={busy || !draft[kind === "action" ? "action" : kind === "decision" ? "decision" : "need"].trim()}>
            {busy ? "Validation…" : `Valider ce${kind === "action" ? "tte action" : kind === "decision" ? "tte décision" : " besoin"}`}
          </button>
        </div>
      ) : (
        <div className="knowledge-details">
          {kind === "action" ? (
            <>
              <div><strong>Responsable</strong><span>{item.responsable || "À préciser"}</span></div>
              <div><strong>Échéance</strong><span>{item.echeance || "À préciser"}</span></div>
              <div><strong>Statut</strong><span>{item.statut || "À préciser"}</span></div>
            </>
          ) : kind === "decision" ? (
            <>
              <div><strong>Impact</strong><span>{item.impact || "À préciser"}</span></div>
              <div><strong>Statut</strong><span>{item.statut || "À préciser"}</span></div>
            </>
          ) : (
            <>
              <div><strong>Contexte / preuve</strong><span>{item.context || "À préciser"}</span></div>
              <div><strong>Priorité</strong><span>{item.priority || "À préciser"}</span></div>
              <div><strong>Statut</strong><span>{item.statut || "À préciser"}</span></div>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export default function KnowledgeView({ kind, projects = [] }) {
  const config = VIEW_CONFIG[kind];
  const [items, setItems] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [projectFilter, setProjectFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await loadKnowledge(kind, projectFilter);
      setItems(payload.items);
      setPendingCount(payload.pendingCount);
    } catch (requestError) {
      setError(requestError.message || "La mémoire locale est indisponible.");
    } finally {
      setLoading(false);
    }
  }, [kind, projectFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleValidate(item, draft) {
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      await validateKnowledge(kind, {
        itemId: item.id,
        projectSlug: item.projectSlug,
        item: draft
      });
      const label = kind === "action" ? "Action" : kind === "decision" ? "Décision" : "Besoin";
      setNotice(`${label} validé${kind === "action" || kind === "decision" ? "e" : ""} dans ${item.projectName}.`);
      await refresh();
    } catch (requestError) {
      setError(requestError.message || "Impossible de valider cet élément.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="generic-view knowledge-view">
      <div className="data-toolbar">
        <div>
          <p className="data-kicker">{config.kicker}</p>
          <h3>{config.title}</h3>
          <p>{config.description}</p>
        </div>
        <span className="data-count">{pendingCount ? `${pendingCount} à valider` : items.length}</span>
      </div>

      <div className="knowledge-toolbar">
        <label>
          Filtrer par île
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} disabled={Boolean(busy)}>
            <option value="">Toutes les îles</option>
            {projects.map((project) => <option value={project.slug} key={project.slug}>{project.name}</option>)}
          </select>
        </label>
      </div>

      {notice ? <p className="meeting-notice">{notice}</p> : null}
      {error ? <p className="data-state error">{error}</p> : null}
      {loading ? <p className="data-state">Lecture des journaux validés…</p> : null}
      {!loading && !error && !items.length ? (
        <div className="data-empty">
          <h3>{config.emptyTitle}</h3>
          <p>{config.emptyText}</p>
        </div>
      ) : null}
      <div className="knowledge-list">
        {items.map((item) => (
          <KnowledgeCard key={item.id} item={item} kind={kind} onValidate={handleValidate} busy={busy === item.id} />
        ))}
      </div>
    </section>
  );
}
