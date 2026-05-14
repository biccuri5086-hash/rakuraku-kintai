import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const adminPass = process.env.ADMIN_PASSWORD ?? "";

  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL: {
      set: url.length > 0,
      length: url.length,
      prefix: url.slice(0, 12),
      suffix: url.slice(-12),
      hasQuotes: url.includes('"') || url.includes("'"),
      hasSpace: /\s/.test(url),
    },
    SUPABASE_SERVICE_ROLE_KEY: {
      set: key.length > 0,
      length: key.length,
      prefix: key.slice(0, 12),
      hasQuotes: key.includes('"') || key.includes("'"),
      hasSpace: /\s/.test(key),
    },
    NEXT_PUBLIC_LIFF_ID: {
      set: liffId.length > 0,
      length: liffId.length,
      value: liffId,
    },
    NEXT_PUBLIC_SUPABASE_ANON_KEY: {
      set: anonKey.length > 0,
      length: anonKey.length,
      prefix: anonKey.slice(0, 12),
    },
    ADMIN_PASSWORD: {
      set: adminPass.length > 0,
      length: adminPass.length,
    },
    nodeEnv: process.env.NODE_ENV,
    region: process.env.VERCEL_REGION ?? "(not vercel)",
  });
}
