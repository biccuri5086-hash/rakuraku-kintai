"use client";

import SessionsManager from "@/components/SessionsManager";

export default function AdminSessionsPage() {
  return (
    <SessionsManager
      apiPath="/api/admin/sessions"
      loginPath="/admin/login"
      backPath="/admin"
      accent="green"
    />
  );
}
