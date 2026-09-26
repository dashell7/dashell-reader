// What Qiaomu Reader shows on Qiaomu Home (see qiaomu-home.js): books in progress with covers, a shortcut to add books,
// and title search over the library. Reads only in-memory state; never opens books or files until the user clicks.
import { homeProvider } from "./qiaomu-home.js";

const MAX_ITEMS = 4;

function lastReadAt(record) {
  const at = record && (record.lastRead || record.updated);
  return typeof at === "number" ? at : Date.parse(at) || 0;
}

function percentOf(record) {
  if (!record) return 0;
  if (typeof record.pct === "number") return Math.min(1, Math.max(0, record.pct));
  return typeof record.percent === "number" ? Math.min(1, Math.max(0, record.percent / 100)) : 0;
}

/**
 * @param {object} plugin the QiaomuReaderPlugin instance
 * @param {(key: string) => string} translate the plugin's UI translator
 */
export function createHomeProvider(plugin, translate) {
  const readableFiles = () => [
    ...plugin.bookFiles(),
    ...Object.keys(plugin.progress || {})
      .filter((path) => path.endsWith(".md"))
      .map((path) => plugin.app.vault.getAbstractFileByPath(path))
      .filter((file) => file?.extension === "md"),
  ];
  const cover = (path) => {
    const url = plugin.thumbCache && plugin.thumbCache[path];
    return typeof url === "string" && url.startsWith("data:image/") ? url : undefined;
  };
  const bookItem = (file) => {
    const record = plugin.getProgress(file.path);
    const progress = percentOf(record);
    const image = cover(file.path);
    return {
      id: file.path,
      title: file.basename,
      subtitle: file.extension.toUpperCase(),
      ...(record ? { meta: `${Math.round(progress * 100)}%`, progress } : {}),
      icon: "book",
      ...(image ? { image } : {}),
      open: () => plugin.openFile(file),
    };
  };

  return homeProvider({
    sections() {
      const books = readableFiles()
        .map((file) => ({ file, at: lastReadAt(plugin.getProgress(file.path)) }))
        .filter((entry) => entry.at > 0)
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_ITEMS)
        .map((entry) => bookItem(entry.file));
      return [{
        id: "continue-reading",
        title: translate("library-continue"),
        items: books,
        empty: translate("no-books"),
        more: { id: "library", label: translate("open-library"), icon: "arrow-up-right", run: () => plugin.openLibrary() },
      }];
    },
    actions() {
      return [{
        id: "add-book",
        label: translate("add-a-book"),
        icon: "book-plus",
        run: async () => {
          await plugin.openLibrary();
          const view = plugin.app.workspace.getLeavesOfType(`${plugin.manifest.id}-library`)[0]?.view;
          if (view && typeof view._pickBooks === "function") view._pickBooks();
        },
      }];
    },
    search(query, limit) {
      const q = query.toLowerCase();
      return readableFiles()
        .filter((file) => file.basename.toLowerCase().includes(q))
        .sort((a, b) => lastReadAt(plugin.getProgress(b.path)) - lastReadAt(plugin.getProgress(a.path)))
        .slice(0, limit)
        .map(bookItem);
    },
  });
}
