import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { allowedMenus } from "@/lib/access";
import { SyncStatus } from "@/components/sync-status";
import { SignOutButton } from "@/components/signout-button";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const nav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/leads", label: "Leads / CRM", icon: "📥" },
  { href: "/projects", label: "Projects", icon: "🏗️" },
  { href: "/requisitions", label: "Requisitions", icon: "📝" },
  { href: "/purchasing", label: "Purchasing", icon: "🛒" },
  { href: "/deliveries", label: "Deliveries", icon: "🚚" },
  { href: "/inventory", label: "Inventory", icon: "📦" },
  { href: "/instructions", label: "Instructions", icon: "📋" },
  { href: "/attendance", label: "Attendance", icon: "⏱️" },
  { href: "/payroll", label: "Payroll", icon: "💰" },
  { href: "/people", label: "People", icon: "👥" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  if (user.mustChangePassword) redirect("/change-password"); // temp password issued

  const menus = allowedMenus(user.role, user.department);
  const items = nav.filter((n) => menus.includes(n.href));

  return (
    <div className="min-h-screen md:flex">
      {/* Left sidebar — command panel (desktop) */}
      <aside className="no-print hidden w-56 shrink-0 flex-col border-r border-ink-200 bg-white md:flex">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-sm font-black text-white">
              M
            </span>
            <div>
              <div className="text-sm font-bold leading-tight text-ink-900">Maxey Ops</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-400">
                Operations Platform
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-600 hover:bg-brand-50 hover:text-brand-700"
              >
                <span aria-hidden>{n.icon}</span>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-ink-100 px-4 py-3">
            <div className="text-xs font-semibold text-ink-900">{user.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-ink-400">{user.role}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <SyncStatus />
              <SignOutButton />
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar (field phones) */}
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 border-b border-ink-200 bg-white md:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-black text-white">
              M
            </span>
            <nav className="flex items-center gap-1 overflow-x-auto text-sm">
              {items.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="whitespace-nowrap rounded-lg px-3 py-2 font-medium text-ink-600 hover:bg-ink-100"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              <SyncStatus />
              <SignOutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
