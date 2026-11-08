export function isSupportedNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(String(version));
  if (!match) return false;
  const major = Number(match[1]);
  return major > 22 || (major === 22 && Number(match[2]) >= 12);
}

export function localReadinessSummary(report) {
  const python = report.pythonDependencies;
  const prerequisitesOk = Boolean(report.supportedNode && report.ffmpeg && report.ffprobe &&
    python?.state === "checked" && python.pythonAvailable && python.supportedVersion && python.fasterWhisper && python.av);
  const servicesOk = report.api?.healthy === true && report.transcription?.healthy === true;
  return { prerequisitesOk, servicesOk, readyForLocalAttempt: prerequisitesOk && servicesOk,
    modelsTested: false, microphoneTested: false };
}

// Ne jamais considérer une réponse HTTP 403/503 ou un service étranger comme sain.
// Ne recopier aucun contenu arbitraire de la réponse dans le diagnostic.
export async function probeLocalService(url, expectedService, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    const result = await response.json().catch(() => null);
    return {
      reachable: true,
      status: response.status,
      healthy: response.ok && result?.status === "ok" && result?.service === expectedService
    };
  } catch { return { reachable: false, healthy: false }; }
}
