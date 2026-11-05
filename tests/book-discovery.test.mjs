import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { externalBookSearchUrls, gutenbergSearchUrl, gutenbergDetailUrl, parseGutenbergSearch, parseGutenbergEpub, validGutenbergEpub, safeBookFileName, SHELF_ORIGIN, shelfDataUrl, shelfBookUrl, shelfPageUrl, shelfCoverUrl, normalizeShelfBooks, normalizeShelfMarks, searchShelf, toggleShelfMark, markedShelf, pickShelfComments } from "../src/book-discovery.js";

test("external catalog search opens both encoded queries only for nonempty input", () => {
  assert.deepEqual(externalBookSearchUrls("  西游记 & Alice  "), {
    anna: "https://annas-archive.gl/search?q=%E8%A5%BF%E6%B8%B8%E8%AE%B0%20%26%20Alice",
    zlibrary: "https://z-library.sk/s/%E8%A5%BF%E6%B8%B8%E8%AE%B0%20%26%20Alice"
  });
  assert.equal(externalBookSearchUrls("   "), null);
});

const parser = new JSDOM("").window.DOMParser;
const parseXml = (xml) => new parser().parseFromString(xml, "application/xml");
const feed = (entries) => `<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;

test("Gutenberg search keeps book entries and canonical IDs only", () => {
  const xml = feed(`
    <entry><id>https://www.gutenberg.org/ebooks/11.opds</id><title>Alice's Adventures in Wonderland</title><author><name>Lewis Carroll</name></author></entry>
    <entry><id>https://www.gutenberg.org/ebooks/12.opds</id><title>Through the Looking-Glass</title><content type="text">Lewis Carroll</content></entry>
    <entry><id>https://www.gutenberg.org/ebooks/11.opds</id><title>Duplicate</title></entry>
    <entry><id>https://example.org/ebooks/12.opds</id><title>Other host</title></entry>
    <entry><id>https://www.gutenberg.org/ebooks/subjects/search.opds</id><title>Subjects</title></entry>`);
  assert.deepEqual(parseGutenbergSearch(xml, parseXml), [
    { id: "11", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", pageUrl: "https://www.gutenberg.org/ebooks/11" },
    { id: "12", title: "Through the Looking-Glass", author: "Lewis Carroll", pageUrl: "https://www.gutenberg.org/ebooks/12" }
  ]);
  assert.equal(gutenbergSearchUrl("诗 词"), "https://www.gutenberg.org/ebooks/search.opds/?query=%E8%AF%97%20%E8%AF%8D");
  assert.equal(gutenbergDetailUrl("11"), "https://www.gutenberg.org/ebooks/11.opds");
});

test("Gutenberg download counts are not displayed as authors", () => {
  const books = parseGutenbergSearch(feed(`
    <entry><id>/ebooks/11.opds</id><title>Alice</title><content type="text">12,345 downloads</content></entry>
    <entry><id>/ebooks/12.opds</id><title>Looking glass</title><content type="text">1 download</content></entry>
    <entry><id>/ebooks/13.opds</id><title>Author</title><author><name>Lewis Carroll</name></author><content type="text">987 downloads</content></entry>`), parseXml);
  assert.deepEqual(books.map(book => book.author), ["", "", "Lewis Carroll"]);
});

test("EPUB selection accepts only bounded Gutenberg acquisition links", () => {
  const xml = feed(`<entry>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://example.org/ebooks/11.epub.images" length="300"/>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://www.gutenberg.org/ebooks/11.epub.noimages" length="300"/>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://www.gutenberg.org/ebooks/11.epub3.images" length="300"/>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://www.gutenberg.org/ebooks/12.epub.images" length="300"/>
  </entry>`);
  assert.equal(parseGutenbergEpub(xml, "11", parseXml)?.url, "https://www.gutenberg.org/ebooks/11.epub3.images");
  assert.equal(parseGutenbergEpub(feed(""), "11", parseXml), null);
  assert.throws(() => parseGutenbergSearch("<html/>", parseXml));
});

