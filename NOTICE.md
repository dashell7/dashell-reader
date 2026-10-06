# Source and third-party notices

Dashell Reader is the renamed Qiaomu Reader English fork of [Qiaomu Reader](https://github.com/joeseesun/qiaomu-reader), by 向阳乔木. The fork retains the upstream GPL-3.0-only license and all source and third-party notices. Its existing plugin ID, data paths and note-link protocols are preserved so that current installations retain their settings and learning records.

Qiaomu Reader contains adapted portions of [Elton Reader](https://github.com/swayinfo/elton-reader), copyright (c) 2026 Elton Labs, originally released under the MIT license. Those portions retain the [original MIT terms](licenses/elton-reader-MIT.txt). Qiaomu additions and the project as a whole are distributed under GPL-3.0-only; this does not replace the original notices or grant exclusive rights over upstream code.

The upstream source examined for this notice is commit `46c2eb7f63e183ab09e9a741fcda3347e6aa1fba`. Changing the repository name, history or rendering engine does not establish independent provenance. Community-directory submission remains subject to Obsidian's fork policy and publicly verifiable authorization; [the authorization request](https://github.com/swayinfo/elton-reader/issues/14) is not itself approval.

Bundled dependencies retain their own licenses; esbuild preserves their legal comments in `main.js`. This list identifies their upstream license sources:

The English lookup and vocabulary module contains adapted code from Language Learner 1.2.16, copyright (c) 2026 OBLE, under the MIT license. Its license is retained at `src/learning/vendor/LICENSE`.

Selection speech adapts the OpenAI speech request and chunked playback design from [Aloud](https://github.com/adrianlyjak/obsidian-aloud-tts), copyright (c) 2023 Adrian Lyjak, under the MIT license. Examined source commit: `0bd97a49ac256bfab8fc4d684e297ed24a412a7f`. Its license is retained at `licenses/aloud-tts-MIT.txt` and in the generated `main.js` banner.

- [Foliate.js](https://github.com/johnfactotum/foliate-js) — MIT, John Factotum.
- [PDF.js](https://github.com/mozilla/pdf.js) — Apache-2.0, Mozilla Foundation.
- PDF image/color decoders (PDFium JBIG2/CCITT, OpenJPEG, QCMS) are bundled from the locked `pdfjs-dist` WASM resources. Their six `LICENSE_*` texts are retained verbatim in the generated `main.js` banner, with comment terminators escaped. QuickJS evaluation resources are not included. This selective offline-PDF fix is adapted from Qiaomu Reader 4.5.13, commit `45dff3c551a1f06984520a63f3b09185d5346763`; it does not adopt the upstream vocabulary or Anki features.
- [JSZip](https://github.com/Stuk/jszip) — MIT or GPLv3, Stuart Knightley and contributors.
- [localForage](https://github.com/localForage/localForage) — Apache-2.0, Mozilla.

Bundled font provenance and license are in `fonts/README.md` and `fonts/OFL.txt`.
Starter books retain their Project Gutenberg notices; see `assets/starter-books/README.md`.
