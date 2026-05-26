import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SUPER_SESSION_COOKIE } from "@/lib/tenant-session";
import { getSuperContext } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";

export async function POST(req: NextRequest) {
  const ctx = await getSuperContext();
  if (ctx) {
    await logAudit(req, "super_logout", undefined, { actorType: "super_admin", actorId: ctx.superAdminId });
  }
  const store = await cookies();
  store.set(SUPER_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return NextResponse.json({ ok: true });
}
