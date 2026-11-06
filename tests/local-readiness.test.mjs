import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedNode, probeLocalService } from "../scripts/lib/local-readiness.mjs";

test("installation : refuser les versions Node trop anciennes pour les dépendances verrouillées", () => {
  for (const value of ["20.19.0", "22.0.0", "22.11.9", "inconnu", "22.12.0-rc.1"]) assert.equal(isSupportedNode(value), false, value);
  for (const value of ["22.12.0", "22.22.0", "v24.19.0"]) assert.equal(isSupportedNode(value), true, value);
});

test("diagnostic : distinguer service sain, indisponible, interdit et mauvais service", async () => {
  const service = "vogue-marry-local-backend";
  for (const [status, body, healthy] of [
    [200, { status: "ok", service }, true], [503, { status: "ok", service }, false],
    [403, { error: "Accès refusé" }, false], [200, { status: "ok", service: "autre-service" }, false],
    [200, { status: "error", service }, false], [200, { private: "NE_PAS_AFFICHER" }, false]
  ]) {
    const result = await probeLocalService("http://127.0.0.1:8010/api/health", service,
      async () => new Response(JSON.stringify(body), { status }));
    assert.deepEqual(result, { reachable: true, status, healthy });
    assert.ok(!JSON.stringify(result).includes("NE_PAS_AFFICHER"));
  }
  assert.deepEqual(await probeLocalService("http://127.0.0.1:8010/api/health", service,
    async () => { throw new Error("Réseau absent"); }), { reachable: false, healthy: false });
});
