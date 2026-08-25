// 管理者ログインで「どの管理者アカウントとしてログインさせるか」を決める。
//
// admins は unique(company_id, email) なので、同じメールアドレスが複数の会社に
// 存在しうる（担当者が2社を兼任する、など）。にもかかわらずログインAPIが
// メールアドレスだけで1件に絞り込もうとしていたため、該当が2件以上あると
// 検索自体が失敗し、パスワードが正しくてもログインできない状態になっていた。
//
// ここでは候補を配列で受け取り、パスワード照合の結果で絞る。
// 複数一致した場合は呼び出し側に会社選択をさせる（ambiguous）。
import { verifyPassword } from "./password";

export type AdminCandidate = {
  id: string;
  company_id: string;
  password_hash: string;
  totp_secret: string | null;
  is_active: boolean;
};

export type AdminSelection =
  | { kind: "none" }
  | { kind: "single"; admin: AdminCandidate }
  | { kind: "ambiguous"; admins: AdminCandidate[] };

// 1メールアドレスあたりの照合上限。scrypt は1回あたり数十ミリ秒かかるため、
// 候補が異常に多い場合に照合コストが膨らむのを防ぐ。
export const MAX_LOGIN_CANDIDATES = 20;

export function selectAdmin(
  candidates: AdminCandidate[],
  password: string,
  companyId?: string | null,
  verify: (plain: string, stored: string) => boolean = verifyPassword,
): AdminSelection {
  const scoped = candidates
    .filter((a) => a.is_active)
    .filter((a) => !companyId || a.company_id === companyId)
    .slice(0, MAX_LOGIN_CANDIDATES);

  const matched = scoped.filter((a) => verify(password, a.password_hash));

  if (matched.length === 0) return { kind: "none" };
  if (matched.length === 1) return { kind: "single", admin: matched[0] };
  return { kind: "ambiguous", admins: matched };
}
