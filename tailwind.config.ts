import type { Config } from "tailwindcss";

const withAlpha = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: withAlpha("--bg"),
        surface: withAlpha("--surface"),
        "surface-2": withAlpha("--surface-2"),
        line: withAlpha("--line"),
        fg: withAlpha("--fg"),
        muted: withAlpha("--muted"),
        accent: withAlpha("--accent"),
        "accent-fg": withAlpha("--accent-fg"),
        navy: withAlpha("--navy"),
        danger: withAlpha("--danger"),
        warning: withAlpha("--warning"),
        success: withAlpha("--success"),
        info: withAlpha("--info"),
      },
      opacity: {
        "7": "0.07",
        "8": "0.08",
        "12": "0.12",
        "35": "0.35",
        "45": "0.45",
        "55": "0.55",
        "65": "0.65",
        "85": "0.85",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 12px 32px -16px rgb(0 0 0 / 0.45)",
        glow: "0 0 0 1px rgb(var(--accent) / 0.35), 0 8px 30px -8px rgb(var(--accent) / 0.45)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.4s linear infinite",
        "fade-up": "fade-up 0.35s ease-out both",
        "pulse-ring": "pulseRing 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
