import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readerLookupContext } from "../src/english-lookup-context.js";

function setup(extension, html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const flow = dom.window.document.body;
  const range = dom.window.document.createRange();
  const text = flow.querySelector("p")?.firstChild;
  if (text) { range.setStart(text, 0); range.setEnd(text, Math.min(4, text.length)); }
  const file = { path: `Books/Alice & Wonderland.${extension}`, basename: "Alice & Wonderland", extension };
  const view = { file, pager: { flow }, plugin: { app: { vault: { getName: () => "English 库" } } } };
  return { dom, view, range };
}

test("reader lookup captures an EPUB CFI from the clicked word", () => {
  const { dom, view, range } = setup("epub", "<p>The Rabbit Sends in a Little Bill.</p>");
  const cfi = "epubcfi(/6/30!/4/26,/1:3,/1:7)";
  view.engine = { cfiFromRange: (index, given) => {
    assert.equal(index, 5); assert.equal(given, range); return cfi;
  } };
  const context = readerLookupContext(view, range, 5, view.file.path);
  const link = new URL(context.readerLink);
  assert.equal(context.bookTitle, "Alice & Wonderland");
  assert.equal(link.searchParams.get("book"), view.file.path);
  assert.equal(link.searchParams.get("cfi"), cfi);
  assert.equal(link.searchParams.get("vault"), "English 库");
  assert.equal(readerLookupContext(view, range, 5, "previous.epub").readerLink, undefined);
  dom.window.close();
});

test("Markdown uses a block and PDF uses a physical page; missing anchors stay unlinked", () => {
  const markdown = setup("md", "<p>First.</p><p>Second sentence.</p>");
  const second = markdown.dom.window.document.querySelectorAll("p")[1].firstChild;
  markdown.range.setStart(second, 0); markdown.range.setEnd(second, 6);
  assert.equal(new URL(readerLookupContext(markdown.view, markdown.range, undefined, markdown.view.file.path)
    .readerLink).searchParams.get("block"), "1");
  markdown.dom.window.close();

  const pdf = setup("pdf", '<div data-pdf-page-no="7"><div class="qiaomu-reader-pdf-text-layer"><p>Visible sentence.</p></div></div>');
  assert.equal(new URL(readerLookupContext(pdf.view, pdf.range, undefined, pdf.view.file.path)
    .readerLink).searchParams.get("page"), "7");
  pdf.dom.window.close();

  const missing = setup("pdf", "<p>No page number.</p>");
  assert.equal(readerLookupContext(missing.view, missing.range, undefined, missing.view.file.path).readerLink, undefined);
  missing.dom.window.close();
});
