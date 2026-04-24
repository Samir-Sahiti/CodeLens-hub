/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        'app-bg': '#0c0d14',
        'app-surface': '#111218',
        'app-border': '#1e1f2e',
      },
    },
  },
  plugins: [],
};
