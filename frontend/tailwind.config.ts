import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "var(--surface)",
        "surface-hover": "var(--surface-hover)",
        border: "var(--border)",
        accent: "var(--accent)",
      },
    },
  },
  plugins: [],
}
export default config
