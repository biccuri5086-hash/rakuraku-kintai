import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  const correct = process.env.ADMIN_PASSWORD;
  if (!correct) {
    return NextResponse.json({ ok: false, message: "サーバー設定エラー" }, { status: 500 });
  }

  if (password !== correct) {
    return NextResponse.json({ ok: false, message: "パスワードが違います" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
