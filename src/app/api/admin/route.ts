import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSnapshot, reaisToCents, salesMonthStartForWeek } from "@/lib/data";
import { weeklyWorkflowStatus } from "@/lib/deadlines";
import { isValidEmail, isValidNumericPassword, normalizeEmail, numericPasswordError, passwordCredentialData, requireManager, verifyPassword } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;
  return NextResponse.json(await getAdminSnapshot());
}

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;
  const body = await request.json();

  if (body.action === "updateBroker") {
    const brokerId = String(body.id ?? "");
    const name = String(body.name ?? "").trim();
    const email = normalizeEmail(String(body.email ?? ""));
    const password = String(body.password ?? "");
    if (!name) return NextResponse.json({ error: "Informe o nome do corretor." }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ error: "Informe um email valido para o corretor." }, { status: 400 });
    if (password && !isValidNumericPassword(password)) return NextResponse.json({ error: numericPasswordError() }, { status: 400 });
    const target = await prisma.broker.findUnique({ where: { id: brokerId }, include: { user: true } });
    if (!target) return NextResponse.json({ error: "Corretor nao encontrado para atualizacao." }, { status: 404 });
    if (!target.user) return NextResponse.json({ error: "Login do corretor nao encontrado para atualizacao." }, { status: 409 });
    const existing = await prisma.broker.findFirst({ where: { name, id: { not: brokerId } } });
    if (existing) return NextResponse.json({ error: "Ja existe outro corretor com este nome." }, { status: 409 });
    const existingEmail = await prisma.user.findFirst({ where: { email, brokerId: { not: brokerId } } });
    if (existingEmail) return NextResponse.json({ error: "Ja existe uma conta com este email." }, { status: 409 });
    const broker = await prisma.$transaction(async (tx) => {
      const updated = await tx.broker.update({
        where: { id: brokerId },
        data: {
          name,
          canExternalDuty: Boolean(body.canExternalDuty),
          active: Boolean(body.active)
        }
      });
      await tx.user.update({
        where: { brokerId },
        // senha só muda se vier preenchida (numérica); grava hash + texto p/ exibição
        data: { email, ...(password ? passwordCredentialData(password) : {}) }
      });
      return updated;
    });
    return NextResponse.json({ broker });
  }

  if (body.action === "deleteBroker") {
    const brokerId = String(body.id ?? "");
    const broker = await prisma.broker.findUnique({ where: { id: brokerId }, select: { id: true, name: true } });
    if (!broker) return NextResponse.json({ error: "Corretor nao encontrado." }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.scheduleAssignment.updateMany({
        where: { brokerId },
        data: {
          brokerId: null,
          isViolation: true,
          violationReason: "Corretor removido do cadastro."
        }
      });
      await tx.unavailabilityConfirmation.deleteMany({ where: { brokerId } });
      await tx.unavailability.deleteMany({ where: { brokerId } });
      await tx.brokerMonthlySale.deleteMany({ where: { brokerId } });
      await tx.historyTotal.deleteMany({ where: { brokerId } });
      await tx.user.deleteMany({ where: { brokerId } });
      await tx.broker.delete({ where: { id: brokerId } });
    });

    return NextResponse.json({ ok: true, broker });
  }

  if (body.action === "updateMonthlySale") {
    const weekStart = weeklyWorkflowStatus().weekStartDate;
    const monthStart = salesMonthStartForWeek(weekStart);
    const sale = await prisma.brokerMonthlySale.upsert({
      where: { monthStart_brokerId: { monthStart, brokerId: String(body.brokerId) } },
      update: { amountCents: reaisToCents(body.amountReais) },
      create: { monthStart, brokerId: String(body.brokerId), amountCents: reaisToCents(body.amountReais) }
    });
    return NextResponse.json({ sale: { ...sale, amountCents: sale.amountCents.toString() } });
  }

  if (body.action === "changeOwnPassword") {
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    const manager = await prisma.user.findUnique({ where: { id: auth.user.id } });
    if (!manager) return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
    if (!verifyPassword(currentPassword, manager.passwordHash)) {
      return NextResponse.json({ error: "Senha atual invalida." }, { status: 400 });
    }
    if (!isValidNumericPassword(newPassword)) {
      return NextResponse.json({ error: numericPasswordError() }, { status: 400 });
    }
    await prisma.user.update({
      where: { id: manager.id },
      data: passwordCredentialData(newPassword)
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "resetBrokerPassword") {
    const brokerId = String(body.brokerId ?? "");
    const newPassword = String(body.newPassword ?? "");
    if (!isValidNumericPassword(newPassword)) {
      return NextResponse.json({ error: numericPasswordError() }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { brokerId } });
    if (!user) return NextResponse.json({ error: "Login do corretor nao encontrado." }, { status: 404 });
    await prisma.user.update({
      where: { id: user.id },
      data: passwordCredentialData(newPassword)
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "updateDutyPriorities") {
    const workflow = weeklyWorkflowStatus();
    if (!workflow.isOpen) return NextResponse.json({ error: "A prioridade da proxima escala so pode ser alterada no sabado ou domingo." }, { status: 403 });
    const items = (Array.isArray(body.items) ? body.items : []).filter((item: { localName?: string }) => String(item.localName ?? "").trim());
    await prisma.$transaction(
      items.map((item: { localName?: string; position?: number }, index: number) =>
        prisma.dutyPriority.upsert({
          where: { localName: String(item.localName ?? "").trim() },
          update: { position: Number(item.position ?? index + 1) },
          create: { localName: String(item.localName ?? "").trim(), position: Number(item.position ?? index + 1) }
        })
      )
    );
    return NextResponse.json({ ok: true });
  }

  if (body.action === "createBroker") {
    const name = String(body.name ?? "").trim();
    const email = normalizeEmail(String(body.email ?? ""));
    const initialPassword = String(body.initialPassword ?? "");
    if (!name) return NextResponse.json({ error: "Informe o nome do corretor." }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ error: "Informe um email valido para o corretor." }, { status: 400 });
    if (!isValidNumericPassword(initialPassword)) return NextResponse.json({ error: numericPasswordError() }, { status: 400 });
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return NextResponse.json({ error: "Ja existe uma conta com este email." }, { status: 409 });
    const ferreiraTeam = await prisma.team.findFirst({ where: { isFerreira: true } });
    if (!ferreiraTeam) return NextResponse.json({ error: "Equipe Ferreira nao encontrada." }, { status: 500 });
    const broker = await prisma.$transaction(async (tx) => {
      const created = await tx.broker.create({
        data: {
          name,
          teamId: ferreiraTeam.id,
          canExternalDuty: Boolean(body.canExternalDuty),
          active: body.active === undefined ? true : Boolean(body.active),
          historyTotal: { create: {} }
        }
      });
      await tx.user.create({
        data: {
          email,
          ...passwordCredentialData(initialPassword),
          role: "BROKER",
          brokerId: created.id
        }
      });
      return created;
    });
    return NextResponse.json({ broker });
  }

  return NextResponse.json({ error: "Acao administrativa desconhecida." }, { status: 400 });
}
