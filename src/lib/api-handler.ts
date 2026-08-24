import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

// 例外を API レスポンスに変換する。
//
// 本番では例外の name / message をクライアントに返さない。
// これらには接続先 Supabase の URL やテーブル名・カラム名・制約名が混ざるため、
// 攻撃者に内部構造を教えてしまう（例：supabase-admin.ts の env バリデーション例外）。
// 障害調査に必要な情報は Sentry とサーバーログに残す。
export function errorResponse(e: unknown, fallbackStatus = 500) {
  const name = e instanceof Error ? e.name : "Error";
  const message = e instanceof Error ? e.message : String(e);

  Sentry.captureException(e);
  console.error(`[api] ${name}: ${message}`);

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "server_error", message: "サーバーエラーが発生しました。時間をおいてお試しください。" },
      { status: fallbackStatus }
    );
  }

  // 開発・プレビューでは原因が分かるように詳細を返す
  return NextResponse.json(
    { ok: false, error: "server_error", name, message },
    { status: fallbackStatus }
  );
}
