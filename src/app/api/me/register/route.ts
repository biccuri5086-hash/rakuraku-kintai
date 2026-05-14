import { NextRequest, NextResponse } from "next/server";
import { requireLineUserDetailed } from "@/lib/line-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone";

export async function POST(req: NextRequest) {
  const result = await requireLineUserDetailed(req);
  if (!result.user) {
    const message = result.error === "NO_TOKEN"
      ? "LINEから開いてください（認証トークンがありません）"
      : "LINEセッションが無効です。LINEから開き直してください";
    return NextResponse.json({ ok: false, message, code: result.error }, { status: 401 });
  }
  const user = result.user;

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

  if (error) {
    return NextResponse.json({ ok: false, message: "登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, phone });
}
