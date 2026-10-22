import fs from "node:fs";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { firefox } from "playwright";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function probeFile(filePath) {
  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=format_name,duration",
    "-of", "json",
    filePath
  ], { encoding: "utf8" });
  if (probe.error) fail("ffprobe indisponible : " + probe.error.message);
  if (probe.status !== 0) fail("ffprobe a refusé " + filePath + " : " + probe.stderr);
  const parsed = JSON.parse(probe.stdout);
  const measured = Number(parsed.format?.duration || 0);
  const decode = spawnSync("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", "-"], { encoding: "utf8" });
  if (decode.error) fail("ffmpeg indisponible : " + decode.error.message);
  if (decode.status !== 0) fail("ffmpeg n'a pas décodé " + filePath + " : " + decode.stderr);
  return { ...parsed.format, measured, decodeStderr: decode.stderr || "" };
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><html><body>Vogue Mary Firefox MediaRecorder</body></html>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

const browser = await firefox.launch({
  headless: true,
  firefoxUserPrefs: {
    "media.navigator.streams.fake": true,
    "media.navigator.permission.disabled": true
  }
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);

  async function capture(explicitWebm) {
    return page.evaluate(async ({ explicitWebm }) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const webm = "audio/webm;codecs=opus";
      const options = explicitWebm && MediaRecorder.isTypeSupported(webm) ? { mimeType: webm } : undefined;
      const recorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      const chunks = [];
      const eventTimes = [];
      const startedAt = performance.now();
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          eventTimes.push((performance.now() - startedAt) / 1000);
        }
      });
      const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
      recorder.start(5000);
      await new Promise((resolve) => setTimeout(resolve, 12200));
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());

      const encoded = [];
      for (const chunk of chunks) {
        const bytes = new Uint8Array(await chunk.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        encoded.push(btoa(binary));
      }
      return {
        recorderMimeType: recorder.mimeType,
        supportedWebmOpus: MediaRecorder.isTypeSupported(webm),
        wallDuration: (performance.now() - startedAt) / 1000,
        sizes: chunks.map((chunk) => chunk.size),
        types: chunks.map((chunk) => chunk.type),
        eventTimes,
        chunks: encoded
      };
    }, { explicitWebm });
  }

  const results = {};
  for (const [name, explicit] of [["default", false], ["explicit-webm", true]]) {
    const result = await capture(explicit);
    const filePath = `/tmp/vogue-firefox-${name}.bin`;
    fs.writeFileSync(filePath, Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk, "base64"))));
    const media = probeFile(filePath);
    results[name] = {
      recorderMimeType: result.recorderMimeType,
      supportedWebmOpus: result.supportedWebmOpus,
      wallDuration: result.wallDuration,
      sizes: result.sizes,
      types: result.types,
      eventTimes: result.eventTimes,
      media
    };
    console.log("RESULTAT_" + name.toUpperCase().replace("-", "_"), JSON.stringify(results[name], null, 2));
    if (result.chunks.length < 3) fail(name + " : pas assez de fragments.");
    if (name === "default") {
      if (!(media.measured > 10 && media.measured < 15)) {
        fail(name + " : durée assemblée inattendue " + media.measured);
      }
      if (/premature|invalid|corrupt|error/i.test(media.decodeStderr)) {
        fail(name + " : anomalie de décodage " + media.decodeStderr);
      }
    }
  }

  // Simule la fermeture d'un onglet pendant l'enregistrement : seuls les
  // blocs déjà persistés doivent survivre. Le bloc en cours est perdu.
  const crashPage = await context.newPage();
  await crashPage.goto(origin);
  const recorded = await crashPage.evaluate(async () => {
    const request = indexedDB.open("vogue-firefox-crash-test", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("chunks");
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    let written = 0;
    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data.size) return;
      const tx = db.transaction("chunks", "readwrite");
      tx.objectStore("chunks").put(event.data, written);
      tx.oncomplete = () => { written++; };
    });
    recorder.start(1000);
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const timer = setInterval(() => {
        if (written >= 3) {
          clearInterval(timer);
          resolve();
        } else if (performance.now() - started > 12000) {
          clearInterval(timer);
          reject(new Error("Aucun bloc persisté avant interruption"));
        }
      }, 100);
    });
    // Ne pas appeler recorder.stop() : la page va être fermée brutalement.
    return { persisted: written, mimeType: recorder.mimeType };
  });
  await crashPage.close();
  const recoveryPage = await context.newPage();
  await recoveryPage.goto(origin);
  const recovered = await recoveryPage.evaluate(async () => {
    const request = indexedDB.open("vogue-firefox-crash-test", 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("chunks", "readonly");
    const blobs = await new Promise((resolve, reject) => {
      const read = tx.objectStore("chunks").getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    db.close();
    const joined = new Blob(blobs, { type: blobs[0]?.type });
    const bytes = new Uint8Array(await joined.arrayBuffer());
    const encoded = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      encoded.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    }
    return { count: blobs.length, sizes: blobs.map((blob) => blob.size), base64: btoa(encoded.join("")) };
  });
  await recoveryPage.close();
  if (recovered.count < recorded.persisted || recovered.sizes.some((size) => size === 0)) {
    fail("Fermeture brutale : blocs IndexedDB perdus ou vides.");
  }
  const emergencyPath = "/tmp/vogue-firefox-crash-recovery.bin";
  fs.writeFileSync(emergencyPath, Buffer.from(recovered.base64, "base64"));
  const recoveredMedia = probeFile(emergencyPath);
  if (!(recoveredMedia.measured > 1)) fail("Fermeture brutale : aucun audio lisible récupéré.");
  console.log("RESULTAT_FERMETURE_BRUTALE", JSON.stringify({
    persistedBeforeClose: recorded.persisted,
    recoveredAfterReopen: recovered.count,
    recoveredSeconds: recoveredMedia.measured,
    mimeType: recorded.mimeType
  }));

  // Deux onglets ne peuvent pas détenir simultanément le verrou audio.
  const firstTab = await context.newPage();
  const secondTab = await context.newPage();
  await Promise.all([firstTab.goto(origin), secondTab.goto(origin)]);
  const lockSupported = await firstTab.evaluate(() => Boolean(navigator.locks?.request));
  if (!lockSupported) fail("Web Locks indisponible dans Firefox : protection inter-onglets impossible.");
  await firstTab.evaluate(() => {
    window.__heldAudioLock = new Promise((resolve) => { window.__releaseAudioLock = resolve; });
    navigator.locks.request("vogue-mary-audio-recording", async () => {
      window.__audioLockEntered = true;
      await window.__heldAudioLock;
    });
  });
  await firstTab.waitForFunction(() => window.__audioLockEntered === true);
  const secondGranted = await secondTab.evaluate(() =>
    navigator.locks.request("vogue-mary-audio-recording", { ifAvailable: true }, (lock) => Boolean(lock))
  );
  if (secondGranted) fail("Un second onglet a acquis le verrou pendant une capture active.");
  await firstTab.evaluate(() => window.__releaseAudioLock());
  await firstTab.close();
  const availableAfterRelease = await secondTab.evaluate(() =>
    navigator.locks.request("vogue-mary-audio-recording", { ifAvailable: true }, (lock) => Boolean(lock))
  );
  if (!availableAfterRelease) fail("Le verrou audio n'a pas été relâché après l'arrêt.");
  await secondTab.close();
  console.log("RESULTAT_VERROU_AUDIO", JSON.stringify({ secondGranted, availableAfterRelease }));

  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
