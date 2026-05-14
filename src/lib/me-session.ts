import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { requireLineUser, LineUser } from "./line-auth";

const COOKIE_NAME = "me_session";
const TTL_SECONDS = 30 * 60;

function getSecret(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error("ADMIN_PASSWORD is not configured");
  return pw;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function encode(user: LineUser): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${user.userId}|${encodeURIComponent(user.displayName)}|${exp}`;
  const sig = sign(payload);
  return `${payload}|${sig}`;
}

function decode(value: string): LineUser | null {
  const parts = value.split("|");
  if (parts.length !== 4) return null;
  const [userId, encodedName, expStr, sig] = parts;
  const payload = `${userId}|${encodedName}|${expStr}`;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  if (sig !== expected) return null;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return { userId, displayName: decodeURIComponent(encodedName) };
}

export async function getLineUserCached(req: NextRequest): Promise<LineUser | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  if (cookieValue) {
    const cached = decode(cookieValue);
    if (cached) return cached;
  }
  const user = await requireLineUser(req);
  if (user) {
    cookieStore.set(COOKIE_NAME, encode(user), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: TTL_SECONDS,
    });
  }
  return user;
}
