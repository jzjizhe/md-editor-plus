const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

async function main() {
  // Build KaTeX CSS with fonts inlined as data URIs
  const katexResult = await esbuild.build({
    entryPoints: ['node_modules/katex/dist/katex.min.css'],
    bundle: true,
    write: false,
    loader: {
      '.woff2': 'dataurl',
      '.woff': 'dataurl',
      '.ttf': 'dataurl',
    },
  });
  const katexCssContent = katexResult.outputFiles[0].text;
  // Write as a JS module that exports the CSS string
  const katexModulePath = path.join(__dirname, 'src/webview/_katex-css.ts');
  fs.writeFileSync(katexModulePath, `// Auto-generated — do not edit\nexport default ${JSON.stringify(katexCssContent)};\n`);

  const ctx = await esbuild.context({
    entryPoints: ['src/webview/index.ts'],
    bundle: true,
    outfile: 'dist/webview.js',
    format: 'iife',
    platform: 'browser',
    sourcemap: true,
    loader: { '.css': 'text' },
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching webview...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Webview built.');
  }
}

main().catch(console.error);
