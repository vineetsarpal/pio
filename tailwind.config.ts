import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm "field report" paper + ink
        ink: "#17150e",
        "ink-soft": "#4b4636",
        fog: "#e9e0cd", // page paper (kept name so existing bg-fog re-skins)
        paper: "#e9e0cd",
        card: "#f7f2e6", // warm panel
        line: "#cdbfa0", // hairline rule
        // Riso accents (names kept so existing usage re-skins)
        rain: "#1f33a8", // cobalt ink (primary)
        mint: "#1b6a4c", // settled / approved green
        amber: "#9a6b1c", // advisory ochre
        signal: "#c8442a" // vermilion hazard
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"]
      },
      borderRadius: {
        lg: "2px",
        DEFAULT: "2px",
        full: "9999px"
      },
      letterSpacing: {
        kicker: "0.2em"
      },
      boxShadow: {
        // subtle hairline lift for the many panels
        panel: "0 1px 0 0 rgba(23, 21, 14, 0.05), 0 10px 30px -22px rgba(23, 21, 14, 0.45)",
        // crisp riso misregistration offset for hero / CTA / certificate
        riso: "5px 5px 0 0 #17150e"
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        sweep: {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" }
        }
      },
      animation: {
        rise: "rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
        sweep: "sweep 0.9s cubic-bezier(0.16, 1, 0.3, 1) both"
      }
    }
  },
  plugins: []
};

export default config;
