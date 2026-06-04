import { NextRequest, NextResponse } from "next/server";
import { getPublishedSchedule } from "@/lib/data";
import { requireUser } from "@/lib/auth";
import { formatWeekStart, normalizeWeekStart } from "@/lib/constants";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const requestedWeekStart = request.nextUrl.searchParams.get("weekStart") ?? undefined;
  const isBroker = auth.user.role === "BROKER";
  const weekStart = isBroker ? formatWeekStart(normalizeWeekStart()) : requestedWeekStart;
  const ferreiraOnly = request.nextUrl.searchParams.get("ferreiraOnly") === "1";
  return NextResponse.json(await getPublishedSchedule(weekStart, { ferreiraOnly }));
}
