import assert from "node:assert/strict";
import fs from "node:fs";
import { setTimeout as nodeSetTimeout } from "node:timers";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const requestSource = source.slice(
  source.indexOf("function aiRequestWithTimeout("),
  source.indexOf("async function aiTestConnection("),
);

function harness(fetch, requestUrl, timeoutMs = 45000) {
  const calls = { fetch: 0, requestUrl: 0 };
  const window = {
    setTimeout: (fn) => nodeSetTimeout(fn, timeoutMs), clearTimeout,
    fetch: (...args) => { calls.fetch += 1; return fetch(...args); },
  };
  const aiExplain = vm.runInNewContext(`${requestSource}\naiExplain`, {
    AbortController, Error, TextDecoder, window,
    aiConfig: () => ({
      id: "test", provider: {}, transport: "http", base: "https://example.test",
      model: "model", needsKey: false, key: "", thinking: false,
    }),
    aiMessages: () => [{ role: "user", content: "question" }],
    buildAiRequestBody: () => ({}),
    buildAiRequestOptions: () => ({ url: "https://example.test/chat/completions", method: "POST", headers: {}, body: "{}" }),
    createOpenAiSseParser: () => ({ push() {}, finish() {} }),
    requestUrl: (...args) => { calls.requestUrl += 1; return requestUrl(...args); },
    classifyAiHttpStatus: (status) => status < 400 ? null : status === 403 ? "forbidden" : "http",
    aiHttpError: (status) => Object.assign(new Error(`http ${status}`), { qiaomuReaderReason: status === 403 ? "forbidden" : "http" }),
    Platform: { isDesktopApp: true },
  });
  return { aiExplain, calls };
}

test("a failed streaming POST is not silently sent again through requestUrl", async () => {
  const h = harness(async () => { throw new TypeError("Failed to fetch"); }, async () => ({ status: 200 }));
  await assert.rejects(
    h.aiExplain("question", { settings: {} }, [], "", { onDelta() {} }),
    (error) => error.qiaomuReaderReason === "streamuncertain",
  );
  assert.deepEqual(h.calls, { fetch: 1, requestUrl: 0 });
});

test("only a later explicitly requested retry uses non-streaming compatibility transport", async () => {
  const h = harness(
    async () => { throw new TypeError("CORS blocked"); },
    async () => ({ status: 200, json: { choices: [{ message: { content: "answer" } }] } }),
  );
  const plugin = { settings: {} };
  await assert.rejects(
    h.aiExplain("question", plugin, [], "", { onDelta() {} }),
    (error) => error.qiaomuReaderReason === "streamuncertain"
      && error.qiaomuReaderStreamTransportUnavailable === true,
  );
  assert.deepEqual(h.calls, { fetch: 1, requestUrl: 0 });
  assert.equal(await h.aiExplain("question", plugin, [], "", { onDelta() {}, forceNonStreaming: true }), "answer");
  assert.deepEqual(h.calls, { fetch: 1, requestUrl: 1 });
  await assert.rejects(h.aiExplain("question", plugin, [], "", { onDelta() {} }));
  assert.deepEqual(h.calls, { fetch: 2, requestUrl: 1 }, "later ordinary sends stay streaming");
});

test("a definite HTTP rejection keeps its existing error reason and does not retry", async () => {
  const h = harness(async () => ({ ok: false, status: 403 }), async () => ({ status: 200 }));
  await assert.rejects(
    h.aiExplain("question", { settings: {} }, [], "", { onDelta() {} }),
    (error) => error.qiaomuReaderReason === "forbidden",
  );
  assert.deepEqual(h.calls, { fetch: 1, requestUrl: 0 });
});

test("a user abort stops fetch and does not trigger a second request", async () => {
  const h = harness((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }), async () => ({ status: 200 }));
  const controller = new AbortController();
  const pending = h.aiExplain("question", { settings: {} }, [], "", { onDelta() {}, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.qiaomuReaderReason === "cancelled");
  assert.deepEqual(h.calls, { fetch: 1, requestUrl: 0 });
});

test("requestUrl timeout reports unknown outcome while the uncancellable request continues", async () => {
  let complete;
  const h = harness(async () => { throw new Error("unused"); }, () => new Promise((resolve) => { complete = resolve; }), 5);
  await assert.rejects(
    h.aiExplain("question", { settings: {} }, [], ""),
    (error) => error.qiaomuReaderReason === "streamuncertain",
  );
  assert.deepEqual(h.calls, { fetch: 0, requestUrl: 1 });
  complete({ status: 200, json: { choices: [{ message: { content: "late" } }] } });
  await Promise.resolve();
  assert.deepEqual(h.calls, { fetch: 0, requestUrl: 1 });
});
