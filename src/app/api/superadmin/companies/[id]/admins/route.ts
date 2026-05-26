import { NextRequest, NextResponse } from "next/server";
import { requireSuperContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { id: companyId } = await ctx.params;
    if (!isUuid(companyId)) return NextResponse.json({ ok: false, message: "不正なID" }, { status: 400 });

    let body: { email?: string; password?: string; full_name?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const fullName = (body.full_name ?? "").trim();

    if (!isEmail(email)) return NextResponse.json({ ok: false, message: "メールアドレスが不正です" }, { status: 400 });
    if (password.length < 10) return NextResponse.json({ ok: false, message: "パスワードは10文字以上必要です" }, { status: 400 });
    if (!fullName || fullName.length > 50) return NextResponse.json({ ok: false, message: "管理者名を1〜50文字で入力してください" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: company } = await supabase.from("companies").select("id").eq("id", companyId).maybeSingle();
    if (!company) return NextResponse.json({ ok: false, message: "会社が見つかりません" }, { status: 404 });

    const { data: existing } = await supabase
      .from("admins")
      .select("id")
      .eq("company_id", companyId)
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: false, message: "このメールは既に登録されています" }, { status: 409 });
    }

    const { data: admin, error } = await supabase
      .from("admins")
      .insert({
        company_id: companyId,
        email,
        password_hash: hashPassword(password),
        full_name: fullName,
      })
      .select("id, email, full_name, is_active, created_at")
      .single();

    if (error) throw new Error(error.message);

    await logAudit(req, "super_admin_create", { email, admin_id: admin.id }, {
      actorType: "super_admin", actorId: guard.ctx.superAdminId, companyId,
    });

    return NextResponse.json({ ok: true, admin });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { id: companyId } = await ctx.params;
    if (!isUuid(companyId)) return NextResponse.json({ ok: false, message: "不正なID" }, { status: 400 });

    const adminId = new URL(req.url).searchParams.get("admin_id");
    if (!adminId || !isUuid(adminId)) {
      return NextResponse.json({ ok: false, message: "admin_id を指定してください" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("admins")
      .delete()
      .eq("company_id", companyId)
      .eq("id", adminId);

    if (error) throw new Error(error.message);

    await logAudit(req, "super_admin_delete", { admin_id: adminId }, {
      actorType: "super_admin", actorId: guard.ctx.superAdminId, companyId,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
