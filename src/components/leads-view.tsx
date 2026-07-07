"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { daysSince, fmtDate, fmtDateTime } from "@/lib/format";
import { LeadsBoard, type BoardLead } from "@/components/leads-board";

/** Board/List toggle for the Leads tab (owner's request, 2026-07-07). */
export function LeadsView({ leads: initialLeads }: { leads: BoardLead[] }) {
  const [view, setView] = useState<"board" | "list">("board");
  const [leads, setLeads] = useState(initialLeads);

  function onMove(id: string, status: string) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
  }

  const open = leads.filter((l) => !["WON", "LOST"].includes(l.status));
  const closed = leads.filter((l) => ["WON", "LOST"].includes(l.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-900">Leads &amp; Inquiries</h1>
        <div className="flex rounded-lg border border-ink-200 p-0.5 text-sm">
          <button
            onClick={() => setView("board")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              view === "board" ? "bg-brand-500 text-white" : "text-ink-600 hover:bg-ink-50"
            }`}
          >
            🗂 Board
          </button>
          <button
            onClick={() => setView("list")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              view === "list" ? "bg-brand-500 text-white" : "text-ink-600 hover:bg-ink-50"
            }`}
          >
            ☰ List
          </button>
        </div>
      </div>

      {view === "board" ? (
        <LeadsBoard leads={leads} onMove={onMove} />
      ) : (
        <>
          <Card>
            <CardHeader
              title={`Open inquiries (${open.length})`}
              subtitle="Ordered by inquiry time — first come, first served"
            />
            <Table>
              <thead>
                <tr>
                  <Th>Contact</Th>
                  <Th>Source</Th>
                  <Th>Received</Th>
                  <Th>Waiting</Th>
                  <Th>Estimate due</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {open.map((l) => {
                  const overdue =
                    !!l.estimateDueBy && new Date(l.estimateDueBy) < new Date() && l.status !== "QUOTATION_SENT";
                  return (
                    <tr key={l.id} className="hover:bg-ink-50">
                      <Td>
                        <Link href={`/leads/${l.id}`} className="font-medium text-brand-600 hover:underline">
                          {l.contactName}
                        </Link>
                        <div className="text-xs text-ink-400">{l.phone ?? l.email ?? ""}</div>
                      </Td>
                      <Td>
                        <Badge value={l.source} />
                      </Td>
                      <Td className="text-xs">{fmtDateTime(l.createdAt)}</Td>
                      <Td className="tabular-nums">
                        {daysSince(l.createdAt)}d
                        {l.quotationCount > 0 && (
                          <span className="ml-1 text-xs text-ink-400">({l.quotationCount} quote)</span>
                        )}
                      </Td>
                      <Td className={overdue ? "font-semibold text-red-600" : ""}>
                        {fmtDate(l.estimateDueBy)}
                        {overdue && " ⚠"}
                      </Td>
                      <Td>
                        <Badge value={l.status} />
                      </Td>
                    </tr>
                  );
                })}
                {open.length === 0 && (
                  <tr>
                    <Td colSpan={6} className="py-8 text-center text-ink-400">
                      No open inquiries. New website / Facebook inquiries appear here automatically.
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>

          {closed.length > 0 && (
            <Card>
              <CardHeader title={`Closed (${closed.length})`} />
              <Table>
                <thead>
                  <tr>
                    <Th>Contact</Th>
                    <Th>Source</Th>
                    <Th>Received</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((l) => (
                    <tr key={l.id} className="hover:bg-ink-50">
                      <Td>
                        <Link href={`/leads/${l.id}`} className="font-medium text-brand-600 hover:underline">
                          {l.contactName}
                        </Link>
                      </Td>
                      <Td>
                        <Badge value={l.source} />
                      </Td>
                      <Td className="text-xs">{fmtDate(l.createdAt)}</Td>
                      <Td>
                        <Badge value={l.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
