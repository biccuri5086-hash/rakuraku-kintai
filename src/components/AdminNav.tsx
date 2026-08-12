"use client";

import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Building2, FileText, CalendarClock } from "lucide-react";

const NAV = [
  { href: "/admin", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/admin/clients", label: "派遣先", icon: Building2 },
  { href: "/admin/assignments", label: "契約", icon: FileText },
  { href: "/admin/shifts", label: "シフト", icon: CalendarClock },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <nav className="bg-white border-b border-gray-100 overflow-x-auto">
      <div className="max-w-3xl mx-auto flex gap-1 px-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <button
              key={href}
              onClick={() => router.push(href)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                active
                  ? "border-[#06C755] text-[#06C755]"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              <Icon size={16} /> {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
