import { spawn } from "node:child_process";

// Le code de sortie seul ne prouve pas que le moteur a fini son flux JSONL.
export function runJsonLines(command, args, onEvent, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let buffer = "", stderr = "";
    let failure, termination;
    let done = false, segments = 0;

    function fail(error) {
      if (failure) return;
      failure = error;
      child.kill("SIGTERM");
      termination = setTimeout(() => child.kill("SIGKILL"), 1000);
      termination.unref();
    }
    function handleLine(line) {
      if (!line.trim() || failure) return;
      let event;
      try { event = JSON.parse(line); }
      catch { fail(new Error("Réponse JSON invalide du moteur local.")); return; }
      if (!event || typeof event !== "object" || typeof event.type !== "string") {
        fail(new Error("Événement du moteur local invalide.")); return;
      }
      if (done) { fail(new Error("Événement reçu après la fin du moteur local.")); return; }
      if (event.type === "error") { fail(new Error(event.message || "Erreur du moteur local.")); return; }
      if (event.type === "segment" || event.type === "speaker_segment") segments++;
      if (event.type === "done") {
        if (!Number.isSafeInteger(event.segments) || event.segments < 0 || event.segments !== segments) {
          fail(new Error("Nombre de segments incohérent à la fin du moteur local.")); return;
        }
        done = true;
      }
      // Les erreurs de persistance/progression doivent remonter à la tâche.
      try { onEvent(event); } catch (error) { fail(error); }
    }
    child.stdout.on("data", (data) => {
      if (failure) return;
      buffer += data;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (Buffer.byteLength(line) > 1024 * 1024) { fail(new Error("Événement du moteur local trop volumineux.")); break; }
        handleLine(line);
      }
      if (Buffer.byteLength(buffer) > 1024 * 1024) fail(new Error("Événement du moteur local trop volumineux."));
    });
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-8192); });
    child.on("error", (error) => { failure ||= error; });
    child.on("close", (code, signal) => {
      if (buffer.trim()) handleLine(buffer);
      clearTimeout(termination);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(stderr.trim().slice(-1800) || `Le moteur local s'est arrêté (${signal || code}).`));
      else if (!done) reject(new Error("Transcription interrompue : événement de fin du moteur local absent."));
      else resolve({ stderr });
    });
  });
}
