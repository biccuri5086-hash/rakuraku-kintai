import { test, expect } from "@playwright/test";

test.describe("公開ページ", () => {
  const pages: [string, string][] = [
    ["/lp", "ラクラク勤怠"],
    ["/privacy", "プライバシー"],
    ["/terms", "利用規約"],
    ["/legal", "特定商取引"],
  ];
  for (const [path, text] of pages) {
    test(`${path} が表示できる`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("body")).toContainText(text);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("管理者ログイン", () => {
  test("メールとパスワードの入力欄がある", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test("未ログインで管理画面を開くとログイン画面に戻される", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL("**/admin/login", { timeout: 15_000 });
  });

  test("未ログインで運営画面を開くと運営ログインに戻される", async ({ page }) => {
    await page.goto("/superadmin");
    await page.waitForURL("**/superadmin/login", { timeout: 15_000 });
  });
});

test.describe("未認証のAPIは拒否する", () => {
  for (const path of [
    "/api/admin/staff",
    "/api/admin/clients",
    "/api/admin/payroll/preview?month=2026-10",
    "/api/admin/compliance/ledger?format=csv",
  ]) {
    test(`GET ${path} は 401`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(401);
    });
  }
});

test.describe("セキュリティヘッダ", () => {
  test("主要なヘッダが付く", async ({ request }) => {
    const res = await request.get("/lp");
    const h = res.headers();
    expect(h["content-security-policy"]).toBeTruthy();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"] ?? h["content-security-policy"]).toBeTruthy();
  });
});
