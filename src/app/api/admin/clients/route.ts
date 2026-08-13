import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

// 派遣先（clients）の一覧取得
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, workplace_name, address, contact_name, contact_phone, teishokubi, created_at")
      .eq("company_id", ctx.companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({ ok: true, clients: data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}

// 派遣先の新規登録
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ ok: false, message: "派遣先名は必須です" }, { status: 400 });
    }

    const clean = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s.length > 0 ? s : null;
    };

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("clients")
      .insert({
        company_id: ctx.companyId,
        name,
        workplace_name: clean(body?.workplace_name),
        address: clean(body?.address),
        contact_name: clean(body?.contact_name),
        contact_phone: clean(body?.contact_phone),
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e) {
    return errorResponse(e);
  }
}

// 派遣先の編集
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "").trim();
    const name = String(body?.name ?? "").trim();
    if (!id || !name) return NextResponse.json({ ok: false, message: "派遣先名は必須です" }, { status: 400 });
    const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s.length > 0 ? s : null; };
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("clients").update({
      name,
      workplace_name: clean(body?.workplace_name),
      address: clean(body?.address),
      contact_name: clean(body?.contact_name),
      contact_phone: clean(body?.contact_phone),
    }).eq("id", id).eq("company_id", ctx.companyId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

// 派遣先の削除（紐づく契約・シフトはDBのcascadeで一緒に消える）
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, message: "idが必要です" }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("clients").delete().eq("id", id).eq("company_id", ctx.companyId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
