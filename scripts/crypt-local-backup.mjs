#!/usr/bin/env node
// Chiffrement authentifié d'une archive existante. Jamais de phrase secrète en argument CLI.
import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { pipeline } from "node:stream/promises";

const [operation, fileArg] = process.argv.slice(2);
const password = process.env.VOGUE_BACKUP_PASSPHRASE || "";
if (password.length < 16) throw new Error("VOGUE_BACKUP_PASSPHRASE doit contenir au moins 16 caractères.");
if (!["encrypt", "decrypt"].includes(operation) || !fileArg) throw new Error("Usage: encrypt|decrypt /chemin/fichier");
const file = path.resolve(fileArg);
if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("Fichier introuvable.");
const magic = Buffer.from("VMBACK01");
const output = operation === "encrypt" ? file + ".enc" : file.replace(/\.enc$/u, "") + ".decrypted";
if (output === file || fs.existsSync(output)) throw new Error("Destination existante ou invalide : refus d'écrasement.");
const tmp = output + ".partial";
if (fs.existsSync(tmp)) throw new Error("Fichier temporaire existant : intervention nécessaire.");
try {
  if (operation === "encrypt") {
    const salt = randomBytes(16), iv = randomBytes(12);
    const key = scryptSync(password, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const header = Buffer.concat([magic, salt, iv]);
    cipher.setAAD(header);
    fs.writeFileSync(tmp, header, { flag: "wx", mode: 0o600 });
    await pipeline(fs.createReadStream(file), cipher, fs.createWriteStream(tmp, { flags: "a", mode: 0o600 }));
    fs.appendFileSync(tmp, cipher.getAuthTag());
  } else {
    const size = fs.statSync(file).size;
    if (size < 52) throw new Error("Archive chiffrée tronquée.");
    const header = Buffer.alloc(36), tag = Buffer.alloc(16);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, header, 0, 36, 0);
      fs.readSync(fd, tag, 0, 16, size - 16);
    } finally { fs.closeSync(fd); }
    if (!header.subarray(0, 8).equals(magic)) throw new Error("Format chiffré inconnu.");
    const key = scryptSync(password, header.subarray(8, 24), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(24, 36));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await pipeline(fs.createReadStream(file, { start: 36, end: size - 17 }), decipher,
      fs.createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
  }
  fs.renameSync(tmp, output);
  console.log(JSON.stringify({ status: operation === "encrypt" ? "encrypted" : "decrypted", file: output, sourcePreserved: true }));
} finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
