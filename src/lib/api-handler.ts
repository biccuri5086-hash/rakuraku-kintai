import { NextResponse } from "next/server";

export function errorResponse(e: unknown, fallbackStatus = 500) {
  const name = e instanceof Error ? e.name : "Error";
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json(
    { ok: false, error: "server_error", name, message },
    { status: fallbackStatus }
  );
}
