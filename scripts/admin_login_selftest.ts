// 管理者ログインの候補選択の自己テスト。
// とくに「同じメールが複数の会社に登録されているとログインできない」不具合の再発を防ぐ。
import { selectAdmin, AdminCandidate } from "../src/lib/admin-login";
import { hashPassword } from "../src/lib/password";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const PW = "Correct-Horse-1!";
const OTHER_PW = "Another-Pass-2?";

const admin = (over: Partial<AdminCandidate> & { password: string }): AdminCandidate => ({
  id: over.id ?? "a1",
  company_id: over.company_id ?? "c1",
  password_hash: hashPassword(over.password),
  totp_secret: over.totp_secret ?? null,
  is_active: over.is_active ?? true,
});

// --- 1社だけの通常ケース ---
{
  const rows = [admin({ password: PW })];
  eq("1社: 正しいPWで単一に解決", selectAdmin(rows, PW).kind, "single");
  eq("1社: 誤ったPWは拒否", selectAdmin(rows, "wrong").kind, "none");
  eq("1社: 空PWは拒否", selectAdmin(rows, "").kind, "none");
}

// --- 無効化されたアカウント ---
{
  const rows = [admin({ password: PW, is_active: false })];
  eq("is_active=false は正しいPWでも拒否", selectAdmin(rows, PW).kind, "none");
}

// --- 2社兼任：修正前はここでログイン不能になっていた ---
{
  const rows = [
    admin({ id: "a1", company_id: "c1", password: PW }),
    admin({ id: "a2", company_id: "c2", password: PW }),
  ];
  const r = selectAdmin(rows, PW);
  eq("2社兼任(同一PW): 会社選択が必要", r.kind, "ambiguous");
  eq("2社兼任(同一PW): 候補は2件", r.kind === "ambiguous" ? r.admins.length : -1, 2);
  eq("2社兼任: 誤ったPWは拒否", selectAdmin(rows, "wrong").kind, "none");
}

// --- 2社兼任だがパスワードが違う：曖昧にならない ---
{
  const rows = [
    admin({ id: "a1", company_id: "c1", password: PW }),
    admin({ id: "a2", company_id: "c2", password: OTHER_PW }),
  ];
  const r = selectAdmin(rows, OTHER_PW);
  eq("2社兼任(別PW): 一致した1件に解決", r.kind, "single");
  eq("2社兼任(別PW): 正しい会社が選ばれる", r.kind === "single" ? r.admin.company_id : "", "c2");
}

// --- 会社を指定して2回目の送信をした場合 ---
{
  const rows = [
    admin({ id: "a1", company_id: "c1", password: PW }),
    admin({ id: "a2", company_id: "c2", password: PW }),
  ];
  const r = selectAdmin(rows, PW, "c2");
  eq("会社指定: 単一に解決", r.kind, "single");
  eq("会社指定: 指定した会社になる", r.kind === "single" ? r.admin.id : "", "a2");
  eq("会社指定: 無関係な会社IDは拒否", selectAdmin(rows, PW, "c9").kind, "none");
  eq("会社指定: 会社が合ってもPWが違えば拒否", selectAdmin(rows, "wrong", "c2").kind, "none");
}

// --- 2社のうち片方だけ無効 ---
{
  const rows = [
    admin({ id: "a1", company_id: "c1", password: PW, is_active: false }),
    admin({ id: "a2", company_id: "c2", password: PW }),
  ];
  const r = selectAdmin(rows, PW);
  eq("片方無効: 有効な1件に解決", r.kind, "single");
  eq("片方無効: 有効な方が選ばれる", r.kind === "single" ? r.admin.id : "", "a2");
}

// --- 該当なし ---
{
  eq("候補0件: 拒否", selectAdmin([], PW).kind, "none");
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
