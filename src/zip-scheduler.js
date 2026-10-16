// JSZip expects setImmediate for asynchronous ZIP processing. Modern Obsidian
// has timers; retain native scheduling where available and use a cancellable
// timer elsewhere. No legacy script-element scheduling or string execution.
export function installZipScheduler(target) {
  if (typeof target.setImmediate === "function") return;
  target.setImmediate = (callback, ...args) => {
    if (typeof callback !== "function") throw new TypeError("Expected a callback");
    return target.setTimeout(() => callback(...args), 0);
  };
  target.clearImmediate = handle => target.clearTimeout(handle);
}
// In Obsidian, JSZip executes in this window's JavaScript realm.
// Node test/build hosts already supply native setImmediate.
if (typeof window !== "undefined") installZipScheduler(window);

// The Promise fallback's `immediate` dependency needs a function scheduler too.
export default function scheduleZipTask(callback) {
  if (typeof callback !== "function") throw new TypeError("Expected a callback");
  return window.setTimeout(callback, 0);
}
