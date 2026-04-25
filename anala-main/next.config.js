/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for FFmpeg-WASM (SharedArrayBuffer).
  // COEP: credentialless allows cross-origin iframes (YouTube) to keep working
  // without requiring them to send CORP headers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy",   value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
