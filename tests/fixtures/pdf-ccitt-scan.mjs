// Original one-page fixture from Qiaomu Reader 4.5.13 (45dff3c), GPL-3.0-only.
// Add an explicit gray decode inversion so black bits are visibly black on paper.
export function ccittScan() {
  const image = String.fromCharCode(0x35, 0x14);
  const content = 'q 80 0 0 10 0 0 cm /Scan Do Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 10] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Filter /CCITTFaxDecode /DecodeParms << /K 0 /Columns 8 /Rows 1 /BlackIs1 true >> /Length 2 >>\nstream\n${image}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, c => c.charCodeAt(0));
}
