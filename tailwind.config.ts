import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Maxey Construction brand palette — white / burgundy / cement grey
        brand: {
          50: "#fbf1f2",
          100: "#f5dee1",
          200: "#eabdc3",
          300: "#d8919b",
          400: "#bf6270",
          500: "#9f3f4f",
          600: "#7a2532", // primary burgundy — buttons, links, accents
          700: "#611d28",
          800: "#4a161f",
          900: "#371019",
          950: "#240a11",
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
