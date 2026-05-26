import { NextRequest, NextResponse } from "next/server";
import { requireSuperContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";
import crypto from "node:crypto";

const VALID_PLANS = ["standard", "pro", "enterprise"] as const;
const VALID_STATUSES = ["active", "trial", "suspended", "cancelled"] as const;

function generateInviteCode(): string {
  return crypto.randomBytes(9).toString("base64url").toUpperCase();
}

export async function GET() {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;

    const supabase = getSupabaseAdmin();
    const { data: companies, error } = await supabase
      .from("companies")
      .select("id, name, invite_code, plan, status, trial_ends_at, contact_name, contact_email, contact_phone, created_at")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const ids = (companies ?? []).map((c) => c.id);
    const { data: counts } = await supabase
      .from("user_profiles")
      .select("company_id")
      .in("company_id", ids);

    const countMap = new Map<string, number>();
    for (const row of counts ?? []) {
      countMap.set(row.company_id, (countMap.get(row.company_id) ?? 0) + 1);
    }

    const enriched = (companies ?? []).map((c) => ({
      ...c,
      staff_count: countMap.get(c.id) ?? 0,
    }));

    return NextResponse.json({ ok: true, companies: enriched });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;

    let body: {
      name?: string;
      plan?: string;
      status?: string;
      contact_name?: string;
      contact_email?: string;
      contact_phone?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const name = (body.name ?? "").trim();
    if (!name || name.length > 100) {
      return NextResponse.json({ ok: false, message: "会社名を1〜100文字で入力してください" }, { status: 400 });
    }
    const plan = VALID_PLANS.includes(body.plan as (typeof VALID_PLANS)[number]) ? body.plan : "standard";
    const status = VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number]) ? body.status : "trial";

    const supabase = getSupabaseAdmin();
    const inviteCode = generateInviteCode();

    const { data: company, error } = await supabase
      .from("companies")
      .insert({
        name,
        invite_code: inviteCode,
        plan,
        status,
        trial_ends_at: status === "trial" ? new Date(Date.now() + 30 * 86400000).toISOString() : null,
        contact_name: (body.contact_name ?? "").trim() || null,
        contact_email: (body.contact_email ?? "").trim() || null,
        contact_phone: (body.contact_phone ?? "").trim() || null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    await supabase.from("tenant_settings").insert({
      company_id: company.id,
      feature_condition: true,
      feature_gps: true,
      feature_alert: plan !== "standard",
      feature_monthly_report: plan !== "standard",
      feature_multi_site: plan === "enterprise",
      feature_ai_risk_score: plan === "enterprise",
    });

    await logAudit(req, "super_company_create", { name, plan }, {
      actorType: "super_admin",
      actorId: guard.ctx.superAdminId,
      companyId: company.id,
    });

    return NextResponse.json({ ok: true, company });
  } catch (e) {
    return errorResponse(e);
  }
}
