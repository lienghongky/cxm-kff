/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        base: '#f7f5f0',
        primary: '#44403c',
        muted: '#a8a29e',
        borderTactile: '#e7e5e4'
      },
      fontFamily: {
        engine: ['Outfit', 'Inter', 'sans-serif']
      },
      fontWeight: {
        thin: '100',
        light: '300',
        normal: '400'
      },
      letterSpacing: {
        widest: '0.25em',
        wider: '0.15em'
      }
    }
  },
  plugins: [
    function({ addUtilities }) {
      addUtilities({
        '.mask-radial-mouse': {
          'mask-image': 'radial-gradient(circle 220px at var(--mouse-x, -999px) var(--mouse-y, -999px), black 10%, transparent 100%)',
          '-webkit-mask-image': 'radial-gradient(circle 220px at var(--mouse-x, -999px) var(--mouse-y, -999px), black 10%, transparent 100%)'
        }
      });
    }
  ]
}
