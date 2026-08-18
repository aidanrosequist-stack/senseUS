/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        indigo: {
          brand: '#2D3DCA',
        },
        green: {
          brand: '#52B788',
        },
      },
    },
  },
  plugins: [],
}