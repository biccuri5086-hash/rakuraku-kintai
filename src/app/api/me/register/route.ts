import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone";
import { errorResponse } from "@/lib/api-handler";

export async function POST(req: NextRequest) {
  try {
    const user = await getLineUserCached(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "LINEから開いてください（認証トークンがありません）" },
        { status: 401 }
      );
    }

    let body: { phone?: string; full_name?: string };
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

    const { data: dup } = await supabase
      .from("user_profiles")
      .select("user_id, role")
      .eq("phone", phone)
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
      });

    if (error) throw new Error(`supabase: ${error.message}`);

    return NextResponse.json({ ok: true, phone });
  } catch (e) {
    return errorResponse(e);
  }
}
