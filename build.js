import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

let commitDate = '';
try {
    commitDate = execSync('git log -1 --format=%cd --date=format-local:%Y-%m-%d', { encoding: 'utf8', cwd: __dirname }).trim();
} catch (e) { /* not a git repo or no git */ }

await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/index.js')],
    bundle: true,
    outfile: path.join(dist, 'bundle.js'),
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
});

const bundleHash = crypto.createHash('md5')
    .update(fs.readFileSync(path.join(dist, 'bundle.js')))
    .digest('hex')
    .slice(0, 8);

let bundle = fs.readFileSync(path.join(dist, 'bundle.js'), 'utf8');
bundle = bundle.replace('__BUNDLE_HASH__', bundleHash).replace('__COMMIT_DATE__', commitDate);
fs.writeFileSync(path.join(dist, 'bundle.js'), bundle);

function copy(src, dest) { fs.cpSync(path.join(__dirname, src), path.join(dist, dest), { recursive: true }); }

copy('src/style.css', 'style.css');
copy('src/manifest.json', 'manifest.json');
copy('keywords.json', 'keywords.json');
copy('icons', 'icons');

let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
html = html.replaceAll('dist/', '');
fs.writeFileSync(path.join(dist, 'index.html'), html);

let sw = fs.readFileSync(path.join(__dirname, 'service_worker.js'), 'utf8');
sw = sw.replace('__CACHE_VERSION__', bundleHash);
fs.writeFileSync(path.join(dist, 'service_worker.js'), sw);

copy('node_modules/pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js');
copy('src/doc_processor_worker.js', 'utils/doc_processor_worker.js');

console.log('Build complete: dist/bundle.js + dist/pdf.worker.min.js [cache:' + bundleHash + ']');
