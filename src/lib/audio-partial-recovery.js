// Export de secours non destructif après fermeture brutale du navigateur.
// Un conteneur MediaRecorder incomplet peut être illisible : conserver tous les blocs.
export function preparePartialAudioExport(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("Aucun fragment audio local disponible.");
  }
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].index !== i || !(sorted[i].blob instanceof Blob) || sorted[i].blob.size === 0) {
      throw new Error("Fragments incomplets ou invalides : export combiné refusé. Les données locales restent intactes.");
    }
  }
  const type = sorted[0].blob.type || "application/octet-stream";
  if (sorted.some((chunk) => chunk.blob.type !== sorted[0].blob.type)) {
    throw new Error("Formats de fragments différents : export combiné refusé.");
  }
  const extension = type.startsWith("audio/ogg") ? "ogg" : type.startsWith("audio/webm") ? "webm" : "bin";
  return { blob: new Blob(sorted.map((chunk) => chunk.blob), { type }), extension, count: sorted.length };
}
