// Stable library ordering and import identity, independent of host UI.
export function sortLibrary(files, mode, locale, progress, imports = {}) {
  const collator = new Intl.Collator(locale?.startsWith('zh') ? 'zh-Hans-u-co-pinyin' : locale || 'en', { numeric: true, sensitivity: 'base' });
  return files.sort((a, b) => {
    const score = f => mode === 'added' ? imports[f.path]?.addedAt || f.stat?.ctime || 0
      : mode === 'title' ? 0 : progress(f.path)?.lastRead || 0;
    return score(b) - score(a) || collator.compare(imports[a.path]?.title || a.basename, imports[b.path]?.title || b.basename) || collator.compare(a.path, b.path);
  });
}
export async function bookDigest(bytes, cryptoApi = crypto) {
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export async function findDuplicateBook(bytes, files, records, read, cryptoApi = crypto) {
  const digest = await bookDigest(bytes, cryptoApi);
  for (const file of files) {
    if (file.stat?.size !== bytes.byteLength) continue;
    const old = records[file.path];
    const hash = old?.sha256 && old.mtime === file.stat.mtime && old?.size === file.stat.size ? old.sha256 : await bookDigest(await read(file), cryptoApi);
    records[file.path] = { ...old, sha256: hash, mtime: file.stat.mtime, size: file.stat.size };
    if (hash === digest) return { digest, duplicate: file };
  }
  return { digest, duplicate: null };
}
