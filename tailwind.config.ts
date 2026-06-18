import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18202f",
        fog: "#f5f7fb",
        rain: "#276ef1",
        mint: "#00a870",
        amber: "#b7791f"
      },
      boxShadow: {
        panel: "0 1px 2px rgba(24, 32, 47, 0.08), 0 12px 28px rgba(24, 32, 47, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
