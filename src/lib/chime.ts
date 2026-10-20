"use client";

const SOUND_KEY = "maxey_sound";

export const soundOn = (): boolean => {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
};

export const setSound = (on: boolean) => {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // storage blocked — the choice just isn't remembered
  }
};

let ctx: AudioContext | null = null;

/**
 * A soft two-note chime for "something new happened", made in the browser (no sound file to load). Browsers only allow
 * sound after the person has touched the page once, so on a page nobody has touched yet it stays quiet rather than error.
 */
export function playChime() {
  if (typeof window === "undefined" || !soundOn()) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    if (ctx.state !== "running") return;
    const now = ctx.currentTime;
    [
      { freq: 659.25, at: 0 }, // E5
      { freq: 880, at: 0.14 }, // A5
    ].forEach(({ freq, at }) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.12, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.32);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.34);
    });
  } catch {
    // no sound is better than an error
  }
}
