// Adapted from Aloud's WebCrypto AWS SigV4 signer (MIT).
// https://github.com/adrianlyjak/obsidian-aloud-tts
const encoder = new TextEncoder();
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const digest = async text => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
async function hmac(key, text) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(text));
}

export async function signPollyRequest({ method, region, path, body = "", accessKeyId, secretAccessKey, now = new Date() }) {
  const host = `polly.${region}.amazonaws.com`;
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = await digest(body);
  const headers = {
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map(name => `${name}:${headers[name]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/polly/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, await digest(canonical)].join("\n");
  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), day);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "polly");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, toSign));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return headers;
}
