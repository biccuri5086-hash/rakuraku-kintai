import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant-context";
import { listSessionsForActor, revokeSessionForActor, revokeOtherSessions } from "@/lib/server-session";
import { errorResponse } from "@/lib/api-handler";

// 自分のログイン中セッション一覧。current は今使っている端末。
export async function GET() {
  try {
    const guard = await requireTenantContext();
    if (guard.error) return guard.error;
    const sessions = await listSessionsForActor("admin", guard.ctx.adminId);
    return NextResponse.json({ ok: true, current: guard.ctx.sessionId, sessions });
  } catch (e) {
    return errorResponse(e);
  }
}

// 端末ごとのログアウト。?id=<uuid> で1件、?others=1 で現在の端末以外を全て失効。
export async function DELETE(req: NextRequest) {
  try {
    const guard = await requireTenantContext();
    if (guard.error) return guard.error;
    const { searchParams } = new URL(req.url);

    if (searchParams.get("others") === "1") {
      await revokeOtherSessions("admin", guard.ctx.adminId, guard.ctx.sessionId);
      return NextResponse.json({ ok: true });
    }

    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, message: "id が必要です" }, { status: 400 });
    // 本人のセッションのみ失効できる（他人のIDは対象外）。
    const revoked = await revokeSessionForActor(id, "admin", guard.ctx.adminId);
    if (!revoked) return NextResponse.json({ ok: false, message: "対象が見つかりません" }, { status: 404 });
    return NextResponse.json({ ok: true, wasCurrent: id === guard.ctx.sessionId });
  } catch (e) {
    return errorResponse(e);
  }
}
