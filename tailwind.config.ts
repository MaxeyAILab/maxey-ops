import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Maxey Construction brand palette
        brand: {
          50: "#fff8eb",
          100: "#feecc7",
          200: "#fdd68a",
          300: "#fcba4d",
          400: "#fba524",
          500: "#f5820b",
          600: "#d95f06",
          700: "#b43f09",
          800: "#92300e",
          900: "#78280f",
          950: "#451204",
        },
        ink: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d5d9e2",
          300: "#b1b9c8",
          400: "#8693a9",
          500: "#67758f",
          600: "#525d76",
          700: "#434c60",
          800: "#3a4151",
          900: "#343946",
          950: "#22252e",
        },
      },
    },
  },
  plugins: [],
};
export default config;
