// File audio locale persistante : les tranches restent dans IndexedDB
// tant que le serveur n'a pas accusé réception. Aucun contenu dans Git.
const DB_NAME = "vogue-mary-audio-queue";
const STORE = "chunks";
const DB_VERSION = 2;
const SESSION_OBJECT_STORE = "sessions";

function openAudioDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("La sauvegarde audio locale n'est pas disponible dans ce navigateur."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_OBJECT_STORE)) {
        db.createObjectStore(SESSION_OBJECT_STORE, { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("session", "sessionId", { unique: false });
      }
    };
    let blocked = false;
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("La base audio est bloquée par un autre onglet."));
    };
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // tx.error peut encore être nul pendant la propagation de l’erreur d’une
    // requête ; attendre l’abandon effectif et son erreur définitive.
    tx.onerror = () => {};
    tx.onabort = () => reject(tx.error || new Error("Transaction audio interrompue."));
  });
}

function chunkKey(sessionId, index) {
  if (!sessionId || !Number.isSafeInteger(index) || index < 0) {
    throw new Error("Identifiant de réunion ou indice de bloc invalide.");
  }
  return `${sessionId}:${String(index).padStart(9, "0")}`;
}

export async function keepAudioChunk(sessionId, index, blob, session = null) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Bloc audio vide.");
  const id = chunkKey(sessionId, index);
  const db = await openAudioDatabase();
  try {
    const tx = db.transaction(session ? [STORE, SESSION_OBJECT_STORE] : STORE, "readwrite");
    // Un ajout atomique : IndexedDB refuse lui-même une clé déjà présente.
    // Ne pas attendre une lecture avant l'écriture : la transaction pourrait
    // devenir inactive entre les deux opérations.
    tx.objectStore(STORE).add({ id, sessionId, index, blob, savedAt: new Date().toISOString() });
    if (session) tx.objectStore(SESSION_OBJECT_STORE).put({ ...session, updatedAt: Date.now() });
    await transactionDone(tx);
    return id;
  } finally {
    db.close();
  }
}

// Lecture ciblée : ne pas conserver les Blob en RAM dans la file réseau.
export async function getAudioChunk(sessionId, index) {
  const db = await openAudioDatabase();
  try {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(chunkKey(sessionId, index));
    const result = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(tx);
    return result;
  } finally {
    db.close();
  }
}

export async function pendingAudioChunks(sessionId) {
  if (!sessionId) throw new Error("Réunion manquante.");
  const db = await openAudioDatabase();
  try {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).index("session").getAll(sessionId);
    const result = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(tx);
    return result.sort((a, b) => a.index - b.index);
  } finally {
    db.close();
  }
}

// Effacer seulement après finalisation confirmée par le serveur.
export async function acknowledgeAudioChunk(sessionId, index) {
  const db = await openAudioDatabase();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(chunkKey(sessionId, index));
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function clearFinalizedAudioChunks(sessionId) {
  const chunks = await pendingAudioChunks(sessionId);
  for (const chunk of chunks) await acknowledgeAudioChunk(sessionId, chunk.index);
}

const SESSION_STORE = "vogue-mary-audio-active-session";
export function rememberAudioSession(session) {
  localStorage.setItem(SESSION_STORE, JSON.stringify(session));
}
export function recoverAudioSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORE) || "null");
  } catch {
    return null;
  }
}
export function forgetAudioSession(sessionId = "") {
  if (!sessionId) {
    localStorage.removeItem(SESSION_STORE);
    return;
  }
  const active = recoverAudioSession();
  if (active?.sessionId === sessionId) localStorage.removeItem(SESSION_STORE);
}


function mirrorAudioSession(session) {
  try { rememberAudioSession(session); } catch { /* IndexedDB reste la source durable. */ }
}

export async function rememberDurableAudioSession(session) {
  const db = await openAudioDatabase();
  try {
    const tx = db.transaction(SESSION_OBJECT_STORE, "readwrite");
    tx.objectStore(SESSION_OBJECT_STORE).put({ ...session, updatedAt: Date.now() });
    await transactionDone(tx);
  } finally { db.close(); }
  mirrorAudioSession(session);
}

export async function keepCapturedAudioChunk(session, index, blob) {
  const snapshot = { ...session, count: index + 1, finalizedCapture: false };
  // Compteur et fragment sont validés dans la même transaction. Aucun compteur
  // durable ne doit annoncer un fragment qui n'a pas encore été enregistré.
  await keepAudioChunk(session.sessionId, index, blob, snapshot);
  mirrorAudioSession(snapshot);
}

export async function recoverDurableAudioSession() {
  const db = await openAudioDatabase();
  let sessions;
  try {
    const tx = db.transaction(SESSION_OBJECT_STORE, "readonly");
    const request = tx.objectStore(SESSION_OBJECT_STORE).getAll();
    const completed = transactionDone(tx);
    const result = new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    [sessions] = await Promise.all([result, completed]);
  } finally { db.close(); }
  const legacy = recoverAudioSession();
  const active = sessions.filter((session) => !session.completed)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  if (legacy?.sessionId) {
    const existing = sessions.find((session) => session.sessionId === legacy.sessionId);
    if (existing && !existing.completed) return existing;
    if (!existing) return legacy; // Compatibilité des sessions créées avec la base v1.
  }
  return active[0] || null;
}

export async function forgetDurableAudioSession(sessionId) {
  if (!sessionId) throw new Error("Réunion manquante.");
  const db = await openAudioDatabase();
  try {
    const tx = db.transaction(SESSION_OBJECT_STORE, "readwrite");
    // Reçu minimal : empêche un ancien miroir localStorage non effaçable de
    // réactiver une session dont les fragments ont été finalisés et nettoyés.
    tx.objectStore(SESSION_OBJECT_STORE).put({ sessionId, completed: true, updatedAt: Date.now() });
    await transactionDone(tx);
  } finally { db.close(); }
  try { forgetAudioSession(sessionId); } catch { /* Le reçu IndexedDB fait foi. */ }
}
