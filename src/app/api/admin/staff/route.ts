import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";

// スタッフ一覧（契約フォームの選択肢・管理台帳の属性編集などに使う軽量エンドポイント）
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, full_name, employment_type, social_insurance, status")
      .eq("company_id", ctx.companyId)
      .order("display_name", { ascending: true });
    if (error) throw error;

    const staff = (data ?? []).map((p) => ({
      user_id: p.user_id,
      name: p.full_name || p.display_name || p.user_id,
      employment_type: (p as { employment_type?: string | null }).employment_type ?? null,
      social_insurance: (p as { social_insurance?: string | null }).social_insurance ?? null,
      // status 列は移行前(未適用マイグレーション)は取得できず undefined になりうるので、
      // その場合は在籍中として扱う(フォールバック)。
      status: (p as { status?: string | null }).status ?? "active",
    }));
    return NextResponse.json({ ok: true, staff });
  } catch (e) {
    return errorResponse(e);
  }
}

// スタッフの派遣法・台帳属性（無期/有期・社会保険加入状況）・在籍状態を更新
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const user_id = String(body?.user_id ?? "").trim();
    if (!user_id) return NextResponse.json({ ok: false, message: "user_idが必要です" }, { status: 400 });

    const supabase = getSupabaseAdmin();

    // 指定されたフィールドだけを更新する（未指定のフィールドを誤って null に上書きしない）。
    const update: Record<string, unknown> = {};
    if ("employment_type" in body) {
      const et = body.employment_type;
      update.employment_type = et === "indefinite" || et === "fixed" ? et : null;
    }
    if ("social_insurance" in body) {
      const si = body.social_insurance;
      update.social_insurance = si === "enrolled" || si === "not_enrolled" || si === "exempt" ? si : null;
    }
    let statusChangingTo: string | null = null;
    if ("status" in body) {
      const st = body.status;
      if (st !== "active" && st !== "inactive") {
        return NextResponse.json({ ok: false, message: "status は active/inactive のいずれかです" }, { status: 400 });
      }
      update.status = st;
      statusChangingTo = st;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: false, message: "更新項目がありません" }, { status: 400 });
    }

    const { error } = await supabase
      .from("user_profiles")
      .update(update)
      .eq("company_id", ctx.companyId)
      .eq("user_id", user_id);
    if (error) throw error;

    // 在籍状態の変更は打刻の可否に直結するため監査ログに残す。
    // me_session Cookie は最大5分キャッシュが残るため、無効化してもその間は
    // 打刻できてしまう可能性がある点は運用手順書に明記している。
    if (statusChangingTo !== null) {
      await logAudit(req, "admin_staff_status_change", { user_id, status: statusChangingTo }, {
        actorType: "admin", actorId: ctx.adminId, companyId: ctx.companyId,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
