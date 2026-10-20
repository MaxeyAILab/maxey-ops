import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allowedMenus } from "@/lib/access";
import { SyncStatus } from "@/components/sync-status";
import { SignOutButton } from "@/components/signout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { CashExpenseNav } from "@/components/cash-expense-nav";
import { SidebarNav, type SidebarItem } from "@/components/sidebar-nav";
import { MobileDrawer } from "@/components/mobile-drawer";
import { canUseCashExpense } from "@/lib/access";
import { PushAutoSubscribe } from "@/components/push-auto-subscribe";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  chip: keyof typeof CHIP_TONES;
}

// Full literal class strings (never built via string interpolation) so
// Tailwind's JIT scanner picks them up.
const CHIP_TONES = {
  sky: "bg-sky-100",
  violet: "bg-violet-100",
  amber: "bg-amber-100",
  indigo: "bg-indigo-100",
  orange: "bg-orange-100",
  blue: "bg-blue-100",
  teal: "bg-teal-100",
  slate: "bg-slate-100",
  emerald: "bg-emerald-100",
  pink: "bg-pink-100",
  cyan: "bg-cyan-100",
  rose: "bg-rose-100",
} as const;

const nav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊", chip: "sky" },
  { href: "/finance", label: "Finance", icon: "💵", chip: "rose" },
  { href: "/leads", label: "Leads / CRM", icon: "📥", chip: "violet" },
  { href: "/projects", label: "Projects", icon: "🏗️", chip: "amber" },
  { href: "/requisitions", label: "Requisitions", icon: "📝", chip: "indigo" },
  { href: "/purchasing", label: "Purchasing", icon: "🛒", chip: "orange" },
  { href: "/deliveries", label: "Deliveries", icon: "🚚", chip: "blue" },
  { href: "/inventory", label: "Inventory", icon: "📦", chip: "teal" },
  { href: "/instructions", label: "Instructions", icon: "📋", chip: "slate" },
  { href: "/attendance", label: "Attendance", icon: "⏱️", chip: "emerald" },
  { href: "/payroll", label: "Payroll", icon: "💰", chip: "pink" },
  { href: "/people", label: "People", icon: "👥", chip: "cyan" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  if (user.mustChangePassword) redirect("/change-password"); // temp password issued

  const menus = allowedMenus(user.role, user.department, user.customMenus, user.useCustomMenus);
  const items = nav.filter((n) => menus.includes(n.href));

  // Open tasks addressed to this person — a specific assignment, or (for
  // Foremen) a broadcast to the whole site team, same as who can act on one
  // per canUpdateFor() in the Instructions tab itself.
  let instructionsBadge = 0;
  if (menus.includes("/instructions")) {
    instructionsBadge = await prisma.siteInstruction.count({
      where: {
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        OR: [
          { assignees: { some: { id: user.id } } },
          ...(user.role === "FOREMAN" ? [{ assignees: { none: {} } }] : []),
        ],
      },
    });
  }

  // The bell: how many things you have been told about and haven't opened yet.
  const unreadNotifications = await prisma.appNotification.count({ where: { userId: user.id, readAt: null } });

  // Cash Expense also opens for anyone the Owner made a petty cash approver or releaser.
  const showCashExpense = canUseCashExpense(user);
  const sidebarItems: SidebarItem[] = items.map((n) => ({
    href: n.href,
    label: n.label,
    icon: n.icon,
    chipClass: CHIP_TONES[n.chip],
    badge: n.href === "/instructions" ? instructionsBadge : 0,
  }));

  // The command panel: one copy, shown permanently on desktop and as a slide-out drawer on phones.
  const panel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#8a1a28] text-sm font-black text-white">
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
        <SidebarNav items={sidebarItems} />
        {showCashExpense && <CashExpenseNav showAdvances />}
      </nav>
      <div className="border-t border-ink-100 px-4 py-3">
        <div className="text-xs font-semibold text-ink-900">{user.name}</div>
        <div className="text-[10px] uppercase tracking-wide text-ink-400">{user.role}</div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <SyncStatus />
          <div className="flex items-center gap-1">
            <Link href="/notifications" aria-label={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : "Notifications"} className="relative rounded-lg border border-ink-200 px-2 py-1.5 text-xs text-ink-600 hover:bg-ink-50">
              <span aria-hidden>🔔</span>
              {unreadNotifications > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#8a1a28] px-1 text-[10px] font-bold text-white">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>
              )}
            </Link>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-shell min-h-screen bg-ink-100 text-ink-900 md:flex">
      {/* Left sidebar — command panel (desktop); on phones the same panel slides out from the left */}
      <aside className="no-print hidden w-56 shrink-0 flex-col border-r border-ink-200 bg-ink-50 md:flex">
        <div className="sticky top-0 h-screen">{panel}</div>
      </aside>

      {/* Mobile top bar (field phones) */}
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 border-b border-ink-200 bg-ink-50 md:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <div className="flex min-w-0 items-center gap-3">
              <MobileDrawer alert={instructionsBadge > 0}>{panel}</MobileDrawer>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#8a1a28] text-sm font-black text-white">M</span>
              <span className="truncate text-sm font-bold text-ink-900">Maxey Ops</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SyncStatus />
              <Link href="/notifications" aria-label={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : "Notifications"} className="relative rounded-lg border border-ink-200 px-2 py-1.5 text-xs text-ink-600 hover:bg-ink-50">
                <span aria-hidden>🔔</span>
                {unreadNotifications > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#8a1a28] px-1 text-[10px] font-bold text-white">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>
                )}
              </Link>
            </div>
          </div>
        </header>
        <PushAutoSubscribe />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
