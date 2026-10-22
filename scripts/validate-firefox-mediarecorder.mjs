import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { firefox } from "playwright";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const browser = await firefox.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    oscillator.connect(destination);
    oscillator.start();

    const recorder = new MediaRecorder(destination.stream);
    const chunks = [];
    const eventTimes = [];
    const startedAt = context.currentTime;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) {
        chunks.push(event.data);
        eventTimes.push(context.currentTime - startedAt);
      }
    });

    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    recorder.start(5000);
    await new Promise((resolve) => setTimeout(resolve, 16200));
    recorder.stop();
    await stopped;
    oscillator.stop();

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
      mimeType: recorder.mimeType,
      supportedWebmOpus: MediaRecorder.isTypeSupported("audio/webm;codecs=opus"),
      duration: context.currentTime - startedAt,
      sizes: chunks.map((chunk) => chunk.size),
      eventTimes,
      chunks: encoded
    };
  });

  console.log(JSON.stringify({
    mimeType: result.mimeType,
    supportedWebmOpus: result.supportedWebmOpus,
    duration: result.duration,
    sizes: result.sizes,
    eventTimes: result.eventTimes
  }, null, 2));

  if (result.chunks.length < 3) fail("Firefox n'a pas produit assez de fragments.");
  const bytes = Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk, "base64")));
  const output = "/tmp/vogue-firefox-mediarecorder.bin";
  fs.writeFileSync(output, bytes);

  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=format_name,duration",
    "-of", "json",
    output
  ], { encoding: "utf8" });
  if (probe.status !== 0) fail("ffprobe a refusé le flux Firefox : " + probe.stderr);

  const parsed = JSON.parse(probe.stdout);
  const measured = Number(parsed.format?.duration || 0);
  console.log(JSON.stringify({ ffprobe: parsed.format }, null, 2));
  if (!(measured > 14 && measured < 19)) fail("Durée Firefox assemblée inattendue : " + measured);

  const decode = spawnSync("ffmpeg", ["-v", "error", "-i", output, "-f", "null", "-"], { encoding: "utf8" });
  if (decode.status !== 0) fail("ffmpeg n'a pas décodé le flux Firefox : " + decode.stderr);
  if (/premature|invalid|corrupt|error/i.test(decode.stderr || "")) {
    fail("ffmpeg signale une anomalie Firefox : " + decode.stderr);
  }
} finally {
  await browser.close();
}
