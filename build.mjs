// Builds the whole game into one self-contained file: dist/index.html
//
// 1. esbuild bundles src/main.ts (and everything it imports) into one minified script.
// 2. That script is pasted into src/page.html where the marker /*__BUNDLE__*/ sits.
//
// The result needs no server and no other files. Run it with: npm run build
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

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
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
