import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Maxey Construction brand palette — white / burgundy / cement grey
        brand: {
          // Darker, more saturated wine-red burgundy (2nd pass — less rose/mauve)
          50: "#fbebed",
          100: "#f4ccd1",
          200: "#e59ba3",
          300: "#d06672",
          400: "#b23d49",
          500: "#8a1a28", // primary burgundy — buttons, links, accents
          600: "#6e1420", // hover / darker accent
          700: "#560f19",
          800: "#3f0a12",
          900: "#2c060c",
          950: "#1c0407",
        },
        ink: {
          // "cement grey" neutrals — warm-neutral stone tones, not blue-tinted
          50: "#f7f6f5",
          100: "#edebe9",
          200: "#dad7d3",
          300: "#bdb8b2",
          400: "#9c958d",
          500: "#7c7469",
          600: "#635c53",
          700: "#4c463f",
          800: "#38332e",
          900: "#262320",
          950: "#191715",
        },
      },
    },
  },
  plugins: [],
};
export default config;
