# Qiaomu Reader 4.9.2 selective adaptation

Assessed on 2026-10-27, from formal upstream 4.9.1
(`3b49727c4835dde7c5b714331575c928dcc777fa`) to formal 4.9.2
(`fc620a4521c8b34ce390fcf1388a190f91ebb182`). The actual Dashell default
`main` base is `b23ac389aa3aa0664af25a90025a8970b50907aa`. Package, manifest
and latest public release remain **4.4.7**; this is not a release.

## Change

The Codex CLI login-status probe recognizes status lines beginning with
`API key configured` or `Logged in`, case-insensitively, after the existing
ANSI cleanup. Standard output and standard error remain separate lines.
ChatGPT and the legacy API-key status format continue to work. `Not logged in`,
`API key not configured`, inline diagnostic mentions, unknown/empty output and
nonzero process exits cannot count as authenticated.

This adapts upstream commit `6059e8e` within the existing desktop runtime and
process boundary. It does not change credential storage, CLI invocation,
timeouts, cancellation, ACP installation, model verification, other CLI
providers or Dashell learning features. A positive login-status result does
not prove a successful paid model request.

## Verification

- The new regression failed on the original implementation and passed after
  the production fix. Twelve controlled child-process cases cover stdout,
  stderr, mixed case/ANSI, ChatGPT, legacy API key, stream separation, explicit
  unauthenticated states, inline diagnostics, unknown/empty output and failed
  exits. Windows launches the test fixture through Node because shebang files
  are not executable binaries there; streams, exit status and the production
  probe remain real. Linux executes the fixture directly.
- All **628 Node tests** and **six Python local-TTS tests** passed. Source
  ESLint has zero warnings; language checks, learning TypeScript, standard and
  community builds, asset verification and `git diff --check` passed.
- Fresh attachment to **F:/qiaomu-reader-english**, registered vault ID
  `f3d4f84f4640589d`, Windows Obsidian title **1.15.0** (UA still reports the
  older installer 1.12.4). Final candidate installed and reloaded successfully.
  Actual settings navigation, AI configuration modal and login-status button
  exercised all twelve cases through real controlled Node child processes.
  Each click ran one status command and recovered its busy state, with the
  expected success/failure notice. No actual credential, model request or
  payment was used.
- The first host fixture searched the main document while Obsidian rendered
  settings in another document window. Selecting the settings element's owning
  document corrected the fixture; production UI code was not changed for it.
  Every temporary process hook and setting was restored in `finally`.
- Original three Markdown files are byte-identical. RSS's 14 plugin files and
  Reader's 15 files excluding the three candidate assets are byte-identical to
  fresh backups, including settings, progress, learning and caches. Layout is
  restored; no QA notes or plugin files were created. Reader retains this
  candidate with manifest 4.4.7; the original RSS VideoCaptioner candidate and
  its dirty source worktree are unchanged. Final `dev:errors` reports no
  captured errors in the current session.
- Evidence and backups are outside the vault in
  `C:/Users/zhangbo/AppData/Local/Temp/dashell-upstream-20261027`. Committed
  source rebuild and final CI results are recorded in the automation baseline.

RSS upstream remains formal **0.32.7**
(`6c313c50bf29f4bf4a4e5eb58b79d96ee4a3b4b7`), and its actual default
`codex/dashell-rss-upstream-sync` remains
`27b32f3b088feb8f37f682ad0b30526c167a5919`, with public manifest/release 2.7.3.
RSS was not rebuilt, installed or modified in this run.

No dependency versions or lockfile changed. The previously documented Reader
audit findings were not remediated or re-audited here; no clean-audit claim is
made. There is no new macOS, physical mobile, cold startup, synchronization,
real API-key/account or speech acceptance. The upstream macOS evidence is not
reported as a Dashell host test.
