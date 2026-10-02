/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // JU Signal palette (see src/renderer/styles/globals.css :root for the CSS side).
      colors: {
        bg: {
          DEFAULT: '#0B0B0A',
          elevated: '#11110F',
          card: '#171715',
          hover: '#1D1D1A',
        },
        border: {
          DEFAULT: '#2B2B28',
          hover: '#3A3A36',
        },
        text: {
          DEFAULT: '#F2F1EA',
          muted: '#8F9088',
          dim: '#6B6C65',
        },
        accent: {
          DEFAULT: '#D8FF4F',
          dim: '#B9DD3A',
        },
        mint: '#8DF6DC',
        // Tailwind grays are remapped to warm JU neutrals so legacy pages blend in.
        gray: {
          300: '#C9C8C0',
          400: '#8F9088',
          500: '#6B6C65',
          600: '#4A4A46',
          700: '#2B2B28',
          800: '#171715',
          900: '#11110F',
        },
        blue: {
          500: '#D8FF4F',
          600: '#D8FF4F',
          700: '#E6FF7A',
        },
      },
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', 'Inter', 'Segoe UI', 'Malgun Gothic', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
