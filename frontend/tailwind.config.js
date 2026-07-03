import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy palette — keep, some views still reference it
        galaxy: {
          DEFAULT: '#0f172a',
          card: '#1e293b',
          border: '#334155',
        },
        // Fills the slate-700 → slate-800 gap (hover states on slate-800 surfaces)
        slate: {
          750: '#293548',
        },
        // Semantic aliases — prefer these in new code
        brand: colors.indigo,
        success: colors.emerald,
        danger: colors.red,
        warning: colors.amber,
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '0.875rem' }],
      },
    },
  },
  plugins: [],
}
