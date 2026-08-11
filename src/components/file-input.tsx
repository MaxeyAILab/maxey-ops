"use client";

import { useRef, useState } from "react";
import { Label } from "@/components/ui";

const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.dwg,.dxf";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 5;

interface Attached {
  name: string;
  url: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

/** Generic multi-file attach control (plans, photos, PDFs, CAD drawings) — not
 * camera-first like PhotoInput, since it accepts document/CAD types too. Each
 * file uploads straight to storage via a signed URL (see /api/leads/upload-url)
 * so large plan files never pass through the app's own request body limit. */
export function FileInput({
  label = "Attach files",
  max = MAX_FILES,
  onChange,
  onBusyChange,
}: {
  label?: string;
  max?: number;
  onChange: (files: { url: string; name: string }[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [files, setFiles] = useState<Attached[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function emit(next: Attached[]) {
    setFiles(next);
    onChange(next.filter((f) => f.status === "done").map((f) => ({ url: f.url, name: f.name })));
    onBusyChange?.(next.some((f) => f.status === "uploading"));
  }

  async function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).slice(0, max - files.length);
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;

    const placeholders: Attached[] = picked.map((f) => ({ name: f.name, url: "", status: "uploading" }));
    let working = [...files, ...placeholders];
    emit(working);

    await Promise.all(
      picked.map(async (file, i) => {
        const slot = files.length + i;
        try {
          if (file.size > MAX_BYTES) throw new Error("Too large (max 20MB)");
          const prep = await fetch("/api/leads/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
          });
          if (!prep.ok) throw new Error((await prep.json().catch(() => null))?.error ?? "Upload failed");
          const { uploadUrl, fileUrl } = await prep.json();

          const put = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!put.ok) throw new Error("Upload failed");

          working = working.map((f, idx) =>
            idx === slot ? { ...f, url: fileUrl, status: "done" } : f
          );
          emit(working);
        } catch (err) {
          working = working.map((f, idx) =>
            idx === slot ? { ...f, status: "error", error: (err as Error).message } : f
          );
          emit(working);
        }
      })
    );
  }

  function remove(i: number) {
    emit(files.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <Label>{label}</Label>
      <p className="mb-2 text-xs text-ink-400">
        Photos, PDF, or CAD (DWG/DXF) — up to {max} files, 20MB each.
      </p>
      <div className="space-y-2">
        {files.map((f, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
          >
            <span className="truncate text-ink-700">{f.name}</span>
            <div className="flex flex-shrink-0 items-center gap-2">
              {f.status === "uploading" && <span className="text-xs text-ink-400">Uploading…</span>}
              {f.status === "error" && (
                <span className="text-xs text-red-600">{f.error ?? "Failed"}</span>
              )}
              {f.status === "done" && <span className="text-xs text-emerald-600">Uploaded ✓</span>}
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-ink-400 hover:text-red-600"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {files.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-ink-300 px-3 py-3 text-sm text-ink-400 hover:border-brand-400 hover:text-brand-500"
          >
            + Attach a file
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={onSelect}
      />
    </div>
  );
}
