import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Maxey Construction — editorial teal / cement-sage palette, matching
        // the Finance tab's design system (2026-09 retheme, applied app-wide).
        brand: {
          50: "#eaf5f2",
          100: "#d3e9e3",
          200: "#a8d3c7",
          300: "#78b8a7",
          400: "#429685",
          500: "#0b6e5a", // primary teal — buttons, links, accents (== Finance --teal)
          600: "#095c4b", // hover / darker accent
          700: "#07493c",
          800: "#05362c",
          900: "#03231d",
          950: "#011512",
        },
        ink: {
          // Sage-cement neutrals — matches the Finance tab's --ground/--rule/
          // --ink tokens exactly at 100/200/400/600/900 so the whole app
          // shares one grayscale with it.
          50: "#fafbfa", // == Finance --panel
          100: "#e6e9e6", // == Finance --ground
          200: "#d2d7d3", // == Finance --rule
          300: "#b9c0ba",
          400: "#8b9491", // == Finance --ink-3
          500: "#74807c",
          600: "#5a6462", // == Finance --ink-2
          700: "#3c4442",
          800: "#262d2b",
          900: "#161a1b", // == Finance --ink
          950: "#0d1010",
        },
      },
    },
  },
  plugins: [],
};
export default config;
