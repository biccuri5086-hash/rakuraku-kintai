import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyToken } from "@/lib/admin-session";
import { generateSecret, buildOtpAuthUrl, isTotpEnabled, verifyTOTP } from "@/lib/totp";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!verifyToken(token)) {
      return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    }

    await logAudit(req, "admin_2fa_setup_view");

    const enabled = isTotpEnabled();
    const newSecret = generateSecret();
    const otpauthUrl = buildOtpAuthUrl(newSecret, "admin", "RakurakuKintai");

    return NextResponse.json({
      ok: true,
      currentlyEnabled: enabled,
      newSecret,
      otpauthUrl,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!verifyToken(token)) {
      return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    }

    let body: { secret?: string; code?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    if (!body.secret || !body.code) {
      return NextResponse.json({ ok: false, message: "secret と code が必要です" }, { status: 400 });
    }

    const valid = verifyTOTP(body.secret, body.code);
    return NextResponse.json({ ok: true, valid });
  } catch (e) {
    return errorResponse(e);
  }
}
