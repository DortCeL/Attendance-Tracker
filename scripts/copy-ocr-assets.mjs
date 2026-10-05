// Self-hosts the Tesseract OCR engine so routine import works offline and without a CDN.
// Only the LSTM-only builds are needed (the app always uses OEM.LSTM_ONLY); the browser
// downloads just one of the three core variants depending on its WebAssembly features.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = "public/ocr";
const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "lang/eng.traineddata.gz"],
];

let copied = 0;
for (const [from, to] of files) {
  const dest = join(OUT, to);
  if (existsSync(dest) && statSync(dest).size === statSync(from).size) continue;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(from, dest);
  copied++;
}
if (copied) console.log(`OCR assets: copied ${copied} file(s) to ${OUT}`);
