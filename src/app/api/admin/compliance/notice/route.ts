import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstToday } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";
import { officeLimit, individualLimitDate } from "@/lib/compliance/alerts";
import type { ClientRec, AssignmentRec } from "@/lib/compliance/types";

// Phase C: 抵触日通知書（参考様式）の生成。指定した派遣先の事業所抵触日・個人抵触日を印刷用HTMLで返す。
// 読み取り専用・マイグレーション不要。テナント境界：companyId はセッションから導出。
// ※ これはシステム算出の参考様式。正式な様式・記載は社労士確認が前提。

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const clientId = new URL(req.url).searchParams.get("client_id");
    if (!clientId) return NextResponse.json({ ok: false, message: "client_id 必須" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const [{ data: clients, error }, { data: assignments }, { data: staff }, { data: company }] = await Promise.all([
      supabase.from("clients").select("*").eq("company_id", ctx.companyId),
      supabase.from("assignments").select("*").eq("company_id", ctx.companyId),
      supabase.from("user_profiles").select("user_id, display_name").eq("company_id", ctx.companyId),
      supabase.from("companies").select("name").eq("id", ctx.companyId).maybeSingle(),
    ]);
    if (error) throw error;

    const client = (clients ?? []).find((c) => (c as ClientRec).id === clientId) as ClientRec | undefined;
    if (!client) return NextResponse.json({ ok: false, message: "派遣先が見つかりません" }, { status: 404 });

    const staffName = new Map<string, string>();
    for (const s of staff ?? []) staffName.set(s.user_id as string, (s.display_name as string) ?? (s.user_id as string));

    const office = officeLimit(client);

    // 当該派遣先の個人抵触日（スタッフ×組織単位）
    const groups = new Map<string, AssignmentRec[]>();
    for (const a of (assignments ?? []) as AssignmentRec[]) {
      if (a.type !== "ongoing" || a.client_id !== clientId) continue;
      const key = `${a.user_id}|${a.org_unit ?? ""}`;
      const arr = groups.get(key);
      if (arr) arr.push(a);
      else groups.set(key, [a]);
    }
    const indRows = [...groups.entries()]
      .map(([key, g]) => {
        const calc = individualLimitDate(g);
        const [uid, org] = key.split("|");
        return { staff: staffName.get(uid) ?? uid, org, limit: calc?.limit ?? null, start: calc?.start ?? null };
      })
      .sort((a, b) => a.staff.localeCompare(b.staff, "ja"));

    const companyName = (company as { name?: string } | null)?.name ?? "（派遣元事業主）";
    const today = jstToday();

    const indTable = indRows.length
      ? indRows.map((r) => `<tr><td>${esc(r.staff)}</td><td>${esc(r.org || "—")}</td><td>${esc(r.start ?? "—")}</td><td class="d">${esc(r.limit ?? "—")}</td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">対象となる中長期派遣のスタッフはいません</td></tr>`;

    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>抵触日通知書 - ${esc(client.name)}</title>
<style>
  body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;color:#1a1a1a;margin:0;background:#f3f4f6}
  .sheet{max-width:800px;margin:24px auto;background:#fff;padding:48px 56px;box-shadow:0 1px 4px rgba(0,0,0,.1)}
  h1{font-size:20px;text-align:center;letter-spacing:.1em;margin:0 0 4px}
  .sub{text-align:center;color:#555;font-size:12px;margin-bottom:28px}
  .meta{display:flex;justify-content:space-between;font-size:13px;margin-bottom:20px}
  .to{font-size:15px;font-weight:bold;margin:18px 0 6px}
  .from{text-align:right;font-size:13px;margin:6px 0 24px}
  p.lead{font-size:13.5px;line-height:1.9}
  .box{border:1px solid #333;border-radius:6px;padding:14px 18px;margin:18px 0}
  .box .lbl{font-size:12px;color:#555}
  .box .val{font-size:22px;font-weight:bold;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  th,td{border:1px solid #ccc;padding:8px 10px;text-align:left}
  th{background:#f5f5f5;font-size:12px}
  td.d{font-weight:bold} .muted{color:#999;text-align:center}
  .note{font-size:11px;color:#888;margin-top:26px;line-height:1.7;border-top:1px dashed #ccc;padding-top:12px}
  .print{max-width:800px;margin:0 auto 24px;text-align:right}
  .print button{font:inherit;font-size:13px;padding:8px 16px;border:0;border-radius:8px;background:#06C755;color:#fff;cursor:pointer}
  @media print{.print{display:none}body{background:#fff}.sheet{box-shadow:none;margin:0}}
</style></head><body>
<div class="print"><button onclick="window.print()">印刷 / PDF保存</button></div>
<div class="sheet">
  <h1>派遣可能期間の制限に関する通知書（抵触日通知）</h1>
  <div class="sub">労働者派遣法に基づく期間制限（事業所単位・個人単位）の通知（参考様式）</div>
  <div class="meta"><span>発行日：${esc(today)}</span><span>文書番号：（　　　　）</span></div>

  <div class="to">${esc(client.name)}　御中</div>
  <p class="lead">貴社への労働者派遣に関し、労働者派遣法に定める派遣可能期間の制限（抵触日）について、下記のとおり通知いたします。</p>

  <div class="box">
    <div class="lbl">事業所単位の抵触日（${esc(office.basis)}）</div>
    <div class="val">${esc(office.date ?? "未設定（受入開始日または抵触日の登録が必要）")}</div>
  </div>

  <div class="lbl" style="font-size:13px;font-weight:bold;margin-top:20px">個人単位の抵触日（派遣労働者ごと）</div>
  <table>
    <thead><tr><th>派遣労働者</th><th>組織単位</th><th>派遣開始</th><th>個人抵触日</th></tr></thead>
    <tbody>${indTable}</tbody>
  </table>

  <div class="from">派遣元事業主：${esc(companyName)}<br>派遣元責任者：（　　　　　　　）</div>

  <div class="note">
    ※ 本書はラクラク勤怠が登録データから算出した<strong>参考様式</strong>です。事業所抵触日は「延長後＞派遣先設定＞受入開始日＋3年」の順で、
    個人抵触日はクーリング期間（3ヶ月超の空白でリセット）を考慮して算出しています。<br>
    ※ 正式な様式・記載事項（派遣元責任者名・押印・意見聴取手続き等）および内容の妥当性は、<strong>有資格の社会保険労務士の確認</strong>を受けてください。
  </div>
</div>
</body></html>`;

    return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return errorResponse(e);
  }
}
