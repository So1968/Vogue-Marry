const API_BASE = (import.meta.env.VITE_VOGUE_MARRY_API || "http://127.0.0.1:8010").replace(/\/+$/u, "");

export async function localApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Erreur de l'API locale (${response.status}).`);
  return payload;
}

export async function loadProjects() {
  const payload = await localApi("/api/projects");
  return Array.isArray(payload.projects) ? payload.projects : [];
}

export function createProject({ name, description = "" }) {
  return localApi("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, description })
  });
}

export async function loadInbox() {
  const payload = await localApi("/api/inbox");
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function loadDocuments(projectSlug = "") {
  const params = projectSlug ? `?projectSlug=${encodeURIComponent(projectSlug)}` : "";
  const payload = await localApi(`/api/documents${params}`);
  return {
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    pendingCount: Number(payload.pendingCount || 0)
  };
}

export function depositDocument(file) {
  const form = new FormData();
  form.append("document", file, file.name);
  return localApi("/api/water-seven/deposit", { method: "POST", body: form });
}

export function validateDocument({ sourceId, projectSlug }) {
  return localApi("/api/documents/validate", {
    method: "POST",
    body: JSON.stringify({ sourceId, projectSlug })
  });
}

export async function loadKnowledge(kind, projectSlug = "") {
  const params = projectSlug ? `?projectSlug=${encodeURIComponent(projectSlug)}` : "";
  const payload = await localApi(`/api/knowledge/${kind}${params}`);
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    pendingCount: Number(payload.pendingCount || 0)
  };
}

export function validateKnowledge(kind, { itemId, projectSlug, item }) {
  return localApi(`/api/knowledge/${kind}/validate`, {
    method: "POST",
    body: JSON.stringify({ itemId, projectSlug, item })
  });
}

export async function loadLogPose(projectSlug = "") {
  const params = projectSlug ? `?projectSlug=${encodeURIComponent(projectSlug)}` : "";
  const payload = await localApi(`/api/log-pose${params}`);
  return payload.logPose || null;
}

export function saveLogPose({ projectSlug, whatToRemember, openQuestions, documentsToFind, nextDirection }) {
  return localApi("/api/log-pose/save", {
    method: "POST",
    body: JSON.stringify({ projectSlug, whatToRemember, openQuestions, documentsToFind, nextDirection })
  });
}

export async function searchMemory(query, projectSlug = "") {
  const params = new URLSearchParams({ q: query });
  if (projectSlug) params.set("projectSlug", projectSlug);
  const payload = await localApi(`/api/search?${params.toString()}`);
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function readMemorySource(relativePath, projectSlug = "") {
  const params = new URLSearchParams({ relativePath });
  if (projectSlug) params.set("projectSlug", projectSlug);
  const payload = await localApi(`/api/search/read?${params.toString()}`);
  return {
    fileName: payload.fileName || relativePath,
    relativePath: payload.relativePath || relativePath,
    truncated: Boolean(payload.truncated),
    content: payload.content || ""
  };
}

export function exportMeeting(data) {
  return localApi("/api/meetings/export", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function exportMeetingAudio({ projectName, meetingDirName, blob }) {
  const form = new FormData();
  form.append("projectName", projectName);
  form.append("meetingDirName", meetingDirName);
  form.append("audio", blob, "reunion.webm");
  return localApi("/api/meetings/export-audio", { method: "POST", body: form });
}

export function saveMeetingReport({ projectSlug, meetingDirName, content }) {
  return localApi("/api/meetings/save-report", {
    method: "POST",
    body: JSON.stringify({ projectSlug, meetingDirName, content })
  });
}

export function validateMeeting({ projectSlug, meetingDirName }) {
  return localApi("/api/meetings/validate", {
    method: "POST",
    body: JSON.stringify({ projectSlug, meetingDirName })
  });
}
