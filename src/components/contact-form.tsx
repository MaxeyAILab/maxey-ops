"use client";

import { useState } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui";

/** Public lead-intake form — posts straight into the CRM (Spec 6.1). */
export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [reply, setReply] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const fd = new FormData(e.currentTarget);
    // Tracked inquiry links (e.g. the Messenger auto-reply sends
    // https://maxey-ops.vercel.app/?src=fb#contact) tag the lead's source in
    // the CRM. Read at submit time — no hook, so the page stays static.
    const src = new URLSearchParams(window.location.search).get("src")?.toLowerCase();
    const source =
      src === "fb" || src === "facebook" ? "FACEBOOK" : src === "ref" ? "REFERRAL" : "WEBSITE";
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactName: fd.get("contactName"),
        email: fd.get("email"),
        phone: fd.get("phone"),
        address: fd.get("address"),
        message: fd.get("message"),
        source,
      }),
    }).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      setReply(data.message);
      setStatus("done");
    } else {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
        <p className="font-semibold">Inquiry received ✓</p>
        <p className="mt-1 text-sm">{reply}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-ink-200 bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="contactName">Your name *</Label>
          <Input id="contactName" name="contactName" required maxLength={200} />
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" maxLength={30} />
        </div>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" />
      </div>
      <div>
        <Label htmlFor="address">Project location</Label>
        <Input id="address" name="address" maxLength={500} />
      </div>
      <div>
        <Label htmlFor="message">Tell us about your project</Label>
        <Textarea id="message" name="message" rows={4} maxLength={5000} />
      </div>
      <Button type="submit" disabled={status === "sending"} className="w-full">
        {status === "sending" ? "Sending…" : "Send inquiry"}
      </Button>
      {status === "error" && (
        <p className="text-sm text-red-600">Something went wrong — please try again.</p>
      )}
    </form>
  );
}
