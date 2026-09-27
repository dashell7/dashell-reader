import { App, TFile, parseYaml } from "obsidian";

type FrontMatter = { [K in string]: string };

export class FrontMatterManager {
    app: App;

    constructor(app: App) {
        this.app = app;
    }

    // 解析
    async loadFrontMatter(file: TFile): Promise<FrontMatter> {
        let res = {} as FrontMatter;
        let text = await this.app.vault.read(file);

        let match = text.match(/^\n*---\n([\s\S]+?)\n---/);
        if (match) {
            res = parseYaml(match[1]);
        }

        return res;
    }

    async storeFrontMatter(file: TFile, fm: FrontMatter) {
        if (Object.keys(fm).length === 0) {
            return;
        }

        await this.app.fileManager.processFrontMatter(file, current => Object.assign(current, fm));
    }

    // 读取值
    async getFrontMatter(file: TFile, key: string): Promise<string> {
        let frontmatter = await this.loadFrontMatter(file);

        return frontmatter[key];
    }

    // 修改
    async setFrontMatter(file: TFile, key: string, value: string) {
        await this.app.fileManager.processFrontMatter(file, current => { current[key] = value; });
    }
}
