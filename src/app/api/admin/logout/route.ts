import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/admin-session";
import { logAudit } from "@/lib/audit-log";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  await logAudit(req, "admin_logout");
  return NextResponse.json({ ok: true });
}
