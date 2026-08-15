// テナント分離（マルチテナントIDOR）の静的検査。
// このプロジェクトのRLSは service_role のみ＝テナント分離はアプリ層（各APIが company_id で
// スコープすること）に依存する。1箇所でも company_id をクライアント(リクエスト)由来にしたり、
// スコープを忘れると他社データ漏洩に直結する。その最悪ケースを機械的に落とすためのガード。
//
// 検査対象：src/app/api/admin/**/route.ts
//  A) テナントテーブルを触るルートは、セッション文脈(getTenantContext/requireTenantContext)を持つ
//  B) company_id の値（.eq / insert・upsert payload）は必ずセッション由来（ctx.companyId 等）で、
//     req/searchParams/body/params/url 由来や文字列リテラルであってはならない ← 本命のIDORガード
//  C) テナントテーブルを触るのに company_id が一切現れない（スコープ忘れ）を落とす（lib委譲は許容）
//
// 実行：npm test（tsconfig.test.json でコンパイル → node で実行）。cwd はリポジトリルート。

import fs from "fs";

const ADMIN = "src/app/api/admin";
const TENANT = new Set([
  "user_profiles", "attendance", "condition_reports", "clients", "assignments", "shifts",
  "timesheets", "timesheet_entries", "payroll_exports", "company_payroll_settings",
  "compliance_acks", "company_subscription", "admin_audit_log",
]);
// セッション未確立でよいルート（認証前）
const AUTH_EXEMPT = new Set(["login", "logout"]);

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

function run(): number {
  if (!fs.existsSync(ADMIN)) {
    console.log(`skip: ${ADMIN} not found`);
    return 0;
  }
  const files = walk(ADMIN);
  const violations: string[] = [];

  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const exempt = f.split("/").some((s) => AUTH_EXEMPT.has(s));
    const hasCtx = /getTenantContext|requireTenantContext/.test(text);

    // セッション由来のテナント識別子（ctx.companyId ＋ ctx/guard.ctx から分解した companyId）
    const sessionVars = new Set<string>(["ctx.companyId"]);
    if (/\{[^}]*\bcompanyId\b[^}]*\}\s*=\s*(?:guard\.ctx|ctx)\b/.test(text) || /\bcompanyId\s*=\s*ctx\.companyId\b/.test(text)) {
      sessionVars.add("companyId");
    }

    const tables = [...text.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)].map((m) => m[1]);
    const tenantUsed = [...new Set(tables.filter((t) => TENANT.has(t)))];

    // company_id に入る値：.eq の第2引数 と insert/upsert payload の company_id キー
    const values = [
      ...[...text.matchAll(/\.eq\(\s*["'`]company_id["'`]\s*,\s*([^),]+?)\s*\)/g)].map((m) => m[1].trim()),
      ...[...text.matchAll(/\bcompany_id\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim()),
    ];
    for (const x of values) {
      const badSource = /\b(req|request|searchParams|body|params|url|input)\b/.test(x) || /^["'`]/.test(x);
      if (badSource) {
        violations.push(`${f}: company_id がリクエスト由来/リテラル → IDORリスク: ${x}`);
        continue;
      }
      if (sessionVars.has(x)) continue;
      violations.push(`${f}: company_id が非セッション識別子（ctx.companyId を使うこと）: ${x}`);
    }

    if (tenantUsed.length) {
      if (!exempt && !hasCtx) violations.push(`${f}: テナントテーブル [${tenantUsed}] を触るがセッション文脈が無い`);
      const delegates = /loadFullSettings|fullToRow/.test(text); // スコープをlibに委譲
      if (!/company_id/.test(text) && !delegates) {
        violations.push(`${f}: テナントテーブル [${tenantUsed}] を触るのに company_id スコープが無い`);
      }
    }
  }

  console.log(`checked ${files.length} admin routes`);
  if (violations.length) {
    console.log("TENANT ISOLATION VIOLATIONS:");
    for (const v of violations) console.log(" - " + v);
    return 1;
  }
  console.log("ok   すべての admin ルートがテナントキーをセッションから導出（クライアント供給の company_id なし）");
  return 0;
}

process.exit(run());
