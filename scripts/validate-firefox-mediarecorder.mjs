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
  await context.grantPermissions(["microphone"], { origin });
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
    if (result.chunks.length < 3) fail(name + " : pas assez de fragments.");
    if (!(media.measured > 10 && media.measured < 15)) {
      fail(name + " : durée assemblée inattendue " + media.measured);
    }
    if (/premature|invalid|corrupt|error/i.test(media.decodeStderr)) {
      fail(name + " : anomalie de décodage " + media.decodeStderr);
    }
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
