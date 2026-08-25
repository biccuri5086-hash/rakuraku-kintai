import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { selectAdmin, MAX_LOGIN_CANDIDATES, type AdminCandidate } from "@/lib/admin-login";
import { signTenantToken, TENANT_SESSION_COOKIE, SESSION_MAX_AGE, SESSION_MAX_AGE_REMEMBERED } from "@/lib/tenant-session";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/rate-limit";
import { verifyTOTP } from "@/lib/totp";
import { checkPassword } from "@/lib/password-policy";
import { TRUST_COOKIE, TRUSTED_DEVICE_MAX_AGE, credentialFingerprint, isTrustedDevice, signTrustToken } from "@/lib/trusted-device";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";

function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return "admin:" + (fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? "unknown");
}

export async function POST(req: NextRequest) {
  try {
    const key = clientKey(req);
    const limit = await checkRateLimit(key);
    if (!limit.allowed) {
      const mins = Math.ceil(limit.resetInSec / 60);
      await logAudit(req, "admin_login_rate_limited", { remaining_sec: limit.resetInSec });
      return NextResponse.json(
        { ok: false, message: `試行回数の上限に達しました。${mins}分後にお試しください` },
        { status: 429 }
      );
    }

    let body: { email?: string; password?: string; totp?: string; companyId?: string; remember?: boolean };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const totpCode = body.totp;
    const requestedCompanyId = typeof body.companyId === "string" ? body.companyId : null;
    const remember = body.remember !== false; // 既定でこのブラウザを記憶する

    if (!email || !password) {
      return NextResponse.json({ ok: false, message: "メールとパスワードを入力してください" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    // 同じメールが複数の会社に登録されている場合があるため、1件に絞らず全件取得する。
    const { data: candidates } = await supabase
      .from("admins")
      .select("id, company_id, password_hash, totp_secret, is_active")
      .eq("email", email)
      .limit(MAX_LOGIN_CANDIDATES);

    const selection = selectAdmin((candidates ?? []) as AdminCandidate[], password, requestedCompanyId);

    if (selection.kind === "none") {
      await recordFailure(key);
      await logAudit(req, "admin_login_failure", { email });
      return NextResponse.json({ ok: false, message: "メールまたはパスワードが正しくありません" }, { status: 401 });
    }

    let admin: AdminCandidate;
    if (selection.kind === "single") {
      admin = selection.admin;
    } else {
      // パスワード照合を通った複数社の管理者が該当した。どの会社としてログインするかを選ばせる。
      // 会社名を返すのはパスワード認証を通過した後だけなので、メールアドレスからの会社の推測には使えない。
      const { data: companies } = await supabase
        .from("companies")
        .select("id, name, status")
        .in("id", selection.admins.map((a) => a.company_id));

      const usableNames = new Map(
        (companies ?? [])
          .filter((c) => c.status !== "suspended" && c.status !== "cancelled")
          .map((c) => [c.id as string, c.name as string]),
      );
      const usable = selection.admins.filter((a) => usableNames.has(a.company_id));

      if (usable.length === 0) {
        await logAudit(req, "admin_login_failure", { email, reason: "company_disabled" });
        return NextResponse.json(
          { ok: false, message: "この会社のサービスは現在ご利用いただけません" },
          { status: 403 }
        );
      }
      if (usable.length > 1) {
        await logAudit(req, "admin_login_company_select", { email, count: usable.length });
        return NextResponse.json(
          {
            ok: false,
            code: "COMPANY_SELECT",
            message: "ログインする会社を選択してください",
            companies: usable.map((a) => ({ id: a.company_id, name: usableNames.get(a.company_id) })),
          },
          { status: 401 }
        );
      }
      admin = usable[0];
    }

    const { data: company } = await supabase
      .from("companies")
      .select("status")
      .eq("id", admin.company_id)
      .maybeSingle();
    if (!company || company.status === "suspended" || company.status === "cancelled") {
      await logAudit(req, "admin_login_failure", { email, reason: "company_disabled" }, {
        actorType: "admin", actorId: admin.id, companyId: admin.company_id,
      });
      return NextResponse.json({ ok: false, message: "この会社のサービスは現在ご利用いただけません" }, { status: 403 });
    }

    // 一度6桁を通したブラウザは7日間だけ省略できる。
    // パスワードや2FAの設定が変わると指紋が変わり、記憶は自動的に無効になる。
    const fingerprint = credentialFingerprint(admin.password_hash, admin.totp_secret);
    const store = await cookies();
    const trusted =
      !!admin.totp_secret &&
      isTrustedDevice(store.get(TRUST_COOKIE.admin)?.value, "admin", admin.id, fingerprint);

    if (admin.totp_secret && !trusted) {
      if (typeof totpCode !== "string" || !totpCode) {
        return NextResponse.json(
          { ok: false, message: "認証コード（6桁）を入力してください", code: "TOTP_REQUIRED" },
          { status: 401 }
        );
      }
      if (!verifyTOTP(admin.totp_secret, totpCode)) {
        await recordFailure(key);
        await logAudit(req, "admin_login_2fa_failure", { email }, {
          actorType: "admin", actorId: admin.id, companyId: admin.company_id,
        });
        return NextResponse.json(
          { ok: false, message: "認証コードが正しくありません", code: "TOTP_INVALID" },
          { status: 401 }
        );
      }
    }

    await recordSuccess(key);
    await supabase.from("admins").update({ last_login_at: new Date().toISOString() }).eq("id", admin.id);
    if (admin.totp_secret && !trusted && remember) {
      store.set(TRUST_COOKIE.admin, signTrustToken("admin", admin.id, fingerprint), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: TRUSTED_DEVICE_MAX_AGE,
      });
    }

    await logAudit(req, "admin_login_success", { email, totp_used: !!admin.totp_secret, trusted_device: trusted }, {
      actorType: "admin", actorId: admin.id, companyId: admin.company_id,
    });

    // 「ログインしたままにする」を選んだ場合はセッションを7日保つ。
    // パスワードは保存しない。次に開いたときログイン済みとして扱うだけ。
    const sessionMaxAge = remember ? SESSION_MAX_AGE_REMEMBERED : SESSION_MAX_AGE;
    const token = signTenantToken({ adminId: admin.id, companyId: admin.company_id }, sessionMaxAge);
    store.set(TENANT_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: sessionMaxAge,
    });

    // いま入力されたパスワードが今の条件を満たしているかを見る。
    // 満たしていない既存利用者は締め出さず、ログイン後に変更を促す。
    const passwordNeedsUpdate = !checkPassword(password, { email: email }).ok;

    return NextResponse.json({ ok: true, passwordNeedsUpdate });
  } catch (e) {
    return errorResponse(e);
  }
}
