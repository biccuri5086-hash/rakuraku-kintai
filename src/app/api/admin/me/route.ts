import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getScopedSupabaseClient } from "@/lib/supabase-tenant";
import { errorResponse } from "@/lib/api-handler";

export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getScopedSupabaseClient(ctx.companyId);
    const [{ data: admin }, { data: company }, { data: settings }] = await Promise.all([
      supabase.from("admins").select("id, email, full_name, totp_secret").eq("id", ctx.adminId).maybeSingle(),
      supabase.from("companies").select("id, name, plan, status, invite_code").eq("id", ctx.companyId).maybeSingle(),
      supabase.from("tenant_settings").select("*").eq("company_id", ctx.companyId).maybeSingle(),
    ]);

    if (!admin || !company) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      admin: {
        id: admin.id,
        email: admin.email,
        full_name: admin.full_name,
        totp_enabled: !!admin.totp_secret,
      },
      company,
      settings,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
