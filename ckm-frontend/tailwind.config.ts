import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}", // <-- YE LINE SABSE IMPORTANT HAI
  ],
  theme: {
    extend: {
      colors: {
        auraWhite: "#F8FAFC",
        precisionTeal: "#14B8A6",
      },
    },
  },
  plugins: [],
};
export default config;