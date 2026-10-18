# Qiaomu Reader 4.7.7 selective integration

Checked on 2026-10-18. Upstream formal release: [4.7.7](https://github.com/joeseesun/qiaomu-reader/releases/tag/4.7.7), commit `f17157e4a103e63c62e4fa2596609fb273b6f1f4`. Previous integrated upstream release: 4.7.5, `ae919610aa6abf34267ebaae44128d3f7e489bf5`. Dashell base: `4567a4be3250b270c310ac8108a5e7c60c83e6c6`.

## Changes

- Adopt the official `deepseek-flash` default and explicitly send `high` reasoning when DeepSeek thinking is enabled. Explicit effort choices continue to work. Connection tests and disabled thinking omit reasoning effort.
- Migrate saved official-endpoint `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` aliases. Deduplicate the saved catalog and prefer an existing current model entry. Preserve third-party endpoints, custom models, Pro selections, credentials and other providers.
- Run migration after reading backups are restored, alongside the existing note-folder and speech migration save path. A failed save leaves persisted data intact, and a later load retries migration.
- Retain Dashell dictionary, vocabulary, review, Markdown rendering, RSS progress and Qiaomu speech components. No dependencies or formal version numbers change; this is an unreleased source integration.

Upstream changed its release metadata and generated assets too. Dashell rebuilds its own bundle and retains version `4.4.6` until an explicitly requested Release.

References: [DeepSeek updates](https://api-docs.deepseek.com/updates/) and [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/).

## Verification

- 592 Node tests pass, including the six upstream DeepSeek regression tests and Dashell load-order, failed-save retry and learning-data preservation coverage.
- Four local speech Python tests pass; eight-language checks and source ESLint pass with zero warnings.
- Standard and community builds, asset verification and bundle syntax checks pass. Existing Sass legacy API deprecation remains.
- Installed the candidate into the designated Windows Obsidian QA vault after backing up assets and plugin data; verified all three installed asset hashes.
- Actual host load/reload checks migrate the official aliases in memory and on disk, deduplicate the catalog, preserve third-party model choices, retain speech/secret references/other models and reading backups, and restore temporary settings byte for byte. The final run has no captured console errors, window errors or unhandled rejections. Twenty vocabulary records and all 64 existing Markdown files retain their prior content/count.
- The first rapid-reload fixture unloaded the learning database before initialization completed and logged closed-database errors. The fixture now awaits database readiness after each load; it passes without changing production lifecycle code.
- No real DeepSeek API request was sent. Mac, mobile hardware and real external account/service behavior were not tested in this update. Plugin reload is not a cold application restart.

RSS was checked independently: formal upstream release remains 0.29.2 (`0133ff24e9bca914de1d3f47e63e94220baf029a`), and the Dashell default branch remains `4176022a5e60152df6c504da45ef3adea8e17ec9`. No RSS code changes are needed in this run.
