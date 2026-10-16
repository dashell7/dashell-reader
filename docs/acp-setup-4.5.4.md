# Codex first-run connection recovery (4.5.4)

Selecting a local AI service now checks local executables without sending a prompt. When Codex ACP is missing, the main setup surface shows the exact install command, Copy command, Check after installing, and installation documentation. Paths remain folded. If Codex CLI itself is missing, installation and login commands appear first; a subsequent missing adapter advances to the adapter command.

Check after installing verifies the actual ACP session and a minimal response before enabling AI. Failed retries remain actionable. Changing service or model prevents stale detection and verification results from enabling a different configuration. Runtime installation stays disabled.

Validation: 347 automated tests, i18n checks across nine UI languages, zero-warning source lint, standard and community builds. Desktop host validation in qiaomu-home-dashboard-qa reproduced missing Codex ACP and showed the command and three recovery buttons with advanced settings closed, without tooltip attributes or runtime errors. Provider settings were isolated in memory; no personal settings were changed. Missing-adapter and retry transitions are covered by controlled tests; no new adapter was installed for acceptance. Mobile runtime was not tested; CLI is desktop-only.
