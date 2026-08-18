// 実データ1社分の通し検証（ドッグフーディング）。
// 派遣先→契約→シフト→打刻→給与→台帳→抵触日 を、本番と同じテーブル/クエリ/集計ロジックで通す。
// 検証用の会社を作り、最後に必ず削除する（finally でクリーンアップ）。
//
// 実行：node --use-system-ca .test-build/scripts/dogfood_test.js
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { aggregatePayroll } from "../src/lib/payroll/aggregate";
import { DEFAULT_PAYROLL_SETTINGS } from "../src/lib/payroll/settings";
import type { PunchEvent } from "../src/lib/payroll/types";
import { buildLedger, computeComplianceAlerts } from "../src/lib/compliance/alerts";
import type { ClientRec, AssignmentRec, StaffRec } from "../src/lib/compliance/types";

// --- .env.local を読む（standaloneなので手動ロード） ---
function loadEnv() {
  const txt = readFileSync("./.env.local", "utf8"); // リポジトリ直下から実行する前提
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error("SUPABASE env が読めません");
const sb = createClient(url, key, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}

const MONTH = "2026-08";
const today = "2026-08-19";
const rand = Date.now().toString(36);
const staffId = `dogfood-${rand}`;
let companyId = "";

async function main() {
  console.log("=== ドッグフーディング通し検証 ===\n");

  // 1) 会社（テナント）
  const { data: co, error: coErr } = await sb.from("companies")
    .insert({ name: `【検証用】ドッグフード派遣_${rand}`, invite_code: `dog-${rand}`, plan: "standard", status: "trial" })
    .select("id").single();
  if (coErr || !co) throw new Error("company作成失敗: " + coErr?.message);
  companyId = co.id;
  console.log("会社作成 company_id=" + companyId);

  // 2) スタッフ（user_profiles）: 無期有期・社保も設定
  const { error: upErr } = await sb.from("user_profiles").insert({
    user_id: staffId, company_id: companyId, display_name: "検証太郎", full_name: "検証 太郎",
    phone: `enc-${rand}`, employment_type: "fixed", social_insurance: "enrolled",
  });
  if (upErr) throw new Error("staff作成失敗: " + upErr.message);

  // 3) 派遣先（clients）: 受入開始 2023-09-15 → 事業所抵触日 2026-09-15（warn）
  const { data: cl, error: clErr } = await sb.from("clients").insert({
    company_id: companyId, name: "検証クライアントA", dispatch_start_date: "2023-09-15",
    dispatch_manager: "派遣先 花子",
  }).select("id").single();
  if (clErr || !cl) throw new Error("client作成失敗: " + clErr?.message);
  const clientId = cl.id;

  // 4) 契約（assignments）: ongoing・開始 2023-09-15 → 個人抵触日 2026-09-15（warn）
  const { data: asg, error: asgErr } = await sb.from("assignments").insert({
    company_id: companyId, user_id: staffId, client_id: clientId, type: "ongoing",
    start_date: "2023-09-15", org_unit: "製造課", job_content: "ピッキング", hourly_rate: 1200, status: "active",
  }).select("id").single();
  if (asgErr || !asg) throw new Error("assignment作成失敗: " + asgErr?.message);
  const assignmentId = asg.id;

  // 5) シフト（8/3は休憩60分登録）
  const { error: shErr } = await sb.from("shifts").insert({
    company_id: companyId, assignment_id: assignmentId, work_date: "2026-08-03",
    start_time: "09:00", end_time: "22:30", break_minutes: 60, status: "planned",
  });
  if (shErr) throw new Error("shift作成失敗: " + shErr.message);

  // 6) 打刻（attendance）: 残業/深夜/法定休日/打刻漏れ を含むシナリオ
  const punchRows = [
    ["2026-08-03T09:00:00+09:00", "clock_in"], ["2026-08-03T22:30:00+09:00", "clock_out"], // 残業4.5h+深夜30m
    ["2026-08-04T09:00:00+09:00", "clock_in"], ["2026-08-04T18:00:00+09:00", "clock_out"], // 8h
    ["2026-08-05T09:00:00+09:00", "clock_in"],                                             // 退勤漏れ→要確認
    ["2026-08-09T10:00:00+09:00", "clock_in"], ["2026-08-09T15:00:00+09:00", "clock_out"], // 日曜=法定休日 5h
  ].map(([ts, type]) => ({ company_id: companyId, user_id: staffId, user_name: "検証 太郎", type, timestamp: ts }));
  const { error: atErr } = await sb.from("attendance").insert(punchRows);
  if (atErr) throw new Error("attendance作成失敗: " + atErr.message);

  console.log("投入完了：派遣先1・契約1・シフト1・打刻" + punchRows.length + "件\n");

  // === 読み戻し（APIと同じクエリ）===
  const monthStart = `${MONTH}-01T00:00:00+09:00`;
  const monthEnd = "2026-09-01T00:00:00+09:00";
  const [punchesR, assignsR, shiftsR, clientsR, staffR] = await Promise.all([
    sb.from("attendance").select("user_id, user_name, type, timestamp").eq("company_id", companyId).gte("timestamp", monthStart).lt("timestamp", monthEnd).order("timestamp", { ascending: true }),
    sb.from("assignments").select("*").eq("company_id", companyId),
    sb.from("shifts").select("assignment_id, work_date, break_minutes").eq("company_id", companyId).gte("work_date", `${MONTH}-01`).lt("work_date", "2026-09-01"),
    sb.from("clients").select("*").eq("company_id", companyId),
    sb.from("user_profiles").select("user_id, display_name, employment_type, social_insurance").eq("company_id", companyId),
  ]);

  // === 給与集計（preview API と同じ組み立て） ===
  const hourlyRateByUser = new Map<string, number>();
  const assignToUser = new Map<string, string>();
  for (const a of assignsR.data ?? []) {
    assignToUser.set(a.id as string, a.user_id as string);
    if (a.hourly_rate != null && !hourlyRateByUser.has(a.user_id as string)) hourlyRateByUser.set(a.user_id as string, Number(a.hourly_rate));
  }
  const shiftBreakByKey = new Map<string, number>();
  for (const sh of shiftsR.data ?? []) {
    const uid = assignToUser.get(sh.assignment_id as string);
    if (uid && sh.break_minutes != null) shiftBreakByKey.set(`${uid}|${sh.work_date}`, Number(sh.break_minutes));
  }
  const rows = aggregatePayroll({
    punches: (punchesR.data ?? []) as PunchEvent[],
    settings: DEFAULT_PAYROLL_SETTINGS,
    shiftBreakByKey,
    hourlyRateByUser,
  });
  const r = rows[0];
  console.log("--- 給与集計 ---");
  console.log("  ", JSON.stringify({ workMin: r?.workMin, overtimeMin: r?.overtimeMin, nightMin: r?.nightMin, holidayMin: r?.holidayMin, paidMin: r?.paidMin, estimatedPay: r?.estimatedPay, needsReview: r?.needsReview }));
  check("スタッフ1名が集計される", rows.length === 1, rows.length);
  check("法定内=960分(8h×2日)", r?.workMin === 960, r?.workMin);
  check("残業=270分(4.5h)", r?.overtimeMin === 270, r?.overtimeMin);
  check("深夜=30分", r?.nightMin === 30, r?.nightMin);
  check("法定休日=300分(5h)", r?.holidayMin === 300, r?.holidayMin);
  check("打刻漏れで要確認", r?.needsReview === true, r?.needsReview);
  check("概算支給額>0", (r?.estimatedPay ?? 0) > 0, r?.estimatedPay);

  // === 管理台帳（37条項目） ===
  const ledger = buildLedger((clientsR.data ?? []) as ClientRec[], (assignsR.data ?? []) as AssignmentRec[], (staffR.data ?? []) as StaffRec[]);
  const lr = ledger[0];
  console.log("--- 管理台帳 ---");
  console.log("  ", JSON.stringify({ dispatch_manager: lr?.dispatch_manager, employment_type: lr?.employment_type, social_insurance: lr?.social_insurance, individualLimit: lr?.individualLimit, officeLimit: lr?.officeLimit }));
  check("派遣先責任者が台帳に出る", lr?.dispatch_manager === "派遣先 花子", lr?.dispatch_manager);
  check("無期/有期が台帳に出る", lr?.employment_type === "fixed", lr?.employment_type);
  check("社保が台帳に出る", lr?.social_insurance === "enrolled", lr?.social_insurance);
  check("個人抵触日=2026-09-15", lr?.individualLimit === "2026-09-15", lr?.individualLimit);
  check("事業所抵触日=2026-09-15", lr?.officeLimit === "2026-09-15", lr?.officeLimit);

  // === 抵触日アラート ===
  const alerts = computeComplianceAlerts((clientsR.data ?? []) as ClientRec[], (assignsR.data ?? []) as AssignmentRec[], (staffR.data ?? []) as StaffRec[], today);
  console.log("--- 抵触日アラート ---");
  console.log("  ", JSON.stringify(alerts.map((a) => ({ scope: a.scope, level: a.level, days: a.daysRemaining }))));
  check("事業所アラートがwarn", alerts.some((a) => a.scope === "office" && a.level === "warn"), alerts);
  check("個人アラートがwarn", alerts.some((a) => a.scope === "individual" && a.level === "warn"), alerts);
}

async function cleanup() {
  if (!companyId) return;
  console.log("\n--- 後片付け（検証データ削除）---");
  const byCompany = ["paid_leave_grants", "paid_leave_takings", "compliance_settings", "compliance_acks", "payroll_exports", "timesheet_entries", "timesheets", "shifts", "assignments", "clients", "attendance", "user_profiles"];
  for (const t of byCompany) {
    const { error } = await sb.from(t).delete().eq("company_id", companyId);
    if (error) console.log("  ⚠ " + t + " 削除エラー: " + error.message);
  }
  const { error } = await sb.from("companies").delete().eq("id", companyId);
  console.log(error ? "  ⚠ companies 削除エラー: " + error.message : "  会社削除OK company_id=" + companyId);
}

main()
  .catch((e) => { console.error("実行エラー:", e.message); fail++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== 結果: ${pass} pass / ${fail} fail ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
