import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const rows = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const row of rows) {
    const match = row.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const raw = match[2].trim();
    process.env[match[1]] = raw.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadLocalEnv();
  const { ensureSeedData } = await import("../src/lib/seed");
  const { prisma } = await import("../src/lib/prisma");
  try {
    await ensureSeedData();
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  });
