#!/usr/bin/env node
/**
 * Reset a local StickForge account password (accounts are local, so there is no reset email).
 *
 *   npm run reset-password -- you@example.com
 *
 * Asks for the new password (typed twice, hidden), stores a scrypt hash in the
 * local database and signs that account out everywhere. Uses the same data
 * folder as the app (STICKFORGE_HOME or %LOCALAPPDATA%\StickForgeStudio).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run reset-password -- you@example.com");
  process.exit(1);
}
const home = process.env.STICKFORGE_HOME
  ? path.resolve(process.env.STICKFORGE_HOME)
  : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "StickForgeStudio");
const dbFile = path.join(home, "stickforge.db");
if (!fs.existsSync(dbFile)) {
  console.error(`No StickForge database found at ${dbFile}`);
  process.exit(1);
}
const db = new DatabaseSync(dbFile);
const user = db.prepare("SELECT id, name FROM users WHERE email = ?").get(email);
if (!user) {
  console.error(`No account with the email ${email}.`);
  const all = db.prepare("SELECT email FROM users ORDER BY created_at").all();
  if (all.length) console.error(`Accounts on this computer: ${all.map((u) => u.email).join(", ")}`);
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const pw = process.env.STICKFORGE_NEW_PASSWORD ?? (await askHidden(`New password for ${user.name} <${email}>: `));
const again = process.env.STICKFORGE_NEW_PASSWORD ?? (await askHidden("Type it again: "));
if (pw !== again) {
  console.error("Passwords don't match.");
  process.exit(1);
}
if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
  console.error("Use at least 8 characters with a letter and a number.");
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(pw.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const hash = `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
console.log(`Password updated for ${email}. You can log in now.`);
