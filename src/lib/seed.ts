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

const initialBrokers = [
  { name: "Ana", email: "corretor847629@teste.local", password: "508652" },
  { name: "Bruno", email: "corretor880809@teste.local", password: "970451" },
  { name: "Carla", email: "corretor441004@teste.local", password: "582095" },
  { name: "Diego", email: "corretor659233@teste.local", password: "624103" },
  { name: "Elisa", email: "corretor546128@teste.local", password: "619969" },
  { name: "Fabio", email: "corretor592786@teste.local", password: "402519" },
  { name: "Giulia", email: "corretor317543@teste.local", password: "130863" },
  { name: "Hugo", email: "corretor768325@teste.local", password: "980258" },
  { name: "Ines", email: "corretor324841@teste.local", password: "637548" },
  { name: "Joao", email: "corretor609751@teste.local", password: "596303" }
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

  const existingManager = await prisma.user.findUnique({ where: { email: managerInitialEmail() } });
  await prisma.user.upsert({
    where: { email: managerInitialEmail() },
    update: {
      role: "MANAGER",
      brokerId: null,
      ...(existingManager && !existingManager.passwordPlain ? { passwordPlain: managerInitialPassword() } : {})
    },
    create: {
      email: managerInitialEmail(),
      passwordHash: hashPassword(managerInitialPassword()),
      passwordPlain: managerInitialPassword(),
      role: "MANAGER"
    }
  });

  const ferreiraTeam = await prisma.team.findUniqueOrThrow({ where: { name: "Equipe Ferreira" } });

  for (const brokerSeed of initialBrokers) {
    const email = normalizeEmail(brokerSeed.email);
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { broker: true }
    });

    if (existingUser?.broker) {
      await prisma.broker.update({
        where: { id: existingUser.broker.id },
        data: {
          teamId: ferreiraTeam.id,
          canExternalDuty: true,
          active: true
        }
      });
      // backfill da senha em texto p/ exibir na aba DADOS (só se ainda não tiver)
      if (!existingUser.passwordPlain) {
        await prisma.user.update({ where: { id: existingUser.id }, data: { passwordPlain: brokerSeed.password } });
      }
      continue;
    }

    const broker = await prisma.broker.upsert({
      where: { name: brokerSeed.name },
      update: {
        teamId: ferreiraTeam.id,
        canExternalDuty: true,
        active: true
      },
      create: {
        name: brokerSeed.name,
        teamId: ferreiraTeam.id,
        canExternalDuty: true,
        active: true
      }
    });

    await prisma.user.upsert({
      where: { email },
      update: {
        role: "BROKER",
        brokerId: broker.id,
        ...(existingUser && !existingUser.passwordPlain ? { passwordPlain: brokerSeed.password } : {})
      },
      create: {
        email,
        passwordHash: hashPassword(brokerSeed.password),
        passwordPlain: brokerSeed.password,
        role: "BROKER",
        brokerId: broker.id
      }
    });
  }
}
