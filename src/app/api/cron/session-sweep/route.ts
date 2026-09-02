import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { sweepExpiredSessions } from "@/lib/server-session";
import { errorResponse } from "@/lib/api-handler";

// 期限切れ・失効済みセッション行の定期スイープ。
// Vercel Cron から日次で叩かれる（vercel.json の crons）。
// CRON_SECRET を設定しておくと Vercel が Authorization: Bearer <CRON_SECRET> を付与する。
// 未設定なら実行しない（フェイルクローズ）＝公開エンドポイントとして無防備に走らせない。
function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ ok: false, message: "CRON_SECRET is not configured" }, { status: 503 });
    }
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!token || !timingSafeEqual(token, secret)) {
      return NextResponse.json({ ok: false, message: "unauthorized" }, { status: 401 });
    }

    const deleted = await sweepExpiredSessions();
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    return errorResponse(e);
  }
}
