import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { buildLedger } from "@/lib/compliance/alerts";
import type { ClientRec, AssignmentRec, StaffRec } from "@/lib/compliance/types";

// Phase C: 派遣元管理台帳（読み取り専用）。契約×スタッフの主要項目＋抵触日を一覧/CSV出力。
// テナント境界：companyId はセッションから導出。

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const format = new URL(req.url).searchParams.get("format");

    const supabase = getSupabaseAdmin();
    const [{ data: clients, error }, { data: assignments }, { data: staff }] = await Promise.all([
      supabase.from("clients").select("*").eq("company_id", ctx.companyId),
      supabase.from("assignments").select("*").eq("company_id", ctx.companyId),
      supabase.from("user_profiles").select("user_id, display_name").eq("company_id", ctx.companyId),
    ]);
    if (error) throw error;

    const rows = buildLedger(
      (clients ?? []) as ClientRec[],
      (assignments ?? []) as AssignmentRec[],
      (staff ?? []) as StaffRec[]
    );

    if (format === "csv") {
      const header = ["派遣先", "組織単位", "スタッフ", "業務内容", "契約種別", "開始日", "終了日", "個人抵触日", "事業所抵触日"];
      const lines = rows.map((r) =>
        [
          r.client_name, r.org_unit ?? "", r.staff_name, (r.job_content ?? "").replace(/[,\r\n]/g, " "),
          r.type === "ongoing" ? "中長期" : "単発", r.start_date, r.end_date ?? "",
          r.individualLimit ?? "", r.officeLimit ?? "",
        ].join(",")
      );
      const csv = "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="dispatch_ledger.csv"`,
        },
      });
    }

    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return errorResponse(e);
  }
}
