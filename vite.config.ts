import { defineConfig } from 'vite';

// host: true exposes the dev server on your LAN so you can open it on your phone.
// Relative base so the build works from any sub-path (GitHub Pages serves it at /sling-plane/).
export default defineConfig({
  base: './',
  server: { host: true },
});
