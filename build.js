import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/index.js')],
    bundle: true,
    outfile: path.join(__dirname, 'bundle.js'),
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
});

fs.copyFileSync(
    path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js'),
    path.join(__dirname, 'pdf.worker.min.js')
);

console.log('Build complete: bundle.js + pdf.worker.min.js');
