import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto px-4 py-4 border-t border-gray-100 bg-white">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <Link href="/terms" className="hover:text-gray-600">利用規約</Link>
        <Link href="/privacy" className="hover:text-gray-600">プライバシーポリシー</Link>
        <Link href="/legal" className="hover:text-gray-600">特定商取引法</Link>
        <Link href="/lp" className="hover:text-gray-600">サービス概要</Link>
      </div>
      <p className="text-center text-xs text-gray-300 mt-1">© 2026 ラクラク勤怠</p>
    </footer>
  );
}
