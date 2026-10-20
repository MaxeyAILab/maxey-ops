"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { haptic, toast } from "@/components/feedback-provider";

/** data: URLs can't be fetched under the app's security rules, so a photo held as one is decoded directly. */
function dataUrlToBlob(src: string): Blob {
  const [head, body = ""] = src.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bytes = head.includes(";base64") ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body));
  return new Blob([bytes], { type: mime });
}

async function loadBlob(src: string): Promise<Blob> {
  if (src.startsWith("data:")) return dataUrlToBlob(src);
  const res = await fetch(src);
  if (!res.ok) throw new Error("Couldn't load the file");
  return res.blob();
}

/**
 * "Share" a file — payslips, delivery receipts, site photos — straight to Viber, Messenger, email or whatever the phone offers.
 * Phones open their own share sheet with the file attached. Where sharing files isn't possible (most computers) the file is
 * downloaded instead, ready to attach.
 */
export function ShareButton({
  src,
  filename,
  title,
  className,
  tone = "link",
}: {
  /** where the file comes from: a URL on this site, or a data: URL */
  src: string;
  filename: string;
  title: string;
  className?: string;
  tone?: "link" | "light";
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    haptic("tap");
    try {
      const blob = await loadBlob(src);
      const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast(t("share.downloaded"), "info");
      }
    } catch (err) {
      // closing the share sheet is not an error
      if ((err as Error).name !== "AbortError") toast(t("share.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const look = tone === "light" ? "rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20" : "text-xs font-medium text-brand-600 hover:underline";
  return (
    <button type="button" onClick={share} disabled={busy} className={`${look} disabled:opacity-60 ${className ?? ""}`}>
      {busy ? t("share.sharing") : `↗ ${t("share.button")}`}
    </button>
  );
}
