import assert from "node:assert/strict";
import test from "node:test";
import { installZipScheduler } from "../src/zip-scheduler.js";
test("ZIP scheduler preserves native scheduling and provides cancellable timer fallback", () => {
  const native = () => {};
  const desktop = { setImmediate: native };
  installZipScheduler(desktop); assert.equal(desktop.setImmediate, native);
  let task, cancelled;
  const mobile = { setTimeout: fn => { task = fn; return 42; }, clearTimeout: id => { cancelled = id; } };
  installZipScheduler(mobile);
  let value; const handle = mobile.setImmediate(x => { value = x; }, "zip");
  assert.equal(value, undefined); task(); assert.equal(value, "zip");
  mobile.clearImmediate(handle); assert.equal(cancelled, 42);
  assert.throws(() => mobile.setImmediate("arbitrary code"), TypeError);
});
