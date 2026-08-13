import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

// 契約（アサイン）一覧：派遣先名・スタッフ名を解決して返す
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const [{ data: assignments, error }, { data: clients }, { data: profiles }] = await Promise.all([
      supabase
        .from("assignments")
        .select("id, user_id, client_id, type, start_date, end_date, job_content, hourly_rate, status, created_at")
        .eq("company_id", ctx.companyId)
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").eq("company_id", ctx.companyId),
      supabase.from("user_profiles").select("user_id, display_name, full_name").eq("company_id", ctx.companyId),
    ]);
    if (error) throw error;

    const clientMap = new Map<string, string>();
    for (const c of clients ?? []) clientMap.set(c.id, c.name);
    const staffMap = new Map<string, string>();
    for (const p of profiles ?? []) staffMap.set(p.user_id, p.full_name || p.display_name || p.user_id);

    const rows = (assignments ?? []).map((a) => ({
      ...a,
      client_name: clientMap.get(a.client_id) ?? "（削除された派遣先）",
      staff_name: staffMap.get(a.user_id) ?? a.user_id,
    }));
    return NextResponse.json({ ok: true, assignments: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

// 契約の新規作成
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const user_id = String(body?.user_id ?? "").trim();
    const client_id = String(body?.client_id ?? "").trim();
    const type = body?.type === "ongoing" ? "ongoing" : "spot";
    const start_date = String(body?.start_date ?? "").trim();

    if (!user_id || !client_id || !start_date) {
      return NextResponse.json(
        { ok: false, message: "スタッフ・派遣先・開始日は必須です" },
        { status: 400 }
      );
    }

    const end_date = String(body?.end_date ?? "").trim() || null;
    const job_content = String(body?.job_content ?? "").trim() || null;
    const rawRate = String(body?.hourly_rate ?? "").trim();
    const hourly_rate = rawRate && /^\d+$/.test(rawRate) ? Number(rawRate) : null;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("assignments")
      .insert({
        company_id: ctx.companyId,
        user_id,
        client_id,
        type,
        start_date,
        end_date,
        job_content,
        hourly_rate,
        status: "active",
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e) {
    return errorResponse(e);
  }
}

// 契約の削除（紐づくシフトはcascadeで一緒に消える）
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, message: "idが必要です" }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("assignments").delete().eq("id", id).eq("company_id", ctx.companyId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
