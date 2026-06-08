import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#181716",
        graphite: "#5e5953",
        paper: "#f5f0e7",
        linen: "#e9e0d2",
        signal: "#a64b32",
        moss: "#46614b",
        steel: "#374b50",
        sand: "#b79a6b"
      },
      boxShadow: {
        panel: "0 20px 60px rgba(42, 34, 27, 0.10)"
      }
    }
  },
  plugins: []
};

export default config;
