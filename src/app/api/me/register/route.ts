import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";

export async function POST(req: NextRequest) {
  try {
    const user = await getLineUserCached(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "LINEから開いてください（認証トークンがありません）" },
        { status: 401 }
      );
    }

    let body: { phone?: string; full_name?: string; invite_code?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const phone = normalizePhone(body.phone ?? "");
    if (!phone) {
      return NextResponse.json({ ok: false, message: "正しい電話番号を入力してください" }, { status: 400 });
    }

    const fullName = (body.full_name ?? "").trim();
    if (!fullName || fullName.length < 2 || fullName.length > 50) {
      return NextResponse.json({ ok: false, message: "本名を2文字以上50文字以内で入力してください" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: existing } = await supabase
      .from("user_profiles")
      .select("user_id, company_id, role")
      .eq("user_id", user.userId)
      .maybeSingle();

    let companyId: string | null = existing?.company_id ?? null;

    if (!companyId) {
      const inviteCode = (body.invite_code ?? "").trim();
      if (!inviteCode) {
        return NextResponse.json(
          { ok: false, message: "招待リンクから開いてください。所属する会社が特定できません。", code: "INVITE_REQUIRED" },
          { status: 400 }
        );
      }
      const { data: company } = await supabase
        .from("companies")
        .select("id, status")
        .eq("invite_code", inviteCode)
        .maybeSingle();
      if (!company) {
        return NextResponse.json({ ok: false, message: "招待リンクが無効です" }, { status: 400 });
      }
      if (company.status === "suspended" || company.status === "cancelled") {
        return NextResponse.json({ ok: false, message: "この会社のサービスは現在ご利用いただけません" }, { status: 403 });
      }
      companyId = company.id;
    }

    const { data: dup } = await supabase
      .from("user_profiles")
      .select("user_id, role")
      .eq("phone", phone)
      .eq("company_id", companyId)
      .neq("user_id", user.userId)
      .maybeSingle();
    if (dup && dup.role !== "admin") {
      return NextResponse.json(
        { ok: false, message: "この電話番号は既に他のアカウントで登録されています。担当者にお問い合わせください。" },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("user_profiles")
      .upsert({
        user_id: user.userId,
        display_name: user.displayName,
        full_name: fullName,
        phone,
        company_id: companyId,
      });

    if (error) throw new Error(`supabase: ${error.message}`);

    await logAudit(req, "staff_register", { phone_suffix: phone.slice(-4) }, {
      actorType: "staff", actorId: user.userId, companyId: companyId ?? undefined,
    });

    return NextResponse.json({ ok: true, phone });
  } catch (e) {
    return errorResponse(e);
  }
}
