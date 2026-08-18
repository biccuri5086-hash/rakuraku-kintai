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
    const [{ data: clients, error }, { data: assignments }, { data: staff }, settingsRes] = await Promise.all([
      supabase.from("clients").select("*").eq("company_id", ctx.companyId),
      supabase.from("assignments").select("*").eq("company_id", ctx.companyId),
      supabase.from("user_profiles").select("user_id, display_name, employment_type, social_insurance").eq("company_id", ctx.companyId),
      supabase.from("compliance_settings").select("agency_manager, complaint_contact, wage_method").eq("company_id", ctx.companyId).maybeSingle(),
    ]);
    if (error) throw error;

    // 会社単位の記載事項（テーブル未適用でも動く）
    const cs = (settingsRes && !settingsRes.error ? settingsRes.data : null) as
      | { agency_manager: string | null; complaint_contact: string | null; wage_method: string | null }
      | null;

    const rows = buildLedger(
      (clients ?? []) as ClientRec[],
      (assignments ?? []) as AssignmentRec[],
      (staff ?? []) as StaffRec[]
    );

    if (format === "csv") {
      const emp = (v: string | null) => (v === "indefinite" ? "無期" : v === "fixed" ? "有期" : "");
      const soc = (v: string | null) =>
        v === "enrolled" ? "加入" : v === "not_enrolled" ? "未加入" : v === "exempt" ? "対象外" : "";
      const wage = cs?.wage_method === "roushi" ? "労使協定方式" : cs?.wage_method === "kinto" ? "均等均衡方式" : "";
      const clean = (s: string) => s.replace(/[,\r\n]/g, " ");
      const header = [
        "派遣先", "派遣先責任者", "組織単位", "スタッフ", "無期/有期", "社会保険", "業務内容", "契約種別",
        "開始日", "終了日", "個人抵触日", "事業所抵触日", "派遣元責任者", "待遇決定方式", "苦情申出先",
      ];
      const lines = rows.map((r) =>
        [
          r.client_name, r.dispatch_manager ?? "", r.org_unit ?? "", r.staff_name,
          emp(r.employment_type), soc(r.social_insurance), clean(r.job_content ?? ""),
          r.type === "ongoing" ? "中長期" : "単発", r.start_date, r.end_date ?? "",
          r.individualLimit ?? "", r.officeLimit ?? "",
          clean(cs?.agency_manager ?? ""), wage, clean(cs?.complaint_contact ?? ""),
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

    return NextResponse.json({ ok: true, rows, settings: cs });
  } catch (e) {
    return errorResponse(e);
  }
}
