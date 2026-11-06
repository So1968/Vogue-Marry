import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const INTERNAL_TOKEN_HEADER = "x-vogue-internal-token";
export const LOCAL_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173"
]);

// CORS ne suffit pas : une lecture média ou une navigation peut omettre Origin.
export function browserAccessGuard(req, res, next) {
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  let referringOrigin;
  try { referringOrigin = new URL(req.headers.referer).origin; } catch { /* absent ou invalide */ }
  if ((origin && !LOCAL_ORIGINS.has(origin)) || site === "cross-site" ||
      (site && !origin && !LOCAL_ORIGINS.has(referringOrigin))) {
    return res.status(403).json({ error: "Accès depuis une origine non autorisée." });
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}

// Un secret partagé entre les deux processus, jamais transmis au navigateur.
// Publication atomique : deux démarrages simultanés voient le même fichier complet.
export function loadInternalToken(configDir) {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const tokenPath = path.join(configDir, "internal_api_token");
  if (!fs.existsSync(tokenPath)) {
    const temporary = path.join(configDir, `.internal-token-${process.pid}-${randomBytes(8).toString("hex")}`);
    try {
      fs.writeFileSync(temporary, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
      try { fs.linkSync(temporary, tokenPath); } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  const fd = fs.openSync(tokenPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())) {
      throw new Error("Permissions du secret interne non sûres.");
    }
    const token = fs.readFileSync(fd, "utf8");
    if (!/^[a-f0-9]{64}$/u.test(token)) throw new Error("Secret interne invalide.");
    return token;
  } finally { fs.closeSync(fd); }
}

export function internalAccessGuard(token) {
  const expected = Buffer.from(token);
  return (req, res, next) => {
    const supplied = Buffer.from(String(req.headers[INTERNAL_TOKEN_HEADER] || ""));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(403).json({ error: "Accès réservé à la façade locale." });
    }
    next();
  };
}
