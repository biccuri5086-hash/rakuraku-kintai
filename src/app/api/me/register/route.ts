import { NextRequest, NextResponse } from "next/server";
import { requireLineUser } from "@/lib/line-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone";

export async function POST(req: NextRequest) {
  const user = await requireLineUser(req);
  if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

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
