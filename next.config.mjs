/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,

  // The dashboard runs in the browser against Firebase. Trusted work happens in
  // Cloud Functions, so the site itself exports to static files that Firebase
  // Hosting (or any static host) can serve.
  output: 'export',

  // Emits /dashboard/index.html, which static hosts resolve for /dashboard/.
  trailingSlash: true,

  images: { unoptimized: true },
}

export default nextConfig
