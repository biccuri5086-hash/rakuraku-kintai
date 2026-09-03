"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Building2, FileText, CalendarClock, Wallet, CalendarHeart, ClipboardList, ShieldAlert, CreditCard } from "lucide-react";

// group が変わる境目に区切り線を入れ、9項目を意味のある塊に見せる。
const NAV = [
  { href: "/admin", label: "ダッシュボード", icon: LayoutDashboard, group: "main" },
  { href: "/admin/clients", label: "派遣先", icon: Building2, group: "work" },
  { href: "/admin/assignments", label: "契約", icon: FileText, group: "work" },
  { href: "/admin/shifts", label: "シフト", icon: CalendarClock, group: "work" },
  { href: "/admin/payroll", label: "給与", icon: Wallet, group: "settle" },
  { href: "/admin/paid-leave", label: "有給", icon: CalendarHeart, group: "settle" },
  { href: "/admin/client-report", label: "派遣先報告", icon: ClipboardList, group: "settle" },
  { href: "/admin/compliance", label: "派遣法", icon: ShieldAlert, group: "manage" },
  { href: "/admin/billing", label: "プラン", icon: CreditCard, group: "manage" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // 現在地のタブが画面外（横スクロールの奥）にあっても見える位置へ寄せる。
  // block:"nearest" でページ自体が縦に飛ばないようにする。
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav className="bg-white border-b border-gray-100 overflow-x-auto">
      <div className="max-w-3xl mx-auto flex items-stretch gap-1 px-2">
        {NAV.map(({ href, label, icon: Icon, group }, i) => {
          const active = pathname === href;
          // 直前の項目とグループが変わる位置に、細い区切りを差し込む。
          const showDivider = i > 0 && NAV[i - 1].group !== group;
          return (
            <div key={href} className="flex items-stretch">
              {showDivider && <span aria-hidden className="self-center mx-1 h-4 w-px bg-gray-200" />}
              <button
                ref={active ? activeRef : null}
                onClick={() => router.push(href)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  active
                    ? "border-[#06C755] text-[#06C755]"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                <Icon size={16} /> {label}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
