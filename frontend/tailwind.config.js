/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');

export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', ...defaultTheme.fontFamily.sans],
        mono: ['DM Mono', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        'app-bg':      '#090a0f',
        'app-surface': '#101218',
        'app-border':  '#252936',

        // Graphite system — bg -> panel -> elevated
        surface: {
          50:  '#f5f6f8',
          100: '#e4e7ec',
          200: '#c9ced8',
          300: '#9aa3b4',
          400: '#707b91',
          500: '#535d70',
          600: '#3b4352',
          700: '#252b37',
          800: '#171b24',
          850: '#121620',
          900: '#101218',
          950: '#090a0f',
        },

        // Accent is restrained blue for commands/navigation.
        accent: {
          DEFAULT: '#4f8cff',
          dim:     '#2563eb',
          glow:    'rgba(79,140,255,0.20)',
          muted:   'rgba(79,140,255,0.10)',
          soft:    '#93c5fd',
        },

        // Semantic severity
        danger: {
          DEFAULT: '#ef4444',
          dim:     'rgba(239,68,68,0.15)',
        },
        warning: {
          DEFAULT: '#f59e0b',
          dim:     'rgba(245,158,11,0.15)',
        },
        success: {
          DEFAULT: '#10b981',
          dim:     'rgba(16,185,129,0.15)',
        },
      },

      borderRadius: {
        DEFAULT: '0.5rem',
      },

      boxShadow: {
        'panel': '0 1px 0 rgba(255,255,255,0.04) inset, 0 16px 40px rgba(0,0,0,0.28)',
        'focus': '0 0 0 3px rgba(79,140,255,0.20)',
        'glow-sm': '0 0 12px rgba(79,140,255,0.16)',
        'glow':    '0 0 24px rgba(79,140,255,0.20)',
        'glow-lg': '0 0 48px rgba(79,140,255,0.24)',
      },

      animation: {
        'fade-in':    'fadeIn 200ms ease forwards',
        'slide-up':   'slideUp 220ms ease forwards',
        'slide-right':'slideRight 220ms ease forwards',
        'scale-in':   'scaleIn 200ms cubic-bezier(0.34,1.56,0.64,1) forwards',
        'dash-flow':  'dashFlow 1.8s linear infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'spin-slow':  'spin 3s linear infinite',
      },

      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideRight: {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        dashFlow: {
          to: { strokeDashoffset: '-20' },
        },
      },

      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
