/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Amazon-inspired palette
        amazon: {
          nav: '#131A22',        // Top header
          'nav-light': '#232F3E', // Sub-header (search bar bg)
          'nav-hover': '#37475A',
          yellow: '#FFD814',      // Primary CTA
          'yellow-hover': '#F7CA00',
          'yellow-border': '#FCD200',
          orange: '#FF9900',      // Accent / hover links
          'orange-hover': '#E47911',
          link: '#007185',
          'link-hover': '#C7511F',
        },
        page: {
          DEFAULT: '#FFFFFF',
          alt: '#F3F3F3',
          'alt-2': '#EAEDED',
          border: '#DDD',
          'border-strong': '#888C8C',
        },
        ink: {
          DEFAULT: '#0F1111',
          secondary: '#565959',
          muted: '#888',
          'on-dark': '#FFFFFF',
        },
      },
      fontFamily: {
        sans: [
          'Amazon Ember',
          'Inter',
          '-apple-system',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        'amazon-card': '0 2px 5px rgba(15, 17, 17, 0.15)',
        'amazon-pop': '0 0 0 3px rgba(255, 168, 0, 0.5)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
