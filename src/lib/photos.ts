"use client";

/**
 * Client-side photo compression (Spec §4): shrink to max 1280px JPEG before
 * queueing/uploading so offline sync payloads stay small on site connections.
 */
export async function compressImage(file: File, maxDim = 1280, quality = 0.7): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}
