import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { watchLearningLayout, bookNoteOpenMode } from '../src/learning-layout.js';

test('learning dock caps preserve host widths and are removed outside reading or on unload', () => {
  const {window} = new JSDOM(`<div class="workspace"><div id="reader"></div><div id="left" class="workspace-split mod-sidedock" style="width:283px"><div class="workspace-leaf-content" data-type="qiaomu-english-search-panel"></div></div><div id="right" class="workspace-split mod-sidedock" style="width:576px"><div class="workspace-leaf-content" data-type="qiaomu-english-learn-panel"></div></div></div>`);
  const doc=window.document, root=doc.querySelector('.workspace'), reader=doc.querySelector('#reader');
  root.getBoundingClientRect=()=>({width:1024});
  let shown=true, next, stop, studyType='qiaomu-reader-english';
  reader.isShown=()=>shown;
  for(const e of doc.querySelectorAll('.workspace-leaf-content'))e.isShown=()=>true;
  window.requestAnimationFrame=fn=>{next=fn;return 1;};window.cancelAnimationFrame=()=>{};
  const events={};
  const workspace={containerEl:root,getLeavesOfType:type=>type===studyType?[{view:{containerEl:reader}}]:[],on:(name,fn)=>{events[name]=fn;},onLayoutReady:fn=>fn()};
  watchLearningLayout({app:{workspace},registerEvent(){},register:fn=>{stop=fn;}});
  next();
  const right=doc.querySelector('#right'),left=doc.querySelector('#left');
  assert.equal(right.style.width,'576px');
  assert.equal(right.style.getPropertyValue('--qbr-learning-dock-limit'),'240px');
  for (const type of ['qiaomu-reader-vocabulary','qiaomu-reader-english-library']) {
    studyType=type;events['active-leaf-change']();next();
    assert.equal(right.style.getPropertyValue('--qbr-learning-dock-limit'),'240px');
  }
  // A different plugin taking over a sidebar immediately removes its cap.
  right.firstElementChild.dataset.type='backlink'; events['active-leaf-change']();next();
  assert.equal(right.classList.contains('qbr-learning-dock'),false);
  assert.equal(left.classList.contains('qbr-learning-dock'),true);
  shown=false;events['layout-change']();next();
  assert.equal(left.classList.contains('qbr-learning-dock'),false);
  shown=true;events['layout-change']();next();stop();
  assert.equal(left.style.getPropertyValue('--qbr-learning-dock-limit'),'');
  assert.equal(left.style.width,'283px');
});

test('a narrow book opens its note in a tab without changing explicit modes',()=>{
  let width=480;
  const workspace={getLeavesOfType:()=>[{view:{containerEl:{isShown:()=>true,getBoundingClientRect:()=>({width})}}}]};
  assert.equal(bookNoteOpenMode(workspace,'split'),'tab');
  assert.equal(bookNoteOpenMode(workspace,'none'),'none');
  width=1000;assert.equal(bookNoteOpenMode(workspace,'split'),'split');
});
