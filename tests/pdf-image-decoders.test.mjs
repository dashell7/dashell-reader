import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EmbeddedPdfBinaryDataFactory, PDF_CMAP_OPTIONS } from '../src/pdf-cmaps.js';
import { ccittScan } from './fixtures/pdf-ccitt-scan.mjs';

test('embedded image/color decoders match the locked pdf.js resources', async () => {
  const factory = new EmbeddedPdfBinaryDataFactory();
  for (const filename of ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm']) {
    const bytes = await factory.fetch({ kind: 'wasmUrl', filename });
    assert.deepEqual(Buffer.from(bytes), fs.readFileSync(new URL(`../node_modules/pdfjs-dist/wasm/${filename}`, import.meta.url)));
    assert.equal(WebAssembly.validate(bytes), true);
  }
  await assert.rejects(factory.fetch({ kind: 'wasmUrl', filename: 'missing.wasm' }), /unavailable/);
  await assert.rejects(factory.fetch({ kind: 'font', filename: 'missing' }), /Unsupported/);
  await assert.rejects(factory.fetch({ kind: 'wasmUrl', filename: 'quickjs-eval.wasm' }), /unavailable/);
});

test('image-only CCITT PDF decodes offline without a text layer', async () => {
  const task = getDocument({ data: ccittScan(), ...PDF_CMAP_OPTIONS, isEvalSupported: false });
  try {
    const page = await (await task.promise).getPage(1);
    assert.equal((await page.getTextContent()).items.length, 0);
    const operators = await page.getOperatorList();
    const i = operators.fnArray.indexOf(OPS.paintImageXObject);
    assert.ok(i >= 0, 'the scan must reach the image painting operation');
    const image = await new Promise(resolve => page.objs.get(operators.argsArray[i][0], resolve));
    assert.equal(image.width, 8);
    assert.equal(image.height, 1);
    assert.ok(image.data || image.bitmap, 'decoded pixels must exist');
    assert.equal(image.data[0], 0, 'the scan must contain black pixels, not a blank white page');
  } finally { await task.destroy(); }
});

test('concurrent documents receive independent transferable decoder bytes', async () => {
  const factory = new EmbeddedPdfBinaryDataFactory();
  const [first, second] = await Promise.all([
    factory.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' }),
    factory.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' }),
  ]);
  assert.notEqual(first.buffer, second.buffer);
  const transferred = structuredClone(first, { transfer: [first.buffer] });
  assert.equal(first.byteLength, 0);
  assert.equal(WebAssembly.validate(second), true);
  const third = await factory.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' });
  assert.deepEqual(third, transferred);
});

test('existing offline CMaps remain independently transferable', async () => {
  const factory = new EmbeddedPdfBinaryDataFactory();
  const options = { kind: 'cMapUrl', filename: 'Adobe-CNS1-UCS2.bcmap' };
  const first = await factory.fetch(options);
  assert.deepEqual(Buffer.from(first), fs.readFileSync(new URL('../node_modules/pdfjs-dist/cmaps/Adobe-CNS1-UCS2.bcmap', import.meta.url)));
  structuredClone(first, { transfer: [first.buffer] });
  assert.ok((await factory.fetch(options)).byteLength > 0);
  await assert.rejects(factory.fetch({ kind: 'cMapUrl', filename: 'missing.bcmap' }), /unavailable/);
});
