const modes = ["original", "translation", "rewrite"];

function isSiblingMarkdown(name) {
  return typeof name === "string" && name.length <= 200 && name.length > 3
    && !name.startsWith(".") && name === name.trim() && name.endsWith(".md")
    && !/[<>:"/\\|?*#[\]^]/.test(name)
    && !Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

// RSS exports a local, versioned manifest in every variant's frontmatter.
// Restrict references to Markdown siblings, and check their shared ID before opening.
export function readMaterialVersions(source, path, parseFrontmatter) {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!frontmatter) return null;
  let data;
  try {
    if (parseFrontmatter) data = parseFrontmatter(frontmatter[1])?.dashell_reader_versions;
    else {
      const line = frontmatter[1].split(/\r?\n/).find(value => value.startsWith("dashell_reader_versions: "));
      if (!line) return null;
      data = JSON.parse(line.slice("dashell_reader_versions: ".length));
    }
  }
  catch { return null; }
  if (!data || data.version !== 1 || typeof data.id !== "string" || !data.id
    || !isSiblingMarkdown(data.original)) return null;
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const seen = new Set();
  const versions = modes.filter(mode => {
    const name = data[mode];
    if (!isSiblingMarkdown(name) || seen.has(name.toLowerCase())) return false;
    seen.add(name.toLowerCase());
    return true;
  }).map(mode => ({ mode, path: folder + data[mode] }));
  if (!versions.some(item => item.path === path)) return null;
  return { id: data.id, title: typeof data.title === "string" ? data.title.slice(0, 2000) : "", versions };
}

export async function materialVersions(vault, file, parseFrontmatter) {
  if (file?.extension !== "md") return null;
  return readMaterialVersions(await vault.read(file), file.path, parseFrontmatter);
}

export async function resumeMaterialFile(vault, file, progress, parseFrontmatter) {
  const manifest = await materialVersions(vault, file, parseFrontmatter);
  if (!manifest) return file;
  const latest = [...manifest.versions].sort((a, b) =>
    (Number(progress[b.path]?.lastRead) || 0) - (Number(progress[a.path]?.lastRead) || 0));
  for (const variant of latest) {
    const target = vault.getAbstractFileByPath(variant.path);
    if (!target || target.extension !== "md") continue;
    if ((await materialVersions(vault, target, parseFrontmatter))?.id === manifest.id) return target;
  }
  return file;
}

export async function refreshMaterialVersions(view, labels, switchFile, onError, parseFrontmatter) {
  const slot = view.materialVersionSlot;
  if (!slot) return;
  const request = (view._materialVersionRequest || 0) + 1;
  view._materialVersionRequest = request;
  slot.empty();
  slot.hidden = true;
  const file = view.file;
  const current = () => !view._closed && view.file === file && view._materialVersionRequest === request;
  try {
    const manifest = await materialVersions(view.app.vault, file, parseFrontmatter);
    if (!current() || !manifest) return;
    if (manifest.title) {
      view._materialTitle = manifest.title;
      view.titleEl?.setText(manifest.title);
      view.leaf?.updateHeader?.();
    }
    const choices = manifest.versions.filter(item => view.app.vault.getAbstractFileByPath(item.path)?.extension === "md");
    if (choices.length < 2) return;
    const label = slot.createEl("label");
    label.createSpan({ cls: "qiaomu-reader-dictionary-visually-hidden", text: labels.version });
    const select = label.createEl("select", { cls: "qiaomu-reader-material-version" });
    for (const choice of choices) select.createEl("option", { value: choice.path, text: labels[choice.mode] });
    select.value = file.path;
    select.addEventListener("change", () => {
      select.disabled = true;
      void (async () => {
        try {
          const target = view.app.vault.getAbstractFileByPath(select.value);
          if (!target || (await materialVersions(view.app.vault, target, parseFrontmatter))?.id !== manifest.id) throw new Error("Missing local version");
          if (current()) await switchFile(target);
        } catch { if (current()) { select.value = file.path; onError(); } }
        finally { if (current()) select.disabled = false; }
      })();
    });
    slot.hidden = false;
  } catch { if (current()) onError(); }
}
