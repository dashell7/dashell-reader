import type { WordColorTheme } from "../settings/types";

type ReadingPalette = { dark: string; light: string };

// Unknown words are common in a learning article, so their marks stay quieter
// than actively studied words. Known, learned, and ignored words read as prose.
// The six saved theme IDs are stable; only their visual treatment changes.
const PALETTES: Record<WordColorTheme, ReadingPalette> = {
    vivid: {
        // Soft: a barely tinted dotted cue for new words, warmer emphasis for study.
        dark: `
            --langr-new-color: var(--text-normal);
            --langr-new-bg: rgba(89, 140, 196, 0.05);
            --langr-new-border: 1px dotted #829fba;
            --langr-learning-color: #e7c27c;
            --langr-learning-bg: rgba(179, 130, 44, 0.12);
            --langr-learning-border: 1px solid #c5a064;
            --langr-familiar-color: var(--text-normal);
            --langr-familiar-bg: transparent;
            --langr-familiar-border: 1px dashed #85b9ac;
            --langr-new-hover-bg: rgba(89, 140, 196, 0.14);
            --langr-learning-hover-bg: rgba(179, 130, 44, 0.20);
            --langr-familiar-hover-bg: rgba(84, 159, 144, 0.11);`,
        light: `
            --langr-new-bg: rgba(67, 119, 173, 0.04);
            --langr-new-border: 1px dotted #4c789f;
            --langr-learning-color: #80521e;
            --langr-learning-bg: rgba(207, 152, 46, 0.09);
            --langr-learning-border: 1px solid #8b601f;
            --langr-familiar-border: 1px dashed #2e7b6d;
            --langr-new-hover-bg: rgba(67, 119, 173, 0.10);
            --langr-learning-hover-bg: rgba(207, 152, 46, 0.17);
            --langr-familiar-hover-bg: rgba(39, 131, 112, 0.08);`,
    },
    underline: {
        // Lines: status remains visible without filling the reading line.
        dark: `
            --langr-new-color: #9ebad6;
            --langr-new-bg: transparent;
            --langr-new-border: 1px dotted #9ebad6;
            --langr-learning-color: #e7c27c;
            --langr-learning-bg: transparent;
            --langr-learning-border: 1.5px solid #e7c27c;
            --langr-familiar-color: #95c0b4;
            --langr-familiar-bg: transparent;
            --langr-familiar-border: 1px dashed #95c0b4;
            --langr-new-hover-bg: rgba(94, 144, 194, 0.10);
            --langr-learning-hover-bg: rgba(179, 130, 44, 0.11);
            --langr-familiar-hover-bg: rgba(84, 159, 144, 0.10);`,
        light: `
            --langr-new-color: #285e96;
            --langr-new-border: 1px dotted #285e96;
            --langr-learning-color: #805116;
            --langr-learning-border: 1.5px solid #805116;
            --langr-familiar-color: #176d64;
            --langr-familiar-border: 1px dashed #176d64;
            --langr-new-hover-bg: rgba(40, 94, 150, 0.07);
            --langr-learning-hover-bg: rgba(128, 81, 22, 0.07);
            --langr-familiar-hover-bg: rgba(23, 109, 100, 0.07);`,
    },
    background: {
        // Highlight: soft marker fills; line styles distinguish study states.
        dark: `
            --langr-new-color: var(--text-normal);
            --langr-new-bg: rgba(76, 126, 181, 0.20);
            --langr-new-border: none;
            --langr-learning-color: var(--text-normal);
            --langr-learning-bg: rgba(174, 126, 45, 0.27);
            --langr-learning-border: 1px solid #c9a469;
            --langr-familiar-color: var(--text-normal);
            --langr-familiar-bg: rgba(65, 145, 125, 0.17);
            --langr-familiar-border: 1px dashed #83b6a7;
            --langr-new-hover-bg: rgba(76, 126, 181, 0.29);
            --langr-learning-hover-bg: rgba(174, 126, 45, 0.36);
            --langr-familiar-hover-bg: rgba(65, 145, 125, 0.25);`,
        light: `
            --langr-new-bg: rgba(73, 133, 193, 0.13);
            --langr-learning-bg: rgba(226, 172, 59, 0.23);
            --langr-learning-border: 1px solid #a3741d;
            --langr-familiar-bg: rgba(67, 158, 138, 0.13);
            --langr-familiar-border: 1px dashed #398373;
            --langr-new-hover-bg: rgba(73, 133, 193, 0.21);
            --langr-learning-hover-bg: rgba(226, 172, 59, 0.31);
            --langr-familiar-hover-bg: rgba(67, 158, 138, 0.21);`,
    },
    minimal: {
        // Minimal intentionally hides familiar and completed states.
        dark: `
            --langr-new-color: var(--text-normal);
            --langr-new-bg: transparent;
            --langr-new-border: 1px dotted #9ab4ce;
            --langr-learning-color: #e7c27c;
            --langr-learning-bg: transparent;
            --langr-learning-border: 1px solid #e7c27c;
            --langr-familiar-color: var(--text-normal);
            --langr-familiar-bg: transparent;
            --langr-familiar-border: none;
            --langr-new-hover-bg: rgba(94, 144, 194, 0.08);
            --langr-learning-hover-bg: rgba(179, 130, 44, 0.10);
            --langr-familiar-hover-bg: var(--background-modifier-hover);`,
        light: `
            --langr-new-border: 1px dotted #4776a3;
            --langr-learning-color: #805116;
            --langr-learning-border: 1px solid #805116;
            --langr-new-hover-bg: rgba(71, 118, 163, 0.06);
            --langr-learning-hover-bg: rgba(128, 81, 22, 0.07);`,
    },
    lingq: {
        // LingQ retains its blue/amber/yellow blocks, with gentler opacity.
        dark: `
            --langr-new-color: var(--text-normal);
            --langr-new-bg: rgba(57, 106, 165, 0.30);
            --langr-new-border: none;
            --langr-learning-color: var(--text-normal);
            --langr-learning-bg: rgba(138, 98, 27, 0.45);
            --langr-learning-border: 1px solid #c9aa70;
            --langr-familiar-color: var(--text-normal);
            --langr-familiar-bg: rgba(142, 122, 55, 0.24);
            --langr-familiar-border: 1px dashed #bba359;
            --langr-new-hover-bg: rgba(57, 106, 165, 0.39);
            --langr-learning-hover-bg: rgba(138, 98, 27, 0.53);
            --langr-familiar-hover-bg: rgba(142, 122, 55, 0.32);`,
        light: `
            --langr-new-bg: rgba(82, 142, 199, 0.16);
            --langr-learning-color: #352800;
            --langr-learning-bg: rgba(232, 178, 52, 0.42);
            --langr-learning-border: 1px solid #9b731c;
            --langr-familiar-bg: rgba(218, 198, 97, 0.22);
            --langr-familiar-border: 1px dashed #8c792e;
            --langr-new-hover-bg: rgba(82, 142, 199, 0.23);
            --langr-learning-hover-bg: rgba(232, 178, 52, 0.50);
            --langr-familiar-hover-bg: rgba(218, 198, 97, 0.30);`,
    },
    night: {
        // Night follows the host mode: charcoal in dark mode, warm paper in light.
        dark: `
            --qiaomu-english-reading-surface: #202324;
            --langr-new-color: var(--text-normal);
            --langr-new-bg: rgba(70, 107, 124, 0.07);
            --langr-new-border: 1px dotted #8caabd;
            --langr-learning-color: #e1c393;
            --langr-learning-bg: rgba(148, 105, 44, 0.13);
            --langr-learning-border: 1px solid #c5a16d;
            --langr-familiar-color: var(--text-normal);
            --langr-familiar-bg: transparent;
            --langr-familiar-border: 1px dashed #86a99c;
            --langr-new-hover-bg: rgba(70, 107, 124, 0.15);
            --langr-learning-hover-bg: rgba(148, 105, 44, 0.21);
            --langr-familiar-hover-bg: rgba(76, 135, 111, 0.10);`,
        light: `
            --qiaomu-english-reading-surface: #f7f3eb;
            --langr-new-bg: rgba(91, 125, 141, 0.05);
            --langr-new-border: 1px dotted #527081;
            --langr-learning-color: #765126;
            --langr-learning-bg: rgba(194, 145, 74, 0.09);
            --langr-learning-border: 1px solid #81623e;
            --langr-familiar-border: 1px dashed #527f6e;
            --langr-new-hover-bg: rgba(91, 125, 141, 0.12);
            --langr-learning-hover-bg: rgba(194, 145, 74, 0.17);
            --langr-familiar-hover-bg: rgba(76, 135, 111, 0.08);`,
    },
};

export function readingThemeCss(theme: WordColorTheme): string {
    const palette = PALETTES[theme] || PALETTES.vivid;
    return `
        #qiaomu-english-reading {
            --qiaomu-english-reading-surface: transparent;
            --langr-known-color: var(--text-normal);
            --langr-known-bg: transparent;
            --langr-known-border: none;
            --langr-learned-color: var(--text-normal);
            --langr-learned-bg: transparent;
            --langr-learned-border: none;
            --langr-known-hover-bg: var(--background-modifier-hover);
            --langr-learned-hover-bg: var(--background-modifier-hover);
            ${palette.dark}
        }
        .theme-light #qiaomu-english-reading { ${palette.light} }
    `;
}
