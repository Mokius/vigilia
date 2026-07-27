// Bundles the ES modules into a single self-contained dist/index.html.
// Strips local imports + the `export` keyword (all top-level names are unique)
// and keeps one `import * as THREE from 'three'` resolved via the import map.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const ORDER = [
  'src/config.js', 'src/core/util.js', 'src/core/events.js',
  'src/engine/caveRig.js', 'src/engine/postFX.js',
  'src/world/textures.js', 'src/world/room.js', 'src/world/flashlight.js',
  'src/input/input.js', 'src/audio/audioBus.js',
  'src/ai/enemyTypes.js', 'src/ai/enemy.js', 'src/ai/enemyManager.js',
  'src/ui/ui.js', 'src/systems/game.js', 'src/main.js',
];

const strip = (s) => s
  .replace(/^\s*import\s+\*\s+as\s+THREE\s+from\s+['"]three['"];?\s*$/gm, '')
  .replace(/^\s*import\s+.*from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^(\s*)export\s+(const|function|class|let|var|async)\s/gm, '$1$2 ');

const parts = [];
for (const f of ORDER) {
  const txt = await readFile(ROOT + f, 'utf-8');
  parts.push(`\n/* ===== ${f} ===== */\n` + strip(txt));
}
const bundle = `import * as THREE from 'three';\n` + parts.join('\n');

let html = await readFile(ROOT + 'index.html', 'utf-8');
html = html.replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  `<script type="module">\n${bundle}\n</script>`,
);

await mkdir(ROOT + 'dist', { recursive: true });
await writeFile(ROOT + 'dist/index.html', html);
console.log('dist/index.html', html.length, 'bytes');
