module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',
        accent: '#06b6d4',
      },
      backgroundImage: {
        gradient: 'linear-gradient(135deg, #2563eb, #06b6d4)',
      },
    },
  },
  plugins: [],
}
