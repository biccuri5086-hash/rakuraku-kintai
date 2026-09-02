import { NextRequest } from "next/server";

export type LineUser = {
  userId: string;
  displayName: string;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { user: LineUser; expiresAt: number }>();

async function verifyAccessToken(accessToken: string): Promise<LineUser | null> {
  const cached = cache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  try {
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!profileRes.ok) return null;
    const profile = (await profileRes.json()) as { userId: string; displayName: string };

    // トークン混同攻撃(別のLINEアプリで取得した任意トークンでの通過)を防ぐため、
    // access_token が本アプリのチャネルに発行されたものか必ず検証する。
    // LINE_CHANNEL_ID 未設定なら検証不能＝フェイルクローズ（認証拒否）する。
    const expectedChannelId = process.env.LINE_CHANNEL_ID;
    if (!expectedChannelId) {
      console.error("[security] LINE_CHANNEL_ID is not configured; rejecting LINE auth (fail-closed)");
      return null;
    }
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" }
    );
    if (!verifyRes.ok) return null;
    const verifyData = (await verifyRes.json()) as { client_id?: string };
    if (verifyData.client_id !== expectedChannelId) return null;

    const user: LineUser = { userId: profile.userId, displayName: profile.displayName };
    cache.set(accessToken, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    return user;
  } catch {
    return null;
  }
}

export async function requireLineUser(req: NextRequest): Promise<LineUser | null> {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  return verifyAccessToken(token);
}

export type AuthError = "NO_TOKEN" | "INVALID_TOKEN";

export async function requireLineUserDetailed(
  req: NextRequest
): Promise<{ user: LineUser } | { user: null; error: AuthError }> {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return { user: null, error: "NO_TOKEN" };
  }
  const token = auth.slice(7).trim();
  if (!token) return { user: null, error: "NO_TOKEN" };
  const user = await verifyAccessToken(token);
  if (!user) return { user: null, error: "INVALID_TOKEN" };
  return { user };
}
