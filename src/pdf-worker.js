import JSZip from "jszip";

// Ship the same patched worker offline, compressed rather than as a large JS
// string. JSZip's browser implementation also works on older mobile WebViews.
export async function unpackPdfWorker(payload) {
  const archive = await JSZip.loadAsync(payload, { base64: true });
  const worker = archive.file("pdf.worker.js");
  if (!worker) throw new Error("embedded pdf.worker is missing");
  const code = await worker.async("string");
  if (!code) throw new Error("embedded pdf.worker is empty");
  return code;
}
