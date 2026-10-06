export const LEGACY_READER_PLUGIN_ID = "qiaomu-reader-english";

const STATE_FILES = [
  "reading-progress.json",
  "reading-progress-recovery.json",
  "reading-highlights.json",
  "thumb-cache.json",
  "ai-drafts.json",
];

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function baseName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function joinPath(parent, child) {
  return parent ? `${parent}/${child}` : child;
}

async function ensureDirectory(adapter, path) {
  if (!path || await adapter.exists(path)) return;
  await ensureDirectory(adapter, parentPath(path));
  await adapter.mkdir(path);
}

async function copyFile(adapter, source, target, transform) {
  if (!await adapter.exists(source) || await adapter.exists(target)) return false;
  await ensureDirectory(adapter, parentPath(target));
  let content = await adapter.read(source);
  if (transform) content = transform(content);
  await adapter.write(target, content);
  return true;
}

async function copyDirectory(adapter, source, target) {
  if (!await adapter.exists(source)) return [];
  await ensureDirectory(adapter, target);
  const listing = await adapter.list(source);
  const copied = [];
  for (const folder of listing.folders || []) {
    const destination = joinPath(target, baseName(folder));
    copied.push(...await copyDirectory(adapter, folder, destination));
  }
  for (const file of listing.files || []) {
    const destination = joinPath(target, baseName(file));
    if (await copyFile(adapter, file, destination)) copied.push(destination);
  }
  return copied;
}

function remapRecoveryPath(content, oldProgressPath, newProgressPath) {
  try {
    const record = JSON.parse(content);
    if (record && record.sourcePath === oldProgressPath) {
      record.sourcePath = newProgressPath;
      return JSON.stringify(record, null, 2);
    }
  } catch { /* Preserve malformed recovery data for diagnosis. */ }
  return content;
}

/** Copy user data once when the plugin folder changes; keep the old files intact. */
export async function migrateLegacyReaderData(adapter, oldPluginDir, newPluginDir) {
  const oldDir = normalizePath(oldPluginDir);
  const newDir = normalizePath(newPluginDir);
  if (!adapter || !oldDir || !newDir || oldDir === newDir) return { migrated: false, copied: [] };

  const newDataPath = joinPath(newDir, "data.json");
  if (await adapter.exists(newDataPath)) return { migrated: false, copied: [] };
  if (!await adapter.exists(oldDir)) return { migrated: false, copied: [] };

  const oldProgressPath = joinPath(oldDir, "reading-progress.json");
  const newProgressPath = joinPath(newDir, "reading-progress.json");
  const copied = [];

  for (const name of STATE_FILES) {
    const source = joinPath(oldDir, name);
    const target = joinPath(newDir, name);
    const transform = name === "reading-progress-recovery.json"
      ? (content) => remapRecoveryPath(content, oldProgressPath, newProgressPath)
      : undefined;
    if (await copyFile(adapter, source, target, transform)) copied.push(target);
  }

  copied.push(...await copyDirectory(adapter, joinPath(oldDir, "_reader-rescue"), joinPath(newDir, "_reader-rescue")));

  // Write data.json last so an interrupted migration can resume without treating
  // a partially copied directory as complete on the next startup.
  const oldDataPath = joinPath(oldDir, "data.json");
  if (await copyFile(adapter, oldDataPath, newDataPath)) copied.push(newDataPath);

  return { migrated: copied.length > 0, copied };
}
