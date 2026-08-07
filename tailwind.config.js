/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0a0a0b',
          elevated: '#111113',
          card: '#18181b',
          hover: '#1f1f23',
        },
        border: {
          DEFAULT: '#27272a',
          hover: '#3f3f46',
        },
        text: {
          DEFAULT: '#fafafa',
          muted: '#a1a1aa',
          dim: '#71717a',
        },
        accent: {
          DEFAULT: '#f5c542',
          dim: '#d4a838',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
