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
    commitDate = execSync('git log -1 --format=%cd --date=short', { encoding: 'utf8', cwd: __dirname }).trim();
} catch (e) { /* not a git repo or no git */ }

const bundleHash = crypto.createHash('md5')
    .update(fs.readFileSync(path.join(__dirname, 'src/index.js')))
    .update(fs.readFileSync(path.join(__dirname, 'src/style.css')))
    .digest('hex')
    .slice(0, 8);

await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/index.js')],
    bundle: true,
    outfile: path.join(dist, 'bundle.js'),
    format: 'iife',
    minify: true,
    define: {
        'process.env.NODE_ENV': '"production"',
        'WORKER_BASE': '"utils/"',
        '__BUNDLE_HASH__': '"' + bundleHash + '"',
        '__COMMIT_DATE__': '"' + commitDate + '"',
    },
});

function copy(src, dest) { fs.cpSync(path.join(__dirname, src), path.join(dist, dest), { recursive: true }); }

copy('src/style.css', 'style.css');
copy('src/manifest.json', 'manifest.json');
copy('keywords.json', 'keywords.json');
copy('icons', 'icons');
copy('fonts', 'fonts');

let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
html = html.replaceAll('dist/', '');
fs.writeFileSync(path.join(dist, 'index.html'), html);

let sw = fs.readFileSync(path.join(__dirname, 'service_worker.js'), 'utf8');
sw = sw.replace('__CACHE_VERSION__', bundleHash);
fs.writeFileSync(path.join(dist, 'service_worker.js'), sw);

copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs');
copy('src/doc_processor_worker.js', 'utils/doc_processor_worker.js');
copy('src/ocr_worker.js', 'utils/ocr_worker.js');

console.log('Build complete: dist/bundle.js + dist/pdf.worker.min.js [cache:' + bundleHash + ']');
