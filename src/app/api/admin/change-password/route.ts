import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyPassword, hashPassword } from "@/lib/password";
import { checkPassword } from "@/lib/password-policy";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";
import { revokeOtherSessions } from "@/lib/server-session";

// 管理者が自分でパスワードを変更する（現在のパスワード必須＝本人確認）
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const current = String(body?.current_password ?? "");
    const next = String(body?.new_password ?? "");

    if (!current || !next) {
      return NextResponse.json({ ok: false, message: "現在のパスワードと新しいパスワードを入力してください" }, { status: 400 });
    }
    const strength = checkPassword(next);
    if (!strength.ok) {
      return NextResponse.json(
        { ok: false, message: strength.errors[0], errors: strength.errors },
        { status: 400 }
      );
    }
    if (next === current) {
      return NextResponse.json({ ok: false, message: "現在と違うパスワードにしてください" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: admin } = await supabase
      .from("admins")
      .select("id, password_hash")
      .eq("id", ctx.adminId)
      .maybeSingle();

    if (!admin || !verifyPassword(current, admin.password_hash)) {
      await logAudit(req, "admin_password_change_failure", { reason: "current_mismatch" }, {
        actorType: "admin", actorId: ctx.adminId, companyId: ctx.companyId,
      });
      return NextResponse.json({ ok: false, message: "現在のパスワードが正しくありません" }, { status: 401 });
    }

    const { error } = await supabase
      .from("admins")
      .update({ password_hash: hashPassword(next) })
      .eq("id", ctx.adminId);
    if (error) throw error;

    // 認証情報が変わったので、この端末以外のセッションを全て失効させる。
    await revokeOtherSessions("admin", ctx.adminId, ctx.sessionId);

    await logAudit(req, "admin_password_changed", {}, {
      actorType: "admin", actorId: ctx.adminId, companyId: ctx.companyId,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
