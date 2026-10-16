import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import JSZip from 'jszip';
import { unpackPdfWorker } from '../src/pdf-worker.js';

test('compressed embedded PDF worker restores all source bytes, including Unicode', async () => {
  const source='/* PDF 中文 */\nself.onmessage = () => "标点。";\n';
  const archive=new JSZip();archive.file('pdf.worker.js',source);
  const payload=await archive.generateAsync({type:'base64',compression:'DEFLATE'});
  assert.equal(await unpackPdfWorker(payload),source);
  await assert.rejects(unpackPdfWorker('invalid archive'));
  const empty=new JSZip();empty.file('other.js','other');
  await assert.rejects(unpackPdfWorker(await empty.generateAsync({type:'base64'})),/missing/);
});

test('PDF worker initialization coalesces concurrent requests and retries after failure', async () => {
  const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const start=source.indexOf('let workerReady = false;');
  const end=source.indexOf('const QiaomuBookReader',start);
  let release, calls=0, urls=0;
  const pdfjsLib={GlobalWorkerOptions:{}};
  const setup=vm.runInNewContext(source.slice(start,end)+'\nsetupWorker',{
    unpackPdfWorker:()=>{calls++;return new Promise((resolve,reject)=>{release={resolve,reject};});},
    __PDF_WORKER_ARCHIVE__:'archive',pdfjsLib,Blob,
    URL:{createObjectURL:()=>{urls++;return 'blob:worker';}},console:{error(){}},
    Notice:class{},qiaomuReaderTranslate:key=>key,
  });
  const first=setup(),second=setup();release.reject(new Error('corrupt'));
  await assert.rejects(first,/corrupt/);await assert.rejects(second,/corrupt/);
  assert.equal(calls,1);assert.equal(urls,0);
  const retry=setup(),concurrent=setup();release.resolve('worker source');
  await Promise.all([retry,concurrent]);await setup();
  assert.equal(calls,2);assert.equal(urls,1);assert.equal(pdfjsLib.GlobalWorkerOptions.workerSrc,'blob:worker');
});