test("download bytes and file names are constrained before vault writes", () => {
  const bytes = new Uint8Array(128);
  bytes.set([0x50, 0x4b, 0x03, 0x04]);
  assert.equal(validGutenbergEpub(bytes.buffer), true);
  bytes[0] = 0x3c;
  assert.equal(validGutenbergEpub(bytes.buffer), false);
  assert.equal(safeBookFileName("A/B: C", "11"), "A B C (Gutenberg 11).epub");
});

test("public shelf endpoints accept only fixed data names and opaque book IDs", () => {
  assert.equal(SHELF_ORIGIN, "https://hackerbooks.qiaomu.ai");
  assert.equal(shelfDataUrl("books"), SHELF_ORIGIN + "/data/books.json");
  assert.equal(shelfBookUrl("OL123W"), SHELF_ORIGIN + "/data/book/OL123W.json");
  assert.equal(shelfPageUrl("OL123W"), SHELF_ORIGIN + "/b/OL123W");
  assert.equal(shelfCoverUrl(123), SHELF_ORIGIN + "/covers/123.webp");
  assert.equal(shelfCoverUrl(Number.MAX_SAFE_INTEGER + 1), "");
  assert.throws(() => shelfDataUrl("../book/OL1W"));
  assert.throws(() => shelfBookUrl("https://example.org"));
  assert.throws(() => shelfPageUrl("OL1W/../../vault"));
});

test("shelf data is normalized and title and author searches remain local", () => {
  const [book] = normalizeShelfBooks([
    { id: "OL1W", t: "The Making of the Atomic Bomb", tz: "原子弹", a: ["Richard Rhodes"], tp: ["history"], u: 12, ru: 6, q: 82 },
    { id: "../vault", t: "Invalid identity", a: ["Someone"] },
    { id: "OL2W", t: "", a: [] }
  ]);
  assert.equal(book.id, "OL1W");
  assert.deepEqual(searchShelf([book], "atomic bomb"), [book]);
  assert.deepEqual(searchShelf([book], "Richard Rhodes"), [book]);
  assert.deepEqual(searchShelf([book], "unmatched"), []);
  assert.throws(() => normalizeShelfBooks({ books: [] }));
});

test("local reading marks reject invalid rows, toggle cleanly and stay bounded", () => {
  const marks = normalizeShelfMarks({
    OL1W: { s: "wish", at: 10 },
    OL2W: { s: "read", at: 20 },
    OL3W: { s: "other", at: 30 },
    "../vault": { s: "read", at: 40 },
    OL4W: { s: "read", at: "later" }
  });
  assert.deepEqual(marks, { OL2W: { s: "read", at: 20 }, OL1W: { s: "wish", at: 10 }, OL4W: { s: "read", at: 0 } });
  const read = toggleShelfMark(marks, "OL1W", "read", 50);
  assert.deepEqual(read.OL1W, { s: "read", at: 50 });
  assert.equal(Object.hasOwn(toggleShelfMark(read, "OL1W", "read", 60), "OL1W"), false);
  assert.equal(toggleShelfMark(read, "OL1W", "invalid", 70), read);
  const full = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => ["OL" + i + "W", { s: "read", at: i }]));
  const bounded = toggleShelfMark(full, "OL5000W", "wish", 5000);
  assert.equal(Object.keys(bounded).length, 5000);
  assert.equal(Object.hasOwn(bounded, "OL0W"), false);
  assert.equal(bounded.OL5000W.s, "wish");
});

test("reading lists return known books in last-marked order and comments keep a critical voice", () => {
  const books = [{ id: "OL1W", t: "One" }, { id: "OL2W", t: "Two" }];
  const byId = new Map(books.map(book => [book.id, book]));
  const marks = { OL1W: { s: "wish", at: 1 }, OL2W: { s: "wish", at: 3 }, OL9W: { s: "wish", at: 4 } };
  assert.deepEqual(markedShelf(byId, marks, "wish"), [books[1], books[0]]);
  const comments = [
    { id: 1, stance: "r" },
    { id: 2, stance: "r" },
    { id: 3, stance: "c" },
    { id: 4, stance: "n" }
  ];
  assert.deepEqual(pickShelfComments(comments).map(item => item.id), [1, 2, 3]);
});
