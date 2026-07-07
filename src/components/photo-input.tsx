"use client";

import { useRef, useState } from "react";
import { compressImage } from "@/lib/photos";
import { Label } from "@/components/ui";

/**
 * Camera-first photo capture (Spec §8): opens the camera on phones, compresses
 * client-side, and hands compressed data URLs to the parent form.
 */
export function PhotoInput({
  label = "Photos",
  max = 4,
  onChange,
}: {
  label?: string;
  max?: number;
  onChange: (dataUrls: string[]) => void;
}) {
  const [previews, setPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, max - previews.length);
    if (files.length === 0) return;
    const compressed = await Promise.all(files.map((f) => compressImage(f)));
    const next = [...previews, ...compressed];
    setPreviews(next);
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(i: number) {
    const next = previews.filter((_, idx) => idx !== i);
    setPreviews(next);
    onChange(next);
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {previews.map((src, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-20 w-20 rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white"
              aria-label="Remove photo"
            >
              ✕
            </button>
          </div>
        ))}
        {previews.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink-300 text-ink-400 hover:border-brand-400 hover:text-brand-500"
          >
            <span className="text-xl">📷</span>
            <span className="text-[10px]">Add</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={onFiles}
      />
    </div>
  );
}
