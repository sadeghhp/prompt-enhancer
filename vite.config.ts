import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

/** Build number = number of commits on the current branch; 0 outside a repo. */
function buildNumber() {
  try {
    return execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return '0'
  }
}

export default defineConfig({
  // Version / build stamp baked in at build time and shown in the footer.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_NUMBER__: JSON.stringify(buildNumber()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // Relative base so the build works both at a domain root and under a
  // subpath like GitHub Pages' https://<user>.github.io/<repo>/
  base: './',
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        settings: resolve(__dirname, 'settings.html'),
      },
    },
  },
})
