import { NextResponse } from "next/server";
import { getSuperContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function GET() {
  try {
    const ctx = await getSuperContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const { data } = await getSupabaseAdmin()
      .from("super_admins")
      .select("id, email, full_name")
      .eq("id", ctx.superAdminId)
      .maybeSingle();

    if (!data) return NextResponse.json({ ok: false }, { status: 401 });
    return NextResponse.json({ ok: true, superAdmin: data });
  } catch (e) {
    return errorResponse(e);
  }
}
