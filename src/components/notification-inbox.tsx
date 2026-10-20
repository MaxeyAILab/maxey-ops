"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  url: string;
  when: string;
  unread: boolean;
}

/** The bell's list: everything you were told about, newest first. Tapping one marks it read and opens the page it is about. */
export function NotificationInbox({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const [read, setRead] = useState<Set<string>>(new Set());

  async function markAll() {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    setRead(new Set(items.map((i) => i.id)));
    router.refresh();
  }
  async function open(item: InboxItem) {
    if (item.unread && !read.has(item.id)) {
      await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [item.id] }) }).catch(() => undefined);
      setRead(new Set(read).add(item.id));
    }
    router.push(item.url);
  }

  const unreadCount = items.filter((i) => i.unread && !read.has(i.id)).length;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900">Your notifications{unreadCount > 0 ? ` (${unreadCount} new)` : ""}</h2>
        {unreadCount > 0 && (
          <button onClick={markAll} className="text-xs font-medium text-brand-600 hover:underline">
            Mark all as read
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-200 p-4 text-sm text-ink-500">Nothing yet. You&apos;ll see updates here as people work on the things you&apos;re involved in.</p>
      ) : (
        <ul className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-200">
          {items.map((i) => {
            const unread = i.unread && !read.has(i.id);
            return (
              <li key={i.id}>
                <button onClick={() => open(i)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ink-50 ${unread ? "bg-brand-50/60" : ""}`}>
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-brand-500" : "bg-transparent"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${unread ? "font-semibold text-ink-900" : "text-ink-800"}`}>{i.title}</span>
                    <span className="block truncate text-xs text-ink-500">{i.body}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-400">{i.when}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
