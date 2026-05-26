import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await ctx.params;
    const clean = (code ?? "").trim();
    if (!clean || clean.length > 80) {
      return NextResponse.json({ ok: false, message: "招待コードが不正です" }, { status: 400 });
    }

    const { data } = await getSupabaseAdmin()
      .from("companies")
      .select("id, name, status")
      .eq("invite_code", clean)
      .maybeSingle();

    if (!data) {
      return NextResponse.json({ ok: false, message: "この招待リンクは無効です" }, { status: 404 });
    }
    if (data.status === "suspended" || data.status === "cancelled") {
      return NextResponse.json({ ok: false, message: "この会社のサービスは現在ご利用いただけません" }, { status: 403 });
    }

    return NextResponse.json({ ok: true, company: { id: data.id, name: data.name, status: data.status } });
  } catch (e) {
    return errorResponse(e);
  }
}
