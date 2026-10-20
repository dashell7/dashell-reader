# Qiaomu Reader 4.7.8 selective integration

Checked on 2026-10-20. Upstream formal release: [4.7.8](https://github.com/joeseesun/qiaomu-reader/releases/tag/4.7.8), tag commit `f50acfa216bb95770980f3ff9dc54cb365dc9fa7`. Previous integrated upstream release: 4.7.7, `f17157e4a103e63c62e4fa2596609fb273b6f1f4`.

## Changes

- Normalize tar archive member paths with POSIX `/` separators before matching the model manifest. Windows `Path` stringification otherwise turns nested paths into `\\` paths that never match the manifest.
- Add nested-file extraction and verified-cache recovery tests for partial installations. Run the local TTS Python tests in the existing Windows/Ubuntu CI matrix with Python 3.12.
- Retain manifest, size, SHA-256, path traversal and link checks. No settings, model metadata or user-data migration is needed.
- Keep Dashell Reader's package and manifest version at `4.4.6`; this is a source integration, not a release.

## Verification

- Windows local runtime tests: 6 passed, including nested archive extraction and recovery from a partial install using the verified cache without network access.
- Node tests: 592 passed; i18n checks, source ESLint, standard/community builds, release asset verification and bundle syntax checks passed.
- Installed the rebuilt `main.js` in the designated Windows QA vault and reloaded Dashell Reader in Obsidian 1.14.4. The plugin re-registered 34 commands, the host captured no errors, and `data.json` remained byte-identical. The previous plugin directory is backed up locally.
- No real model download or audio synthesis was run; the path behavior is covered by local Windows archive fixtures.
