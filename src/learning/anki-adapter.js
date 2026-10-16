import { ankiNote } from '../anki.js';

const html = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const sourceLink = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'obsidian:' && ['dashell-reader', 'qiaomu-reader-english'].includes(url.hostname) ? url.href : '';
  } catch { return ''; }
};

// The learning database remains the vocabulary owner. Exporting to Anki never
// rewrites vocabulary notes, learning status, hand edits or SR scheduling.
export function learningAnkiNotes(records, deck) {
  const seen = new Set(), notes = [];
  for (const record of records) {
    const word = String(record?.expression || '').trim();
    const key = word.toLowerCase();
    if (!key || seen.has(key) || !String(record.meaning || '').trim() || record.status === 0) continue;
    seen.add(key);
    const contexts = (record.sentences || []).map(sentence => {
      const link = sourceLink(sentence.readerLink);
      const origin = html(sentence.origin || sentence.source?.bookTitle || '');
      return `${html(sentence.text)}${sentence.trans ? '<br>' + html(sentence.trans) : ''}${link ? `<br><a href="${html(link)}">${origin || 'Source'}</a>` : origin ? '<br>' + origin : ''}`;
    }).join('<br><br>');
    notes.push(ankiNote(deck, { Word: html(word), Meaning: html(record.meaning).replace(/\n/g, '<br>'), Context: contexts }, record.tags || []));
  }
  return notes;
}

// Observe successful manual saves in one place: the full learning panel and
// hover actions use the same DB. Sync failures cannot change the committed
// vocabulary result, and SR review writes must not trigger network traffic.
export function attachVocabularyAnkiSync(db, sync, onError = () => {}) {
  const original = db.postExpression;
  const wrapped = async function (record, options) {
    const result = await original.call(this, record, options);
    if (result === 200 && options?.source !== 'review' && record?.status !== 0) {
      void Promise.resolve().then(() => sync(record.expression)).catch(onError);
    }
    return result;
  };
  db.postExpression = wrapped;
  return () => { if (db.postExpression === wrapped) db.postExpression = original; };
}
