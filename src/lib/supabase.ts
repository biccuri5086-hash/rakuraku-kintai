import { createClient, SupabaseClient } from "@supabase/supabase-js";

const DEMO_URL = "https://placeholder.supabase.co";
const DEMO_KEY = "demo-key";

let _client: SupabaseClient | null = null;

export function getSupabase() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || DEMO_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEMO_KEY;
    _client = createClient(url, key);
  }
  return _client;
}

export const supabase = {
  from: (table: string) => getSupabase().from(table),
};

// ユーザープロファイルの取得
export async function getUserProfile(userId: string) {
  const { data } = await getSupabase()
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data as { user_id: string; display_name: string; phone: string } | null;
}

// 電話番号の正規化（09012345678 形式に統一）
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-\(\)\.]/g, "");
  // +81 → 0 に変換
  const normalized = digits.startsWith("+81")
    ? "0" + digits.slice(3)
    : digits.startsWith("81") && digits.length === 11
    ? "0" + digits.slice(2)
    : digits;
  // 10〜11桁の0始まりのみ許可
  if (/^0\d{9,10}$/.test(normalized)) return normalized;
  return null;
}

// 打刻後にGPSで位置情報を非同期更新
export function updateAttendanceGps(attendanceId: string) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      getSupabase()
        .from("attendance")
        .update({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          gps_accuracy: pos.coords.accuracy,
        })
        .eq("id", attendanceId);
    },
    () => {
      // GPS取得失敗は無視（打刻は成立済み）
    },
    { timeout: 10000, maximumAge: 0 }
  );
}

export type AttendanceRecord = {
  id: string;
  user_id: string;
  user_name: string;
  type: "clock_in" | "clock_out";
  timestamp: string;
  lat?: number;
  lng?: number;
  gps_accuracy?: number;
};
