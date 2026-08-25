import { NextRequest, NextResponse } from "next/server";
import { requireSuperContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashPassword } from "@/lib/password";
import { generatePassword } from "@/lib/generate-password";
import { checkPassword } from "@/lib/password-policy";
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
    const strength = checkPassword(password, { email });
    if (!strength.ok) {
      return NextResponse.json(
        { ok: false, message: strength.errors[0], errors: strength.errors },
        { status: 400 }
      );
    }
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

// パスワード再発行。運営が顧客管理者の代わりに新しいパスワードを発行する。
//
// 顧客の管理者がパスワードを忘れると、本人には復旧手段が無い（メールでの再設定は未実装）。
// これが無いと運営が本番DBを直接 UPDATE することになるため、その手作業を無くすためのもの。
//
// 平文は生成直後のこのレスポンスでしか返さない。DBにはハッシュだけを保存する。
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { id: companyId } = await ctx.params;
    if (!isUuid(companyId)) return NextResponse.json({ ok: false, message: "不正なID" }, { status: 400 });

    let body: { admin_id?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

    const adminId = body.admin_id ?? "";
    if (!isUuid(adminId)) {
      return NextResponse.json({ ok: false, message: "admin_id を指定してください" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    // 他社の管理者を書き換えられないよう company_id でも絞る。
    const { data: target } = await supabase
      .from("admins")
      .select("id, email, full_name, is_active")
      .eq("company_id", companyId)
      .eq("id", adminId)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ ok: false, message: "管理者が見つかりません" }, { status: 404 });
    }

    const password = generatePassword();
    const { error } = await supabase
      .from("admins")
      .update({ password_hash: hashPassword(password) })
      .eq("company_id", companyId)
      .eq("id", adminId);

    if (error) throw new Error(error.message);

    await logAudit(req, "super_admin_password_reset", { admin_id: adminId, email: target.email }, {
      actorType: "super_admin", actorId: guard.ctx.superAdminId, companyId,
    });

    return NextResponse.json({
      ok: true,
      password,
      admin: { id: target.id, email: target.email, full_name: target.full_name, is_active: target.is_active },
    });
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
