#!/usr/bin/env node
// Diagnostic en lecture seule des permissions du stockage local.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(os.homedir(), "VOGUE-MERRY-DONNEES");
const report = { rootExists: fs.existsSync(root), files: 0, directories: 0,
  filesAccessibleOutsideOwner: 0, directoriesAccessibleOutsideOwner: 0,
  symbolicLinks: 0, inspected: 0, truncated: false };
if (report.rootExists) {
  const stack = [root];
  const limit = 200000;
  while (stack.length && report.inspected < limit) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    report.inspected++;
    if (stat.isSymbolicLink()) { report.symbolicLinks++; continue; }
    if (stat.isDirectory()) {
      report.directories++;
      if (stat.mode & 0o077) report.directoriesAccessibleOutsideOwner++;
      for (const name of fs.readdirSync(current)) stack.push(path.join(current, name));
    } else if (stat.isFile()) {
      report.files++;
      if (stat.mode & 0o077) report.filesAccessibleOutsideOwner++;
    }
  }
  report.truncated = stack.length > 0;
}
console.log(JSON.stringify(report, null, 2));
if (report.truncated || report.filesAccessibleOutsideOwner ||
  report.directoriesAccessibleOutsideOwner || report.symbolicLinks) process.exitCode = 2;
