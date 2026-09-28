import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const vue = fs.readFileSync(new URL('../src/learning/vendor/dictionary/mdict/View.vue', import.meta.url), 'utf8');
const script = vue.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
  .replace(/^import .*;\r?\n/gm, '');
assert.ok(script, 'MDict view script is available');
const js = ts.transpileModule(`${script}\nglobalThis.__mdictTest = { renderHtml, htmlContainer };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.None },
}).outputText;

function setup(resources = {}, standaloneCss = '', cssSupported = true) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="outside" class="definition">outside</div><div id="dictionary"></div></body></html>', {
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const engine = {
    hasMdd: () => true,
    lookupResource: key => resources[key] || null,
    getStandaloneCss: () => standaloneCss,
  };
  // jsdom has CSSOM parsing for attached styles, but no constructable stylesheet.
  // Keep this test-only shim off the plugin's runtime path.
  class TestStyleSheet {
    replaceSync(css) {
      const element = document.createElement('style');
      element.textContent = css;
      document.head.appendChild(element);
      this.cssRules = element.sheet.cssRules;
      // jsdom 29 drops @font-face src during CSSOM parsing; restore that one
      // declaration so the runtime's resource-resolution branch is exercised.
      const fontSrc = css.match(/@font-face\s*\{[^}]*\bsrc\s*:\s*(url\([^)]*\))/i)?.[1];
      const face = Array.from(this.cssRules).find(rule => rule.type === 5);
      if (face && fontSrc) {
        const getPropertyValue = face.style.getPropertyValue.bind(face.style);
        face.style.getPropertyValue = name => name === 'src' ? fontSrc : getPropertyValue(name);
      }
      element.remove();
    }
  }
  const context = {
    DOMParser: dom.window.DOMParser,
    CSSStyleSheet: cssSupported ? TestStyleSheet : undefined,
    document,
    window: dom.window,
    CustomEvent: dom.window.CustomEvent,
    Buffer,
    URL: dom.window.URL,
    Blob: dom.window.Blob,
    Audio: class {},
    defineProps: () => ({ word: 'word', dictId: 'test' }),
    defineEmits: () => () => {},
    ref: value => ({ value }),
    nextTick: () => Promise.resolve(),
    useLoading: () => {},
    getMdictEngine: () => engine,
  };
  vm.runInNewContext(js, context);
  const container = document.querySelector('#dictionary');
  context.__mdictTest.htmlContainer.value = container;
  return { dom, container, render: context.__mdictTest.renderHtml };
}

test('MDict HTML removes executable markup and unsafe URLs while retaining entry actions', () => {
  const icon = Buffer.from('fake-png');
  const sound = Buffer.from('fake-audio');
  const { dom, container, render } = setup({ '\\icon.png': icon, '\\word.mp3': sound });
  let searched = '';
  dom.window.addEventListener('qiaomu-english-event-search', event => { searched = event.detail.selection; });
  render(`
    <script>window.injected = true</script>
    <svg onload="window.injected=true"><circle /></svg>
    <iframe src="https://attacker.example"></iframe>
    <form action="https://attacker.example"><input name="password"></form>
    <div id="entry" class="definition" onclick="window.injected=true" style="color:red;background-image:url(https://attacker.example/pixel)">
      <img src="icon.png" onerror="window.injected=true" alt="icon">
      <img src="https://attacker.example/pixel.png" alt="remote">
      <a href="javascript:alert(1)">unsafe</a>
      <a href="entry://another" onclick="window.injected=true">another</a>
      <a href="sound://word.mp3">sound</a>
      <a href="https://example.com">website</a>
    </div>
  `);
  assert.equal(dom.window.injected, undefined);
  assert.equal(container.querySelector('script, svg, iframe, form, input'), null);
  assert.equal(container.querySelector('[onclick], [onerror], [action], [srcset]'), null);
  assert.equal(container.querySelector('a[href^="javascript:"]'), null);
  assert.equal(container.querySelector('img[alt="remote"]'), null);
  assert.match(container.querySelector('img[alt="icon"]').src, /^data:image\/png;base64,/);
  assert.match(container.querySelector('[data-mdict-original-id="entry"]').id, /^qre-mdict-.*-id-0$/);
  assert.equal(container.querySelector('.definition').style.color, 'red');
  assert.equal(container.querySelector('.definition').style.backgroundImage, '');
  assert.equal(container.querySelector('.mdict-sound-btn').getAttribute('data-sound'), 'word.mp3');
  assert.equal(container.querySelector('a[href="https://example.com"]').rel, 'noopener noreferrer');
  assert.equal(dom.window.document.querySelector('#outside').getAttribute('class'), 'definition');
  container.querySelector('.mdict-entry-link').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(searched, 'another');
  dom.window.close();
});

test('MDict CSS stays in its result and resolves only local MDD media and fonts', () => {
  const css = Buffer.from('body { color: navy } .definition { color: blue; background-image: url(icon.png) } #entry { font-weight: bold } @import url(https://attacker.example/a.css); @font-face { font-family: DictFont; src: url(dict.woff2) } .definition { font-family: DictFont }');
  const { dom, container, render } = setup({
    '\\dict.css': css,
    '\\icon.png': Buffer.from('fake-png'),
    '\\dict.woff2': Buffer.from('fake-font'),
  }, '.definition { background-image: url(https://attacker.example/pixel) }');
  render('<link rel="stylesheet" href="dict.css"><div id="entry" class="definition">meaning</div>');
  const safeCss = container.querySelector('style')?.textContent || '';
  assert.match(safeCss, /#qre-mdict-.* :is\(\.definition\)/);
  assert.match(safeCss, /#qre-mdict-.*-id-0/);
  assert.match(safeCss, /data:image\/png;base64,/);
  assert.match(safeCss, /data:font\/woff2;base64,/);
  assert.doesNotMatch(safeCss, /@import|attacker\.example|(^|})\s*body\s*\{/);
  assert.equal(dom.window.document.querySelectorAll('style').length, 1);
  assert.equal(container.querySelector('.definition').textContent, 'meaning');
  assert.notEqual(dom.window.getComputedStyle(dom.window.document.querySelector('#outside')).color, 'blue');
  dom.window.close();
});

test('older engines without constructable stylesheets still display sanitized definitions', () => {
  const { dom, container, render } = setup({}, '.definition { color: red }', false);
  render('<style>body { display: none }</style><div class="definition" onclick="window.injected=true">visible meaning</div>');
  assert.equal(container.querySelector('style'), null);
  assert.equal(container.querySelector('.definition').textContent, 'visible meaning');
  assert.equal(container.querySelector('[onclick]'), null);
  dom.window.close();
});
