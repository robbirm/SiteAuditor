// Applies database migrations during the build, coping with the common
// hosting cases that make a plain `prisma migrate deploy` fail.
import { execSync } from "node:child_process";

const INIT_MIGRATION = "20261014170000_init";

function run(cmd) {
  return execSync(cmd, { stdio: "pipe", encoding: "utf8", env: process.env });
}

function deploy() {
  try {
    const out = run("npx prisma migrate deploy");
    process.stdout.write(out);
    return { ok: true };
  } catch (error) {
    const text = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    process.stdout.write(text);
    return { ok: false, text };
  }
}

if (!process.env.DATABASE_URL) {
  console.warn("[migrate] DATABASE_URL is not set at build time; skipping migrations. Run `npx prisma migrate deploy` once it is.");
  process.exit(0);
}

let result = deploy();

// P3005: the database already has tables but no migration history (e.g. it was
// set up by an earlier deploy or `prisma db push`). Mark the first migration
// as applied, then apply anything newer.
if (!result.ok && result.text.includes("P3005")) {
  console.log(`[migrate] Existing schema detected; baselining ${INIT_MIGRATION} and retrying.`);
  try {
    process.stdout.write(run(`npx prisma migrate resolve --applied ${INIT_MIGRATION}`));
  } catch (error) {
    process.stdout.write(`${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  }
  result = deploy();
}

if (!result.ok) {
  console.error("\n[migrate] Database migrations failed. The app was not deployed. Check DATABASE_URL and the error above.");
  process.exit(1);
}
