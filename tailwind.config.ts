import type { Config } from 'tailwindcss';

/**
 * Folio & Forever brand palette mirrors the existing WP child theme so the
 * port preserves the dark-luxury aesthetic. Variables are duplicated in
 * globals.css as CSS custom properties for use outside Tailwind utility
 * classes (e.g. inline styles in client components).
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: '#0e0c09',
        dark2: '#1a1610',
        dark3: '#2a2218',
        gold: '#b8965a',
        'gold-light': '#d4b07a',
        cream: '#e8d5b0',
        'cream-light': '#f5f0e8',
        muted: '#6b5e4e',
        muted2: '#8a7a65',
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'serif'],
        body: ['Montserrat', 'sans-serif'],
      },
      letterSpacing: {
        widest2: '4px',
      },
    },
  },
  plugins: [],
};

export default config;
