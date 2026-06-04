import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d2328",
        graphite: "#3d454c",
        paper: "#f7f3ea",
        linen: "#eee6d7",
        signal: "#d14f2f",
        moss: "#506b4f",
        steel: "#45616c"
      },
      boxShadow: {
        panel: "0 18px 45px rgba(32, 39, 45, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
