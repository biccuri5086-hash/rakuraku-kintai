// anomaly-detection.ts の自己テスト。
// マスターキー悪用の検知ロジックなので、誤検知(見逃し)・過検知の両方を確認する。
import { findCrossCompanyActors, AuditActorRow } from "../src/lib/anomaly-detection";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}

const A = "admin-1";
const B = "admin-2";
const C1 = "company-1";
const C2 = "company-2";

// --- 正常系：1管理者=1会社なら検知しない ---
{
  const rows: AuditActorRow[] = [
    { actorId: A, actorType: "admin", companyId: C1 },
    { actorId: A, actorType: "admin", companyId: C1 },
    { actorId: B, actorType: "admin", companyId: C2 },
  ];
  ok("1管理者1会社なら異常なし", findCrossCompanyActors(rows).length === 0);
}

// --- 異常系：同じadminが複数会社にまたがる ---
{
  const rows: AuditActorRow[] = [
    { actorId: A, actorType: "admin", companyId: C1 },
    { actorId: A, actorType: "admin", companyId: C2 },
  ];
  const result = findCrossCompanyActors(rows);
  ok("複数会社にまたがるadminを検知", result.length === 1);
  ok("検知したactorIdが正しい", result[0]?.actorId === A);
  ok("検知したcompanyIdsが両方入る", JSON.stringify(result[0]?.companyIds) === JSON.stringify([C1, C2].sort()));
}

// --- super_admin/systemは対象外(設計上、複数企業を横断するのが正常) ---
{
  const rows: AuditActorRow[] = [
    { actorId: "super-1", actorType: "super_admin", companyId: C1 },
    { actorId: "super-1", actorType: "super_admin", companyId: C2 },
    { actorId: "system", actorType: "system", companyId: C1 },
    { actorId: "system", actorType: "system", companyId: C2 },
  ];
  ok("super_admin/systemは検知対象外", findCrossCompanyActors(rows).length === 0);
}

// --- company_id が null の行は無視(打刻等のstaffログや失敗ログイン等) ---
{
  const rows: AuditActorRow[] = [
    { actorId: A, actorType: "admin", companyId: null },
    { actorId: A, actorType: "admin", companyId: C1 },
  ];
  ok("company_id無しの行は無視して異常なし", findCrossCompanyActors(rows).length === 0);
}

// --- actorId が null の行は無視 ---
{
  const rows: AuditActorRow[] = [
    { actorId: null, actorType: "admin", companyId: C1 },
    { actorId: null, actorType: "admin", companyId: C2 },
  ];
  ok("actorId無しの行は無視して異常なし", findCrossCompanyActors(rows).length === 0);
}

// --- 複数adminが同時に異常な場合も全員拾う ---
{
  const rows: AuditActorRow[] = [
    { actorId: A, actorType: "admin", companyId: C1 },
    { actorId: A, actorType: "admin", companyId: C2 },
    { actorId: B, actorType: "admin", companyId: C1 },
    { actorId: B, actorType: "admin", companyId: C2 },
  ];
  ok("複数の異常なadminを両方検知", findCrossCompanyActors(rows).length === 2);
}

if (failed > 0) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log("\nanomaly_detection_selftest: all passed");
