#!/usr/bin/env bash
# Fix common type error patterns
set -e

SRC=/home/kevin/11blog/eleventy-garden/_site/projects/kwpdf/src

# 1. Fix err.message -> (err as Error).message
echo "=== Fixing err.message ==="
for f in "$SRC"/docx-engine.ts "$SRC"/file-handler.ts "$SRC"/keywords.ts "$SRC"/ocr.ts "$SRC"/pdf-loader.ts "$SRC"/pdf-renderer.ts "$SRC"/pdf-search.ts; do
    sed -i 's/\(err\|e\)\.message\([^"]\)/(\1 as Error).message\2/g' "$f"
    sed -i "s/\(err\|e\)\.message$/\($& as Error).message/" "$f"
done

# 2. Fix disabled property on HTMLElement in ui.ts
echo "=== Fixing ui.ts disabled==="
sed -i 's/\(dom\.[a-zA-Z]*\)\.disabled/\1 as HTMLButtonElement).disabled/g' "$SRC"/ui.ts

echo "Done"
