import { NextRequest, NextResponse } from "next/server";
import { requireSuperContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";

const VALID_PLANS = ["standard", "pro", "enterprise"] as const;
const VALID_STATUSES = ["active", "trial", "suspended", "cancelled"] as const;

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ ok: false, message: "不正なID" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const [{ data: company }, { data: settings }, { data: admins }] = await Promise.all([
      supabase.from("companies").select("*").eq("id", id).maybeSingle(),
      supabase.from("tenant_settings").select("*").eq("company_id", id).maybeSingle(),
      supabase
        .from("admins")
        .select("id, email, full_name, is_active, last_login_at, created_at")
        .eq("company_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (!company) return NextResponse.json({ ok: false, message: "見つかりません" }, { status: 404 });

    const { count: staffCount } = await supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("company_id", id);

    return NextResponse.json({
      ok: true,
      company: { ...company, staff_count: staffCount ?? 0 },
      settings,
      admins: admins ?? [],
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ ok: false, message: "不正なID" }, { status: 400 });

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

    const update: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
    if (typeof body.plan === "string" && VALID_PLANS.includes(body.plan as (typeof VALID_PLANS)[number])) update.plan = body.plan;
    if (typeof body.status === "string" && VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) update.status = body.status;
    if (typeof body.contact_name === "string")  update.contact_name = body.contact_name.trim() || null;
    if (typeof body.contact_email === "string") update.contact_email = body.contact_email.trim() || null;
    if (typeof body.contact_phone === "string") update.contact_phone = body.contact_phone.trim() || null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: false, message: "更新内容がありません" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("companies")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    await logAudit(req, "super_company_update", update, {
      actorType: "super_admin", actorId: guard.ctx.superAdminId, companyId: id,
    });

    return NextResponse.json({ ok: true, company: data });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ ok: false, message: "不正なID" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: company } = await supabase.from("companies").select("name").eq("id", id).maybeSingle();
    if (!company) return NextResponse.json({ ok: false, message: "見つかりません" }, { status: 404 });

    await logAudit(req, "super_company_delete", { name: company.name }, {
      actorType: "super_admin", actorId: guard.ctx.superAdminId, companyId: id,
    });

    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
