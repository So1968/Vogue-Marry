import test from "node:test";
import assert from "node:assert/strict";
import { explainLocalApiFailure } from "../src/lib/local-api-errors.js";

test("API locale indisponible : afficher un message utile sans déclarer la sauvegarde réussie", () => {
  const explained = explainLocalApiFailure(new TypeError("Failed to fetch"));
  assert.match(explained.message, /Connexion au serveur local/u);
  assert.match(explained.message, /ne supprimez pas les données locales/u);
});
test("expiration réseau et annulation explicite restent distinctes", () => {
  assert.match(explainLocalApiFailure({ name: "TimeoutError" }).message, /ne répond pas assez vite/u);
  const abort = new DOMException("Abort", "AbortError");
  assert.equal(explainLocalApiFailure(abort), abort);
  const http = new Error("Erreur de l'API locale (403).");
  assert.equal(explainLocalApiFailure(http), http);
});
