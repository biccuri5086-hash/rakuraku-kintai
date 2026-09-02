"use client";

import SessionsManager from "@/components/SessionsManager";

export default function SuperadminSessionsPage() {
  return (
    <SessionsManager
      apiPath="/api/superadmin/sessions"
      loginPath="/superadmin/login"
      backPath="/superadmin"
      accent="slate"
    />
  );
}
