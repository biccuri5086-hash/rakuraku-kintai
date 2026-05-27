import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { decryptPhone } from "@/lib/crypto";
import { jstToday, jstDayBounds } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";

type AttendanceRow = {
  id: string;
  user_id: string;
  user_name: string;
  type: "clock_in" | "clock_out";
  timestamp: string;
};

type ConditionRow = {
  id: string;
  user_id: string;
  score: number;
  comment: string | null;
  reported_at: string;
};

type UserSummary = {
  user_id: string;
  user_name: string;
  full_name: string | null;
  phone: string | null;
  clockIn: string | null;
  clockOut: string | null;
  condition: ConditionRow | null;
};

export async function GET(req: NextRequest) {
  try {
    const guard = await requireTenantContext();
    if (guard.error) return guard.error;
    const { adminId, companyId } = guard.ctx;

    const date = new URL(req.url).searchParams.get("date") ?? jstToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, message: "日付形式が不正" }, { status: 400 });
    }

    await logAudit(req, "admin_dashboard_view", { date }, {
      actorType: "admin", actorId: adminId, companyId,
    });

    const { start, end } = jstDayBounds(date);
    const supabase = getSupabaseAdmin();
    const [{ data: attendance }, { data: conditions }, { data: profiles }] = await Promise.all([
      supabase
        .from("attendance")
        .select("id, user_id, user_name, type, timestamp")
        .eq("company_id", companyId)
        .gte("timestamp", start)
        .lte("timestamp", end)
        .order("timestamp", { ascending: true }),
      supabase
        .from("condition_reports")
        .select("id, user_id, score, comment, reported_at")
        .eq("company_id", companyId)
        .gte("reported_at", start)
        .lte("reported_at", end)
        .order("reported_at", { ascending: false }),
      supabase
        .from("user_profiles")
        .select("user_id, display_name, full_name, phone")
        .eq("company_id", companyId),
    ]);

    const profileMap = new Map<string, { display_name: string; full_name: string | null; phone: string | null }>();
    for (const p of (profiles ?? []) as { user_id: string; display_name: string; full_name: string | null; phone: string | null }[]) {
      profileMap.set(p.user_id, {
        display_name: p.display_name,
        full_name: p.full_name,
        phone: p.phone ? decryptPhone(p.phone) : null,
      });
    }

    const userMap = new Map<string, UserSummary>();
    for (const row of (attendance as AttendanceRow[]) ?? []) {
      if (!userMap.has(row.user_id)) {
        const prof = profileMap.get(row.user_id);
        userMap.set(row.user_id, {
          user_id: row.user_id,
          user_name: row.user_name,
          full_name: prof?.full_name ?? null,
          phone: prof?.phone ?? null,
          clockIn: null,
          clockOut: null,
          condition: null,
        });
      }
      const u = userMap.get(row.user_id)!;
      if (row.type === "clock_in" && !u.clockIn) u.clockIn = row.timestamp;
      if (row.type === "clock_out") u.clockOut = row.timestamp;
    }

    for (const c of (conditions as ConditionRow[]) ?? []) {
      const u = userMap.get(c.user_id);
      if (u && !u.condition) u.condition = c;
    }

    return NextResponse.json({ ok: true, users: Array.from(userMap.values()) });
  } catch (e) {
    return errorResponse(e);
  }
}
