import type { Config } from "tailwindcss";

// ink/brand shades resolve through CSS custom properties (defined in
// globals.css) instead of fixed hex values, so the dark-mode toggle can
// swap the whole palette by flipping one class on <html> — every existing
// bg-ink-*/text-ink-*/bg-brand-* utility across the app becomes dark-aware
// for free, with no per-component changes needed.
function cssVarColor(name: string) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

function shadeScale(prefix: string) {
  return Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) => [
      shade,
      cssVarColor(`--${prefix}-${shade}`),
    ])
  );
}

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Maxey Construction — editorial teal / cement-sage palette, matching
        // the Finance tab's design system (2026-09 retheme, applied app-wide).
        brand: shadeScale("brand"),
        ink: shadeScale("ink"),
      },
    },
  },
  plugins: [],
};
export default config;
