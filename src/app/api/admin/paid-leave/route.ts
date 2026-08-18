import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstToday } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";
import { activeGrantedDays, takenDays, remainingDays, nextExpiry as nextExpiryOf } from "@/lib/paid-leave/balance";

type Grant = { id: string; user_id: string; granted_days: number; grant_date: string; expires_on: string; note: string | null };
type Taking = { id: string; user_id: string; taken_date: string; days: number; note: string | null };

// 有給の残高一覧（スタッフ別）＋履歴。
// 残(有効) = Σ(失効していない付与) − Σ(取得)。失効消化の厳密な充当は行わない管理補助。
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const today = jstToday();

    const [grantsRes, takingsRes, profilesRes] = await Promise.all([
      supabase.from("paid_leave_grants").select("id, user_id, granted_days, grant_date, expires_on, note").eq("company_id", ctx.companyId),
      supabase.from("paid_leave_takings").select("id, user_id, taken_date, days, note").eq("company_id", ctx.companyId),
      supabase.from("user_profiles").select("user_id, display_name, full_name").eq("company_id", ctx.companyId),
    ]);

    // テーブル未適用（マイグレーション反映前）でも画面を壊さない
    if (grantsRes.error || takingsRes.error) {
      return NextResponse.json({ ok: true, ready: false, rows: [] });
    }

    const grants = (grantsRes.data ?? []) as Grant[];
    const takings = (takingsRes.data ?? []) as Taking[];
    const nameOf = new Map<string, string>();
    for (const p of profilesRes.data ?? []) nameOf.set(p.user_id, p.full_name || p.display_name || p.user_id);

    // 対象ユーザー = 付与/取得のいずれかがある人
    const userIds = new Set<string>();
    for (const g of grants) userIds.add(g.user_id);
    for (const t of takings) userIds.add(t.user_id);

    const rows = [...userIds].map((uid) => {
      const gs = grants.filter((g) => g.user_id === uid).sort((a, b) => b.grant_date.localeCompare(a.grant_date));
      const ts = takings.filter((t) => t.user_id === uid).sort((a, b) => b.taken_date.localeCompare(a.taken_date));
      return {
        user_id: uid,
        staff_name: nameOf.get(uid) ?? uid,
        grantedActive: activeGrantedDays(gs, today),
        takenTotal: takenDays(ts),
        remaining: remainingDays(gs, ts, today),
        nextExpiry: nextExpiryOf(gs, today),
        grants: gs,
        takings: ts,
      };
    });
    rows.sort((a, b) => a.staff_name.localeCompare(b.staff_name, "ja"));

    return NextResponse.json({ ok: true, ready: true, today, rows });
  } catch (e) {
    return errorResponse(e);
  }
}

// 付与 or 取得の登録
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const user_id = String(body?.user_id ?? "").trim();
    if (!user_id) return NextResponse.json({ ok: false, message: "スタッフを選択してください" }, { status: 400 });

    const supabase = getSupabaseAdmin();

    if (action === "grant") {
      const granted_days = Number(body?.granted_days);
      if (!Number.isFinite(granted_days) || granted_days <= 0) {
        return NextResponse.json({ ok: false, message: "付与日数を正しく入力してください" }, { status: 400 });
      }
      const grant_date = String(body?.grant_date ?? "").trim() || jstToday();
      // 失効日：指定が無ければ付与日+2年（労基法の時効）
      let expires_on = String(body?.expires_on ?? "").trim();
      if (!expires_on) {
        const d = new Date(`${grant_date}T00:00:00+09:00`);
        d.setFullYear(d.getFullYear() + 2);
        expires_on = d.toISOString().slice(0, 10);
      }
      const { error } = await supabase.from("paid_leave_grants").insert({
        company_id: ctx.companyId, user_id, granted_days, grant_date, expires_on,
        note: String(body?.note ?? "").trim() || null, created_by: ctx.adminId,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "take") {
      const days = Number(body?.days);
      if (days !== 0.5 && days !== 1) {
        return NextResponse.json({ ok: false, message: "取得は1日または半日(0.5)です" }, { status: 400 });
      }
      const taken_date = String(body?.taken_date ?? "").trim() || jstToday();
      const { error } = await supabase.from("paid_leave_takings").insert({
        company_id: ctx.companyId, user_id, taken_date, days,
        note: String(body?.note ?? "").trim() || null, created_by: ctx.adminId,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, message: "不正な操作です" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

// 付与 or 取得の削除（?type=grant|taking&id=...）
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id");
    if (!id || (type !== "grant" && type !== "taking")) {
      return NextResponse.json({ ok: false, message: "type と id を指定してください" }, { status: 400 });
    }
    const table = type === "grant" ? "paid_leave_grants" : "paid_leave_takings";
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from(table).delete().eq("id", id).eq("company_id", ctx.companyId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
