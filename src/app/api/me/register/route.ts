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

    let body: { phone?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const phone = normalizePhone(body.phone ?? "");
    if (!phone) {
      return NextResponse.json({ ok: false, message: "正しい電話番号を入力してください" }, { status: 400 });
    }

    const { error } = await getSupabaseAdmin()
      .from("user_profiles")
      .upsert({
        user_id: user.userId,
        display_name: user.displayName,
        phone,
      });

    if (error) throw new Error(`supabase: ${error.message}`);

    return NextResponse.json({ ok: true, phone });
  } catch (e) {
    return errorResponse(e);
  }
}
