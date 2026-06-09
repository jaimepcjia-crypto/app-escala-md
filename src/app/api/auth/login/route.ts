import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, normalizeEmail, passwordCredentialData, setSessionCookie, verifyStoredPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  const user = await prisma.user.findUnique({
    where: { email },
    include: { broker: { include: { team: true } } }
  });

  const verification = user ? verifyStoredPassword(password, user) : null;
  if (!user || !verification?.valid) {
    return NextResponse.json({ error: "Email ou senha invalidos." }, { status: 401 });
  }
  if (verification.needsHashRepair) {
    await prisma.user.update({ where: { id: user.id }, data: passwordCredentialData(password) });
  }

  const sessionToken = createSessionToken(user);
  const response = NextResponse.json({
    sessionToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      broker: user.broker
    }
  });
  setSessionCookie(response, sessionToken);
  return response;
}
