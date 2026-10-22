// File audio locale persistante : les tranches restent dans IndexedDB
// tant que le serveur n'a pas accusé réception. Aucun contenu dans Git.
const DB_NAME = "vogue-mary-audio-queue";
const STORE = "chunks";
const DB_VERSION = 1;

function openAudioDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("La sauvegarde audio locale n'est pas disponible dans ce navigateur."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("session", "sessionId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("La base audio est bloquée par un autre onglet."));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction audio interrompue."));
  });
}

function chunkKey(sessionId, index) {
  if (!sessionId || !Number.isSafeInteger(index) || index < 0) {
    throw new Error("Identifiant de réunion ou indice de bloc invalide.");
  }
  return `${sessionId}:${String(index).padStart(9, "0")}`;
}

export async function keepAudioChunk(sessionId, index, blob) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Bloc audio vide.");
  const id = chunkKey(sessionId, index);
  const db = await openAudioDatabase();
  try {
    const tx = db.transaction(STORE, "readwrite");
    // Un ajout atomique : IndexedDB refuse lui-même une clé déjà présente.
    // Ne pas attendre une lecture avant l'écriture : la transaction pourrait
    // devenir inactive entre les deux opérations.
    tx.objectStore(STORE).add({ id, sessionId, index, blob, savedAt: new Date().toISOString() });
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
