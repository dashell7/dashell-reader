import { fetchDirtyDOM } from '../helpers';
import {
    HTMLString,
    handleNoResult,
    getText,
    handleNetWorkError,
    SearchFunction,
    GetSrcPageFunction,
    DictSearchResult,
    getStaticSpeaker,
} from '../helpers';

const HOST = 'https://cn.bing.com';

/** Escape HTML special chars to prevent XSS when interpolating into v-html */
function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const getSrcPage: GetSrcPageFunction = (text) => {
    return `${HOST}/dict/search?q=${encodeURIComponent(text)}&mkt=zh-cn`;
};

export type BingResultItem = {
    id: string;
    html: HTMLString;
};

export type BingResult = BingResultItem[];

type BingSearchResult = DictSearchResult<BingResult>;

export const search: SearchFunction<BingResult> = async (text) => {
    return fetchDirtyDOM(getSrcPage(text))
        .catch(handleNetWorkError)
        .then(doc => handleDOM(doc))
        .catch(handleNoResult);
};

function handleDOM(doc: DocumentFragment): BingSearchResult | Promise<BingSearchResult> {
    const result: BingResult = [];
    const audio: { us?: string; uk?: string } = {};

    const $qdef = doc.querySelector('.qdef');
    if (!$qdef) return handleNoResult();

    // ── Build header section (word + phonetics + audio) ──
    const $hdArea = $qdef.querySelector('.hd_area');
    let headerHtml = '';

    if ($hdArea) {
        const headword = getText($hdArea, 'h1 strong') || getText($hdArea, 'h1');

        // Extract pronunciations
        const $prUS = $hdArea.querySelector('.hd_prUS');
        const $prEN = $hdArea.querySelector('.hd_pr');
        const usText = $prUS?.textContent?.trim() || '';
        const enText = $prEN?.textContent?.trim() || '';

        // Extract audio URLs
        const $audUS = $hdArea.querySelector('#bigaud_us');
        const $audUK = $hdArea.querySelector('#bigaud_uk');
        const usMp3 = $audUS?.getAttribute('data-mp3link');
        const ukMp3 = $audUK?.getAttribute('data-mp3link');

        if (usMp3) audio.us = usMp3.startsWith('http') ? usMp3 : HOST + usMp3;
        if (ukMp3) audio.uk = ukMp3.startsWith('http') ? ukMp3 : HOST + ukMp3;

        headerHtml = `<div class="bing-header">`;
        headerHtml += `<div class="bing-headword">${esc(headword)}</div>`;
        headerHtml += `<div class="bing-phonetics">`;
        if (usText) {
            headerHtml += `<span class="bing-pron">`;
            if (audio.us) {
                headerHtml += `<a class="speaker" href="${esc(audio.us)}" target="_blank">🔊</a> `;
            }
            headerHtml += `${esc(usText)}</span>`;
        }
        if (enText) {
            headerHtml += `<span class="bing-pron">`;
            if (audio.uk) {
                headerHtml += `<a class="speaker" href="${esc(audio.uk)}" target="_blank">🔊</a> `;
            }
            headerHtml += `${esc(enText)}</span>`;
        }
        headerHtml += `</div></div>`;
    }

    // ── Build definitions section ──
    let defsHtml = '';
    const $defs = $qdef.querySelectorAll('ul > li');
    if ($defs.length > 0) {
        defsHtml = '<div class="bing-defs">';
        $defs.forEach($li => {
            const pos = getText($li, '.pos');
            const def = getText($li, '.def');
            if (pos || def) {
                defsHtml += `<div class="bing-def-item">`;
                if (pos) defsHtml += `<span class="bing-pos">${esc(pos)}</span>`;
                if (def) defsHtml += `<span class="bing-def">${esc(def)}</span>`;
                defsHtml += `</div>`;
            }
        });
        defsHtml += '</div>';
    }

    if (!headerHtml && !defsHtml) return handleNoResult();

    result.push({
        id: 'bing-main',
        html: headerHtml + defsHtml,
    });

    // ── Build collocation/synonym/antonym section ──
    const $thesaurus = doc.querySelector('#thesaurusesid');
    if ($thesaurus) {
        let thHtml = '<div class="bing-thesaurus">';

        const sections = [
            { id: '#colid', title: '搭配' },
            { id: '#synoid', title: '同义词' },
            { id: '#antoid', title: '反义词' },
        ];

        sections.forEach(sec => {
            const $sec = $thesaurus.querySelector(sec.id);
            if (!$sec) return;
            const items: string[] = [];
            $sec.querySelectorAll('.df_div2').forEach($div => {
                const title = getText($div, '.de_title1, .de_title2');
                const words: string[] = [];
                $div.querySelectorAll('.p1-4').forEach($w => {
                    words.push($w.textContent?.trim() || '');
                });
                if (title || words.length) {
                    items.push(`<span class="bing-th-pos">${esc(title)}</span> ${words.map(w => esc(w)).join(', ')}`);
                }
            });
            if (items.length > 0) {
                thHtml += `<div class="bing-th-section">`;
                thHtml += `<div class="bing-th-title">${sec.title}</div>`;
                items.forEach(item => {
                    thHtml += `<div class="bing-th-item">${item}</div>`;
                });
                thHtml += `</div>`;
            }
        });

        thHtml += '</div>';
        if (thHtml.includes('bing-th-section')) {
            result.push({ id: 'bing-thesaurus', html: thHtml });
        }
    }

    // ── Build sentence examples section ──
    const $senSeg = doc.querySelector('#sentenceSeg');
    if ($senSeg) {
        let senHtml = '<div class="bing-sentences"><div class="bing-sen-title">例句</div>';
        const $sens = $senSeg.querySelectorAll('.se_li');
        let count = 0;

        $sens.forEach($sen => {
            if (count >= 5) return; // Limit to 5 examples

            const num = getText($sen, '.se_n_d');
            // Get the English sentence text
            const $enDiv = $sen.querySelector('.sen_en');
            const enText = $enDiv?.textContent?.trim() || '';
            // Get the Chinese translation
            const $cnDiv = $sen.querySelector('.sen_cn');
            const cnText = $cnDiv?.textContent?.trim() || '';

            if (enText) {
                senHtml += `<div class="bing-sen-item">`;
                senHtml += `<span class="bing-sen-num">${esc(num)}</span>`;
                senHtml += `<div class="bing-sen-content">`;
                senHtml += `<div class="bing-sen-en">${esc(enText)}</div>`;
                if (cnText) senHtml += `<div class="bing-sen-cn">${esc(cnText)}</div>`;
                senHtml += `</div></div>`;
                count++;
            }
        });

        senHtml += '</div>';
        if (count > 0) {
            result.push({ id: 'bing-sentences', html: senHtml });
        }
    }

    if (result.length > 0) {
        return { result, audio };
    }

    return handleNoResult();
}
