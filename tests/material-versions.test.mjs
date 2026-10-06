import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { load as parseYaml } from "js-yaml";
import { readMaterialVersions, refreshMaterialVersions, resumeMaterialFile } from "../src/material-versions.js";

const manifest = { version: 1, id: "lesson", title: "A lesson", original: "material.md", translation: "translation.md", rewrite: "rewrite.md" };
const markdown = (data = manifest) => `---\ndashell_reader_versions: ${JSON.stringify(data)}\n---\n\nText`;
function files() {
  const files = ["material", "translation", "rewrite"].map(name => ({ path: `Materials/lesson/${name}.md`, extension: "md" }));
  return { files, vault: { read: async () => markdown(), getAbstractFileByPath: path => files.find(file => file.path === path) } };
}

test("legacy version references remain limited to Markdown siblings in the same material folder", () => {
  const result = readMaterialVersions(markdown(), "Materials/lesson/material.md");
  assert.equal(result.versions[1].path, "Materials/lesson/translation.md");
  assert.equal(readMaterialVersions(markdown(), "Other/secret.md"), null);
  assert.equal(readMaterialVersions(markdown({ ...manifest, version: 2 }), "material.md"), null);
  const unsafe = readMaterialVersions(markdown({ ...manifest, translation: "../../private.md" }), "material.md");
  assert.equal(unsafe.versions.length, 2);
  assert.equal(readMaterialVersions("# ordinary note\ndashell_reader_versions: {}", "material.md"), null);
});
test("native Obsidian property edits may expand the manifest into YAML without losing version controls", () => {
  const source = "---\ndashell_reader_versions:\n  version: 1\n  id: lesson\n  original: material.md\n  translation: translation.md\n---\n\nEdited notes";
  assert.equal(readMaterialVersions(source, "Materials/material.md", parseYaml).versions[1].path, "Materials/translation.md");
});
test("title-named article versions stay in the same folder and reject unsafe filenames", () => {
  const named = { ...manifest, original: "A lesson.md", translation: "A lesson - 译文.md", rewrite: "A lesson - 改写.md" };
  const path = "Materials/lesson/A lesson.md";
  const result = readMaterialVersions(markdown(named), path);
  assert.equal(result.versions[1].path, "Materials/lesson/A lesson - 译文.md");
  for (const bad of ["../other.md", "sub/other.md", "sub\\other.md", "C:other.md", ".hidden.md", "bad\nname.md", "bad#name.md", "file.pdf", "A lesson.md"])
    assert.equal(readMaterialVersions(markdown({ ...named, translation: bad }), path).versions.some(item => item.mode === "translation"), false);
});

test("RSS opens the most recently read version and skips deleted or mismatched siblings", async () => {
  const h = files();
  assert.equal(await resumeMaterialFile(h.vault, h.files[0], { [h.files[1].path]: { lastRead: 10 } }), h.files[1]);
  h.vault.read = async file => markdown(file === h.files[1] ? { ...manifest, id: "other" } : manifest);
  assert.equal(await resumeMaterialFile(h.vault, h.files[0], { [h.files[1].path]: { lastRead: 10 } }), h.files[0]);
  const pdf = { extension: "pdf", path: "book.pdf" };
  assert.equal(await resumeMaterialFile(h.vault, pdf, {}), pdf);
});

function surface() {
  const doc = new JSDOM("<!doctype html><body></body>").window.document;
  const proto = doc.defaultView.HTMLElement.prototype;
  proto.empty = function () { this.replaceChildren(); };
  proto.setText = function (text) { this.textContent = text; };
  proto.createEl = function (tag, options = {}) {
    const element = doc.createElement(tag);
    element.className = options.cls || "";
    if (options.text) element.textContent = options.text;
    if (options.value) element.value = options.value;
    this.appendChild(element);
    return element;
  };
  proto.createSpan = function (options) { return this.createEl("span", options); };
  const h = files();
  const slot = doc.body.createEl("div");
  const view = { app: { vault: h.vault }, file: h.files[0], materialVersionSlot: slot, titleEl: doc.body.createEl("div") };
  return { ...h, doc, slot, view };
}
const labels = { version: "阅读版本", original: "原文", translation: "译文", rewrite: "改写" };

test("Reader shows supplied versions and opens the chosen sibling without a second reading UI", async () => {
  const h = surface();
  let opened;
  await refreshMaterialVersions(h.view, labels, async file => { opened = file; }, () => assert.fail("Unexpected error"));
  assert.equal(h.slot.hidden, false);
  assert.equal(h.view.titleEl.textContent, "A lesson");
  const select = h.slot.querySelector("select");
  assert.equal(select.options.length, 3);
  select.value = h.files[1].path;
  select.dispatchEvent(new h.doc.defaultView.Event("change"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, h.files[1]);
});

test("a late manifest read cannot attach the old article's version menu to a new book", async () => {
  const h = surface();
  let release;
  h.vault.read = () => new Promise(resolve => { release = resolve; });
  const pending = refreshMaterialVersions(h.view, labels, async () => assert.fail(), () => assert.fail());
  h.view.file = { path: "book.pdf", extension: "pdf" };
  await refreshMaterialVersions(h.view, labels, async () => assert.fail(), () => assert.fail());
  release(markdown());
  await pending;
  assert.equal(h.slot.hidden, true);
  assert.equal(h.slot.querySelector("select"), null);
});
