import { NextRequest, NextResponse } from "next/server";
import { requireSuperContext } from "@/lib/tenant-context";
import { listSessionsForActor, revokeSessionForActor, revokeOtherSessions } from "@/lib/server-session";
import { errorResponse } from "@/lib/api-handler";

export async function GET() {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const sessions = await listSessionsForActor("super_admin", guard.ctx.superAdminId);
    return NextResponse.json({ ok: true, current: guard.ctx.sessionId, sessions });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { searchParams } = new URL(req.url);

    if (searchParams.get("others") === "1") {
      await revokeOtherSessions("super_admin", guard.ctx.superAdminId, guard.ctx.sessionId);
      return NextResponse.json({ ok: true });
    }

    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, message: "id が必要です" }, { status: 400 });
    const revoked = await revokeSessionForActor(id, "super_admin", guard.ctx.superAdminId);
    if (!revoked) return NextResponse.json({ ok: false, message: "対象が見つかりません" }, { status: 404 });
    return NextResponse.json({ ok: true, wasCurrent: id === guard.ctx.sessionId });
  } catch (e) {
    return errorResponse(e);
  }
}
