import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');

fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/index.js')],
    bundle: true,
    outfile: path.join(dist, 'bundle.js'),
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
});

fs.cpSync(path.join(__dirname, 'public'), dist, { recursive: true });

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replaceAll('../dist/', './');
fs.writeFileSync(path.join(dist, 'index.html'), html);

fs.cpSync(path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js'), path.join(dist, 'pdf.worker.min.js'));
fs.mkdirSync(path.join(dist, 'utils'), { recursive: true });
fs.cpSync(path.join(__dirname, 'src/doc_processor_worker.js'), path.join(dist, 'utils/doc_processor_worker.js'));

console.log('Build complete: dist/bundle.js + dist/pdf.worker.min.js');
