import test from "node:test";
import assert from "node:assert/strict";
import { preparePartialAudioExport } from "../src/lib/audio-partial-recovery.js";

test("secours audio : assemble dans l'ordre sans modifier les sources", async () => {
  const blocks = [
    { index: 1, blob: new Blob(["B"], { type: "audio/webm" }) },
    { index: 0, blob: new Blob(["A"], { type: "audio/webm" }) }
  ];
  const result = preparePartialAudioExport(blocks);
  assert.equal(await result.blob.text(), "AB");
  assert.equal(result.extension, "webm");
  assert.equal(result.count, 2);
  assert.equal(blocks[0].index, 1);
});

test("secours audio : signale les trous sans rien supprimer", () => {
  assert.throws(() => preparePartialAudioExport([
    { index: 0, blob: new Blob(["A"]) },
    { index: 2, blob: new Blob(["C"]) }
  ]), /Fragments incomplets/);
});

test("secours audio : refuse les blocs vides et les mélanges de formats", () => {
  assert.throws(() => preparePartialAudioExport([]), /Aucun fragment/);
  assert.throws(() => preparePartialAudioExport([{ index: 0, blob: new Blob([]) }]), /invalides/);
  assert.throws(() => preparePartialAudioExport([
    { index: 0, blob: new Blob(["A"], { type: "audio/ogg" }) },
    { index: 1, blob: new Blob(["B"], { type: "audio/webm" }) }
  ]), /Formats/);
});

test("secours audio : préserve le format Ogg Firefox", () => {
  const result = preparePartialAudioExport([{ index: 0, blob: new Blob(["O"], { type: "audio/ogg" }) }]);
  assert.equal(result.extension, "ogg");
});
