import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { bindReaderPageKeys } from "../src/reader-keyboard.js";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const start = source.indexOf("function readerOwnsKeyEvent(");
const end = source.indexOf("\n}\n", start) + 2;
const owns = vm.runInNewContext(`${source.slice(start, end)}; readerOwnsKeyEvent`, { docOf: el => el.ownerDocument });

test("host keys follow reader focus, preserve editing and controls, and ignore another pane or modal", () => {
    const dom = new JSDOM('<main><div class="reader"><p tabindex="-1">page</p><button>toolbar</button><input><select></select><div contenteditable="true"><span>draft</span></div></div><button id="other">other</button></main>');
    const doc = dom.window.document;
    const root = doc.querySelector(".reader");
    const calls = [];
    const reader = { containerEl: root, app: { workspace: { getActiveViewOfType: () => reader } } };
    const cleanup = bindReaderPageKeys(doc, d => calls.push(d), e => owns(reader, e));
    const key = (target, value, options = {}) => {
        const ev = new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
        target.dispatchEvent(ev); return ev.defaultPrevented;
    };
    const page = root.querySelector("p");
    page.focus();
    assert.equal(key(page, " "), true);
    assert.equal(key(page, "ArrowLeft"), true);
    const toolbar = root.querySelector("button");
    toolbar.focus();
    assert.equal(key(toolbar, "ArrowRight"), true);
    assert.equal(key(toolbar, " "), false);
    for (const el of [root.querySelector("input"), root.querySelector("select"), root.querySelector("[contenteditable] span")]) {
        assert.equal(key(el, "ArrowRight"), false);
        assert.equal(key(el, " "), false);
    }
    page.focus();
    assert.equal(key(page, "ArrowRight", { isComposing: true }), false);
    assert.equal(key(page, "ArrowLeft", { shiftKey: true }), false);
    assert.equal(key(page, "ArrowRight", { metaKey: true }), false);
    doc.querySelector("#other").focus();
    assert.equal(key(doc.querySelector("#other"), "ArrowRight"), false);
    const modal = doc.createElement("div"); modal.className = "modal-container"; doc.body.append(modal);
    assert.equal(key(page, "ArrowRight"), false);
    modal.remove();
    cleanup();
    assert.equal(key(page, "ArrowRight"), false);
    assert.deepEqual(calls, ["next", "prev", "next"]);
    dom.window.close();
});

test("full screen PDF and ebook host keys work without iframe focus and detach on close", () => {
    const dom = new JSDOM('<div class="modal-container"><div tabindex="-1" id="page"></div><button>toolbar</button></div>');
    const doc = dom.window.document;
    const root = doc.querySelector(".modal-container");
    const reader = { containerEl: root };
    const calls = [];
    const cleanup = bindReaderPageKeys(doc, d => calls.push(d), e => owns(reader, e));
    for (const [selector, key] of [["#page", " "], ["button", "ArrowRight"], ["#page", "PageUp"]]) {
        const el = doc.querySelector(selector); el.focus();
        el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    reader._closed = true;
    doc.querySelector("#page").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
    cleanup();
    assert.deepEqual(calls, ["next", "next", "prev"]);
    dom.window.close();
});
