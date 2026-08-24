import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// 全ページ共通のセキュリティヘッダー。
// 管理画面は Cookie 認証で給与・個人情報を扱うため、クリックジャッキング対策
// （frame-ancestors）は必須。LIFF は WebView で開くので iframe 禁止の影響は無い。
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), geolocation=(self)" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // LIFF SDK・Sentry・Supabase・LINE のプロフィール画像に必要な通信先だけを許可する。
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js のインライン/評価スクリプトのため unsafe-inline / unsafe-eval が必要
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.line-scdn.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://profile.line-scdn.net",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://api.line.me https://*.line-scdn.net https://*.sentry.io",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // 使用フレームワークを広告しない（既知CVEの探索対象になりやすい）
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "profile.line-scdn.net",
      },
    ],
  },
  headers() {
    return Promise.resolve([
      { source: "/:path*", headers: securityHeaders },
      // API レスポンスは絶対にキャッシュさせない（テナントを跨いだ漏洩防止）
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ]);
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // disableLogger は非推奨。Turbopack では未対応のため webpack 側で指定する。
  webpack: { treeshake: { removeDebugLogging: true } },
  tunnelRoute: "/monitoring",
});
