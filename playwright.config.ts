import { defineConfig } from "@playwright/test";

// DBに繋がなくても確かめられる範囲のスモークテスト。
// 本番ビルドを起動して、公開ページ・ログイン画面・未認証の拒否・セキュリティヘッダを見る。
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // CI は playwright が入れたChromium、手元は PW_CHROMIUM_PATH で既存のものを指定できる
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/lp`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder_service_role_key_for_e2e_only",
      SESSION_SECRET: "e2e_placeholder_session_secret_1234567890",
    },
  },
});
