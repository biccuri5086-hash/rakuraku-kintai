import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { findCrossCompanyActors } from "@/lib/anomaly-detection";
import { requireInternalCronSecret, timingSafeTokenEquals } from "@/lib/security-guard";

// マスターキー(service_role)漏洩・悪用の早期検知バッチ。
// .github/workflows/anomaly-check.yml から定期的に叩かれる(health-check.ymlと同じ形)。
// GitHub Actions以外(ブラウザ・外部)から叩けないよう、共有シークレットで保護する。
//
// このルート自体は admin_audit_log を全社横断で読む必要がある(異常が無いかの監視という
// 目的上、company_idで絞ってはいけない)。service_role の正当な用途の一つ。
export const dynamic = "force-dynamic";

const WINDOW_MINUTES = 70; // 1時間おきの実行に対し、遅延・重複実行を吸収する余裕を持たせる

function isAuthorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided) return false;
  let expected: string;
  try {
    expected = requireInternalCronSecret(process.env.INTERNAL_CRON_SECRET);
  } catch {
    return false; // シークレット自体が未設定/弱い場合はフェイルクローズ(常に401)
  }
  return timingSafeTokenEquals(provided, expected);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }

  try {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await getSupabaseAdmin()
      .from("admin_audit_log")
      .select("actor_id, actor_type, company_id")
      .eq("actor_type", "admin")
      .gte("created_at", since);
    if (error) throw error;

    const anomalies = findCrossCompanyActors(
      (data ?? []).map((r) => ({
        actorId: r.actor_id as string | null,
        actorType: r.actor_type as string | null,
        companyId: r.company_id as string | null,
      }))
    );

    if (anomalies.length > 0) {
      Sentry.captureMessage(
        `[anomaly] 同一admin(${anomalies.map((a) => a.actorId).join(", ")})が直近${WINDOW_MINUTES}分で複数companyにまたがって操作しています。service_role漏洩またはセッション不具合の疑いがあります。`,
        "error"
      );
    }

    return NextResponse.json({
      ok: true,
      windowMinutes: WINDOW_MINUTES,
      checkedAt: new Date().toISOString(),
      anomalies,
    });
  } catch (e) {
    Sentry.captureException(e);
    return NextResponse.json({ ok: false, message: "check_failed" }, { status: 500 });
  }
}
