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
        surface2: 'var(--surface-2)',
        text: 'var(--text)',
        accent: 'var(--accent)',
        hairline: 'var(--hairline)',
        beat: 'var(--c-beat)',
        body: 'var(--c-body)',
        brain: 'var(--c-brain)',
      },
      fontFamily: {
        sans: 'var(--font-ui)',
        serif: 'var(--font-brain)',
        arabic: 'var(--font-ar)',
        verse: 'var(--font-verse)',
      },
    },
  },
  plugins: [],
};
