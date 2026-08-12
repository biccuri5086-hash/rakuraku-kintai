import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

// シフト一覧（日付の新しい順）
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("shifts")
      .select("id, assignment_id, work_date, start_time, end_time, break_minutes, status")
      .eq("company_id", ctx.companyId)
      .order("work_date", { ascending: false });
    if (error) throw error;

    return NextResponse.json({ ok: true, shifts: data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}

// シフトの新規作成
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const assignment_id = String(body?.assignment_id ?? "").trim();
    const work_date = String(body?.work_date ?? "").trim();
    if (!assignment_id || !work_date) {
      return NextResponse.json({ ok: false, message: "契約と勤務日は必須です" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // 対象の契約が自社のものか検証（他テナントの契約にシフトを付けさせない）
    const { data: assign } = await supabase
      .from("assignments")
      .select("id, company_id")
      .eq("id", assignment_id)
      .maybeSingle();
    if (!assign || assign.company_id !== ctx.companyId) {
      return NextResponse.json({ ok: false, message: "契約が見つかりません" }, { status: 400 });
    }

    const t = (v: unknown) => {
      const s = String(v ?? "").trim();
      return /^\d{2}:\d{2}$/.test(s) ? s : null;
    };
    const rawBreak = String(body?.break_minutes ?? "").trim();
    const break_minutes = rawBreak && /^\d+$/.test(rawBreak) ? Number(rawBreak) : 0;

    const { data, error } = await supabase
      .from("shifts")
      .insert({
        company_id: ctx.companyId,
        assignment_id,
        work_date,
        start_time: t(body?.start_time),
        end_time: t(body?.end_time),
        break_minutes,
        status: "planned",
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e) {
    return errorResponse(e);
  }
}
