import { useState } from "react";
import { readMemorySource, searchMemory } from "../../lib/local-api.js";

export default function SearchView({ projects = [] }) {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [results, setResults] = useState([]);
  const [source, setSource] = useState(null);
  const [sourceBusy, setSourceBusy] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const value = query.trim();
    setSource(null);
    setSourceError("");
    if (!value) {
      setResults([]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setResults(await searchMemory(value, projectFilter));
    } catch (requestError) {
      setError(requestError.message || "Recherche indisponible.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReadSource(result) {
    const key = `${result.projectSlug}/${result.relativePath}`;
    if (source?.relativePath === result.relativePath) {
      setSource(null);
      return;
    }
    setSourceBusy(key);
    setSourceError("");
    try {
      setSource(await readMemorySource(result.relativePath, result.projectSlug));
    } catch (requestError) {
      setSourceError(requestError.message || "Impossible de lire cette source.");
    } finally {
      setSourceBusy("");
    }
  }

  return (
    <section className="generic-view search-view">
      <div className="data-toolbar">
        <div>
          <p className="data-kicker">Longue-vue</p>
          <h3>Rechercher dans la mémoire</h3>
          <p>La recherche parcourt les journaux, sources et notes enregistrés localement.</p>
        </div>
      </div>
      <form className="search-form" onSubmit={handleSubmit}>
        <label htmlFor="memory-search">Mot ou expression</label>
        <div>
          <input id="memory-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. décision, réunion, personne…" />
          <select aria-label="Filtrer par île" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="">Toutes les îles</option>
            {projects.map((project) => <option key={project.slug} value={project.slug}>{project.name}</option>)}
          </select>
          <button type="submit" disabled={busy}>{busy ? "Recherche…" : "Chercher"}</button>
        </div>
      </form>
      {error ? <p className="data-state error">{error}</p> : null}
      {!busy && !error && query.trim() && !results.length ? <p className="data-state">Aucun résultat pour cette recherche.</p> : null}
      <div className="search-results">
        {results.map((result) => (
          <article className="generic-card search-result" key={`${result.projectSlug}/${result.relativePath}`}>
            <small>{result.projectSlug || "Mémoire générale"}</small>
            <h3>{result.fileName}</h3>
            <p>{result.snippet}</p>
            <span>{result.relativePath}</span>
            <button type="button" className="search-read-button" onClick={() => handleReadSource(result)} disabled={sourceBusy === `${result.projectSlug}/${result.relativePath}`}>
              {sourceBusy === `${result.projectSlug}/${result.relativePath}` ? "Lecture…" : source?.relativePath === result.relativePath ? "Masquer la source" : "Lire la source"}
            </button>
            {source?.relativePath === result.relativePath ? (
              <div className="search-source">
                <small>{source.fileName}{source.truncated ? " · extrait limité" : ""}</small>
                <pre>{source.content}</pre>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {sourceError ? <p className="data-state error">{sourceError}</p> : null}
    </section>
  );
}
