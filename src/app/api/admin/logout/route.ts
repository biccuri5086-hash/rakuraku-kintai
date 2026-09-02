import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { TENANT_SESSION_COOKIE } from "@/lib/tenant-session";
import { getTenantContext } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";
import { revokeServerSession } from "@/lib/server-session";

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (ctx) {
    await revokeServerSession(ctx.sessionId);
    await logAudit(req, "admin_logout", undefined, {
      actorType: "admin", actorId: ctx.adminId, companyId: ctx.companyId,
    });
  }
  const store = await cookies();
  store.set(TENANT_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return NextResponse.json({ ok: true });
}
