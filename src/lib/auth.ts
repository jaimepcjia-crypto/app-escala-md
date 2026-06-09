import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "escala_md_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

function sessionSecret() {
  return process.env.AUTH_SECRET || "escala-md-dev-secret";
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidNumericPassword(password: string) {
  return /^\d{4,10}$/.test(password);
}

export function numericPasswordError() {
  return "A senha deve conter apenas numeros, com 4 a 10 digitos.";
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const iterations = 120000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

export function passwordCredentialData(password: string) {
  return { passwordHash: hashPassword(password), passwordPlain: password };
}

export function verifyPassword(password: string, encoded: string) {
  const [kind, iterationsText, salt, expected] = encoded.split("$");
  if (kind !== "pbkdf2" || !iterationsText || !salt || !expected) return false;
  const actual = pbkdf2Sync(password, salt, Number(iterationsText), 32, "sha256").toString("hex");
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifyStoredPassword(password: string, user: { passwordHash: string; passwordPlain?: string | null }) {
  const hashMatches = verifyPassword(password, user.passwordHash);
  return {
    valid: hashMatches || Boolean(user.passwordPlain && password === user.passwordPlain),
    needsHashRepair: !hashMatches && Boolean(user.passwordPlain && password === user.passwordPlain)
  };
}

function sign(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export function createSessionToken(user: { id: string; role: string; brokerId: string | null }) {
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    role: user.role,
    brokerId: user.brokerId,
    exp: Date.now() + SESSION_MAX_AGE * 1000
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token?: string | null) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId: string;
      role: string;
      brokerId: string | null;
      exp: number;
    };
    if (session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export function getRequestSession(request: NextRequest) {
  return readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function getCurrentUserFromCookies() {
  const cookieStore = await cookies();
  const session = readSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return prisma.user.findUnique({
    where: { id: session.userId },
    include: { broker: { include: { team: true } } }
  });
}

export async function requireManager(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session || session.role !== "MANAGER") {
    return { error: NextResponse.json({ error: "Acesso restrito ao gerente." }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return { error: NextResponse.json({ error: "Sessao invalida." }, { status: 401 }) };
  return { session, user };
}

export async function requireUser(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session) return { error: NextResponse.json({ error: "Login necessario." }, { status: 401 }) };
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { broker: { include: { team: true } } }
  });
  if (!user) return { error: NextResponse.json({ error: "Sessao invalida." }, { status: 401 }) };
  return { session, user };
}
