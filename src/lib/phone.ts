export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "");
  const normalized = digits.startsWith("+81")
    ? "0" + digits.slice(3)
    : digits.startsWith("81") && digits.length === 11
    ? "0" + digits.slice(2)
    : digits;
  if (/^0\d{9,10}$/.test(normalized)) return normalized;
  return null;
}
