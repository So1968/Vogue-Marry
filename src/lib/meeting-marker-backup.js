// Marques conservées localement jusqu'à confirmation serveur.
// Une clef par session évite les collisions entre escales.
const PREFIX = "vogue-mary-markers:";

function key(sessionId) {
  if (!sessionId || typeof sessionId !== "string") throw new Error("Session absente.");
  return PREFIX + sessionId;
}

export function recoverLocalMarkers(sessionId) {
  const raw = localStorage.getItem(key(sessionId));
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Marqueurs locaux illisibles.");
  return parsed;
}

export function keepLocalMarkers(sessionId, markers) {
  if (!Array.isArray(markers)) throw new Error("Marqueurs invalides.");
  // L'écriture est synchrone pour limiter la fenêtre de perte avant requête réseau.
  localStorage.setItem(key(sessionId), JSON.stringify(markers));
}

export function clearLocalMarkers(sessionId) {
  localStorage.removeItem(key(sessionId));
}
