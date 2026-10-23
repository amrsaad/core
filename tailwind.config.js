/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        beat: '#C9A227',
        body: '#2FB37A',
        brain: '#4A8CFF',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        serif: ['ui-serif', 'Georgia', 'serif'],
        arabic: ['"Amiri Quran"', '"Noto Naskh Arabic"', 'serif'],
      },
    },
  },
  plugins: [],
};
