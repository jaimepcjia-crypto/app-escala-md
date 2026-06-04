import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const result = await requireUser(request);
  if ("error" in result) return result.error;
  return NextResponse.json({
    user: {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      broker: result.user.broker
    }
  });
}
