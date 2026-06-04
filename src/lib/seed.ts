import { prisma } from "@/lib/prisma";
import { hashPassword, isValidNumericPassword, normalizeEmail } from "@/lib/auth";

const teams = [
  { name: "Equipe Ferreira", isFerreira: true }
];

const dutyTypes = [
  { name: "Sombreiros", priority: 1, requiresExternal: true },
  { name: "Casa MD", priority: 2, requiresExternal: true },
  { name: "Mood", priority: 3, requiresExternal: true },
  { name: "Barra", priority: 4, requiresExternal: true },
  { name: "Sede Posicao 1", priority: 5, isHeadquarters: true, headquartersSlot: 1 },
  { name: "Sede Posicao 2", priority: 6, isHeadquarters: true, headquartersSlot: 2 },
  { name: "Ligacao", priority: 7, isCalling: true }
];

export function managerInitialEmail() {
  return normalizeEmail(process.env.MANAGER_EMAIL || "ferreira@escala.local");
}

export function managerInitialPassword() {
  const password = process.env.MANAGER_INITIAL_PASSWORD || "1234";
  return isValidNumericPassword(password) ? password : "1234";
}

export async function ensureSeedData() {
  for (const team of teams) {
    await prisma.team.upsert({
      where: { name: team.name },
      update: { isFerreira: team.isFerreira },
      create: team
    });
  }

  for (const dutyType of dutyTypes) {
    await prisma.dutyType.upsert({
      where: { name: dutyType.name },
      update: dutyType,
      create: dutyType
    });
  }

  await prisma.user.upsert({
    where: { email: managerInitialEmail() },
    update: { role: "MANAGER", brokerId: null },
    create: {
      email: managerInitialEmail(),
      passwordHash: hashPassword(managerInitialPassword()),
      role: "MANAGER"
    }
  });
}
