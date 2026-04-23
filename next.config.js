/** @type {import('next').NextConfig} */
const nextConfig = {
    // Ez kikapcsolja az ESLint ellenőrzést az építés alatt
    eslint: {
      ignoreDuringBuilds: true,
    },
    // Ez kikapcsolja a TypeScript ellenőrzést az építés alatt
    typescript: {
      ignoreBuildErrors: true,
    },
  }
  
  module.exports = nextConfig