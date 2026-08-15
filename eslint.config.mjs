import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Dev/test-only tooling (not application code):
    ".test-build/**",
    "scripts/**",
  ]),
  {
    rules: {
      // マウント時に fetch → setState する既存の定石（全画面で使用）。error だと安定稼働中の
      // 認証/LIFF/管理画面まで全面書き換えになるため warn に下げて可視化のみ残す。
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
