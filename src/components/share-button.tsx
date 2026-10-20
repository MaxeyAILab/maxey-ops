"use client";

import { useEffect, useRef, useState } from "react";
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

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Where = "email" | "viber" | "messenger" | "download";

/**
 * "Share" a file — payslips, delivery receipts, site photos. On a phone this opens the share sheet with the file attached
 * (Viber, Messenger, email…). A computer can't attach a file to another app on its own, so there the person picks where it
 * is going: the file is saved and the app is opened, ready for them to attach it.
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
  const [menu, setMenu] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  async function share() {
    if (menu) return setMenu(false);
    setBusy(true);
    haptic("tap");
    try {
      const blob = await loadBlob(src);
      blobRef.current = blob;
      const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else {
        setMenu(true);
      }
    } catch (err) {
      // closing the share sheet is not an error
      if ((err as Error).name !== "AbortError") toast(t("share.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  function send(where: Where) {
    setMenu(false);
    const blob = blobRef.current;
    if (!blob) return;
    saveFile(blob, filename); // the file is saved first; the person attaches it in the app that opens
    const message = `${title} — ${filename}`;
    if (where === "email") window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${message}\n\n`)}`;
    if (where === "viber") window.location.href = `viber://forward?text=${encodeURIComponent(message)}`;
    if (where === "messenger") window.open("https://www.messenger.com/", "_blank", "noopener,noreferrer");
    toast(t("share.downloaded"), "info");
  }

  const look = tone === "light" ? "rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20" : "text-xs font-medium text-brand-600 hover:underline";
  const item = "block w-full whitespace-nowrap px-3 py-2 text-left text-sm text-ink-800 hover:bg-ink-100";
  return (
    <span ref={wrap} className="relative inline-block">
      <button type="button" onClick={share} disabled={busy} aria-haspopup="menu" aria-expanded={menu} className={`${look} disabled:opacity-60 ${className ?? ""}`}>
        {busy ? t("share.sharing") : `↗ ${t("share.button")}`}
      </button>
      {menu && (
        <span role="menu" className="absolute left-0 top-full z-30 mt-1 block min-w-[11rem] overflow-hidden rounded-lg border border-ink-200 bg-ink-50 py-1 text-left shadow-lg">
          <button role="menuitem" type="button" className={item} onClick={() => send("email")}>
            ✉️ {t("share.email")}
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => send("viber")}>
            💬 {t("share.viber")}
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => send("messenger")}>
            🗨️ {t("share.messenger")}
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => send("download")}>
            ⬇ {t("share.downloadOnly")}
          </button>
        </span>
      )}
    </span>
  );
}
