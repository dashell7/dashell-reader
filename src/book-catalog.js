// One bounded, credential-free metadata shape for every import source.
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 1000) : '';
const people = value => (Array.isArray(value) ? value.slice(0, 20) : [value]).map(x => text(x?.name ?? x)).filter(Boolean).join(', ').slice(0, 1000);
export function bookMetadata(value = {}) {
  value ||= {};
  const fields = { title: text(value.title), author: people(value.author || value.authors), year: text(value.year || value.published || value.date).slice(0, 40), language: people(value.language), isbn: text(value.isbn), publisher: people(value.publisher), source: text(value.source), sourceId: text(value.sourceId) };
  const identifier = value.identifier;
  if (!fields.isbn && typeof identifier === 'string' && /^(?:urn:isbn:)?[\dXx -]{10,25}$/.test(identifier)) fields.isbn = identifier.replace(/^urn:isbn:/, '');
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
}
export function catalogMetadata(settings = {}, path) {
  const calibre = Object.values(settings.calibreImports || {}).find(x => x?.path === path);
  return { ...bookMetadata(calibre), ...bookMetadata(settings.bookImports?.[path]) };
}
export function bookMatches(file, metadata, query) {
  const needle = String(query || '').normalize('NFKC').toLocaleLowerCase().trim();
  return !needle || [file?.basename, metadata?.title, metadata?.author, metadata?.isbn, metadata?.year, metadata?.language].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase().includes(needle);
}
