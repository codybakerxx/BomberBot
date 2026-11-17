// Builds the whole game into one self-contained file: dist/index.html
//
// 1. esbuild bundles src/main.ts (and everything it imports) into one minified script.
// 2. That script is pasted into src/page.html where the marker /*__BUNDLE__*/ sits.
//
// The result needs no server and no other files. Run it with: npm run build
//
// For the website (and only there) a few files go beside it: the icons from public/ (made by tools/icons.py),
// the app's description for a phone's home screen (manifest.webmanifest), and the service worker (src/sw.js,
// marked with this build's version) that lets the game open with no connection and shows notifications.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const out = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
});

// a literal "</script" inside the code would end the script tag early
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const page = readFileSync('src/page.html', 'utf8');
if (!page.includes('/*__BUNDLE__*/')) throw new Error('src/page.html has lost its /*__BUNDLE__*/ marker');
const html = page.replace('/*__BUNDLE__*/', () => js);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);

for (const f of readdirSync('public')) copyFileSync(`public/${f}`, `dist/${f}`);
const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
writeFileSync('dist/sw.js', readFileSync('src/sw.js', 'utf8').replace('__VERSION__', version));
writeFileSync(
  'dist/manifest.webmanifest',
  JSON.stringify(
    {
      name: 'BomberBot',
      short_name: 'BomberBot',
      description: 'A bomber battle royale with robots, for phones.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#05060b',
      theme_color: '#05060b',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-180.png', sizes: '180x180', type: 'image/png' },
      ],
    },
    null,
    2,
  ),
);
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
