// マスターキー(service_role)漏洩・悪用の早期検知。
//
// 正規の管理者セッションは、ログイン時に1つのcompany_idに固定される(tenant-session.ts)。
// したがって admin_audit_log 上で「同じ actor_id (admin) が、短時間のうちに複数の
// company_id にまたがって操作している」状態は、通常の使い方では起こり得ない。
// これが起きているとしたら、以下のいずれかが疑われる:
//   - service_role(万能キー)が漏れて、アプリを経由せず/経由して他社データを触られた
//   - セッション/company_idの発行ロジックにバグがある
// 「侵入そのものを防ぐ」対策ではなく、「気づくまでの時間を短くする」ための検知。
//
// actor_type='admin'のみを対象にする(super_admin/systemは設計上複数企業を横断するのが正常なため)。

export type AuditActorRow = {
  actorId: string | null;
  actorType: string | null;
  companyId: string | null;
};

export type CrossCompanyAnomaly = {
  actorId: string;
  companyIds: string[];
};

export function findCrossCompanyActors(rows: AuditActorRow[]): CrossCompanyAnomaly[] {
  const byActor = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.actorType !== "admin") continue;
    if (!row.actorId || !row.companyId) continue;
    const set = byActor.get(row.actorId) ?? new Set<string>();
    set.add(row.companyId);
    byActor.set(row.actorId, set);
  }

  const anomalies: CrossCompanyAnomaly[] = [];
  for (const [actorId, companyIds] of byActor) {
    if (companyIds.size >= 2) {
      anomalies.push({ actorId, companyIds: [...companyIds].sort() });
    }
  }
  return anomalies.sort((a, b) => a.actorId.localeCompare(b.actorId));
}
