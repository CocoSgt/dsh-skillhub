# dsh-skillhub

[简体中文](README.zh-CN.md) | English

npm package: `dsh-skillhub` · GitHub repository:
[CocoSgt/dsh-skillhub](https://github.com/CocoSgt/dsh-skillhub)

Third-party skill hub for DeepSeek Harness (dsh): **aggregate skills scattered
everywhere into one global library.** Claude Code's `~/.claude/skills`, project
directories, `.skill` packages — everything lands in `~/.dsh/skills` (the
official skill-filesystem's default scan root, watched live), and once
imported appears in the "/" slash menu of the input box. Adds a "Skills" page
to the settings dialog.

## Two import identities

| | Link (recommended) | Copy |
| --- | --- | --- |
| Implementation | `skills/<name>` is a **symlink** to the source | full tree copy |
| Sync | **No sync problem**: one file on both sides, editing edits the source | evolves independently (state records the source for reference) |
| Source deleted | panel marks it "broken link", one-click removal (source untouched) | unaffected |
| Fits | long-lived sources you maintain | throwaway sources (.skill packages, repos you'll delete), or a global version you can change freely |

The harness's skill scanner, fs provider, and watcher all follow symlinks
natively (skill-filesystem's `nodeEntryKind` handles them explicitly), so
links need no patches and work across every loading form (including SDK/ACP,
where plugins cannot be installed).

## Aligned with how the harness actually works

- **There is no "install"**: a skill takes effect the moment it sits in a scan
  root. This page manages the global library (`~/.dsh/skills`, rank 400, all
  sessions); skills in project directories (`.dsh/skills`, `.agents/skills`,
  rank 100/200) are scanned by the harness directly and never pass through
  this page — that is exactly why they are "always invocable", and why project
  skills win on name collisions.
- **A skill is a file tree, not one MD**: the editor edits `SKILL.md` only and
  tells you how many resource files exist; manage resources via "Open
  directory". Export packages the whole tree as .skill (links are
  dereferenced: real files are packed).
- **Editing a link = editing the source**: the editor header says so; saving
  writes straight to the source file.

## Tabs

1. **Global skills**: the top action row has "＋ New skill" (inline expander,
   no scrolling) and "Upload .skill" (imports as soon as a file is picked, no
   intermediate confirmation); a filter box appears with many skills. Each
   card: identity badges (`Link → source` / `Copy` / `Created locally` /
   `Broken link`), resource count, non-default invocation policy; descriptions
   clamp to 3 lines by default (click to expand); primary action "Edit
   SKILL.md", with export / open directory / copy name in the ⋯ menu and an
   inline two-step delete confirmation (links only remove the link).
2. **Discover**: scan directories managed inline as chips at the top (each
   chip shows its skill count or "missing", ✕ removes immediately, ＋ adds in
   place — there is no separate "Sources" tab); each scanned item offers
   "Link" (primary) / "Copy", and "Link all" goes through a single batch RPC;
   a filter box appears with many results.

## Architecture

- **Host half** (`lib/index.mjs`): `SkillHubGateway` extends
  `TypertRemoteService` and exposes three RPCs: `skillHub/getState`,
  `skillHub/runCommand`, and `skillHub/browseDirs` (the last one powers the
   source picker's directory browser). The runCommand payload is a command
   union carried verbatim over src-json. The earlier 3180–3189 port-probing
   sidecar HTTP service is gone. Because SRC discovery is blind in the
   third-party dual-copy scenario, a weak manifest is also registered into
   the host typert registry.
- **Browser half** (`lib/client.js`): $mount identity-codec descriptors →
  `ctx.remote.skillHub`; the panel registers into the `settings.section` slot;
  "Open directory" goes through the official `host.openPath`.
- **i18n**: all visible copy renders through the official locale service.
  zh/en dictionaries live in `src/client/locales.ts`; the slot registration
  declares `locale: NS`, so the framework injects a reactive `t` seat into
  the component props. Host runCommand results carry a stable `code`
  (e.g. `import.linked`, `err.read.notFound`) plus optional `params` and an
  explicit `level: 'error'`; the client translates by code and falls back to
  the Chinese `message` field, and colors the status line by `level` instead
  of guessing from message text.

The state file `~/.dsh/skills/.skill-manager.json` records the source
configuration and each skill's `{mode, source, addedAt}` (schema reserved for
future drift detection). Its filename is deliberately kept from the old
skill-manager so existing installations keep their state.

## Install

Install from npm:

```sh
dsh plugin --profile web add dsh-skillhub
```

The three dsh plugins can be added together in one command:

```sh
dsh plugin --profile web add dsh-skillhub dsh-attachments dsh-context-inspector
```

GitHub fallback:

```sh
dsh plugin --profile web add github:CocoSgt/dsh-skillhub
```

Restart `dsh web` afterwards. Uninstall:
`dsh plugin --profile web remove dsh-skillhub`.

## Known limitations

- Drift detection/pull/push between copies and their sources is phase two;
  for now copies only record the source.
- Directory links use junctions on Windows; file-level links fall back to a
  copy without privilege, and say so honestly.
- A linked skill's in-library link name is fixed at import time; if the
  source's frontmatter name changes later, the skill name follows the source
  but the link name does not (harmless — only the directory name and the
  skill name diverge).
- "Link all" runs serially; failures are collected and summarized (first
  failure shown) without flooding the status line.
- Host-side messages for a few low-level failures (e.g. corrupt zip details)
  ride inside a `{message}` param and remain Chinese in the English UI.

## Development

```sh
pnpm install
pnpm run check   # tsc --noEmit
pnpm run build   # tsdown (host ESM + browser bundle)
```

Note: host method parameter names ARE the RPC wire field names (Gateway SRC
mode); the build must never minify or rewrite parameter names.

## License

MIT
