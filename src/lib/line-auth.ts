import { NextRequest } from "next/server";

export type LineUser = {
  userId: string;
  displayName: string;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { user: LineUser; expiresAt: number }>();

async function verifyAccessToken(accessToken: string): Promise<LineUser | null> {
  const cached = cache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  try {
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" }
    );
    if (!verifyRes.ok) return null;
    const verifyData = (await verifyRes.json()) as { expires_in?: number; client_id?: string };
    if (!verifyData.expires_in || verifyData.expires_in <= 0) return null;

    const expectedChannelId = process.env.LINE_CHANNEL_ID;
    if (expectedChannelId && verifyData.client_id !== expectedChannelId) return null;

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!profileRes.ok) return null;
    const profile = (await profileRes.json()) as { userId: string; displayName: string };

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
