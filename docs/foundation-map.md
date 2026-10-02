---
title: "地基地图（生成物）"
category: 协作
status: 现行
scope: "六个类别（工具链 · 命令链 · 框架 · 功能 · 模块 · 引擎）的**逐项清单 + 归属 + 谁守它**；由 `tools/foundation-map.mjs` 生成，门 `foundation` 校验它不漂"
source: "`node tools/foundation-map.mjs --write` —— **不要手改本文件**，改了就会被门判红"
links: ["README.md", "../AGENTS.md"]
---
# 地基地图（生成物）

> ⚠ **这是生成的**，不是手写的：`node tools/foundation-map.mjs --write` 刷新，
> 门 `foundation` 校验"盘上副本 == 现算"。
>
> 🔴 **本文件里不许出现日期、时间、随机数** —— 那是"生成物"最容易自己把自己弄漂的地方
> （加一个时间戳，`--check` 第二天就红）。要新鲜度就用"内容对账"，不要用时间戳。
>
> 它**只保证"没有东西被漏掉"**（枚举 · 归属 · 谁守它），**不判断好坏** ——
> 判断与缺口账本在 [`foundation-audit.md`](foundation-audit.md)。
> 为什么地图要生成：本项目的协作者里有 AI，**它会丢上下文、遗漏、偷懒**；
> 对抗这件事的唯一可靠办法是"**从清单算**"，而不是"记住"。

## 一、命令链（`package.json` 的 scripts）—— 136 条

| 脚本 | 指向 | 类别 | 门 | 在 CI | 被文档提到 |
| --- | --- | --- | --- | --- | --- |
| `test:bonds` | `test/bonds.mjs` | 测试 |  |  | ⚠ |
| `test:storage-fs` | `test/storage-fs.mjs` | 测试 |  |  | ⚠ |
| `test:for` | `tools/test-for.mjs` | 测试 · **manual** |  |  | ⚠ |
| `test:station` | `test/station.mjs` | 测试 |  |  | ⚠ |
| `test:fold` | `test/fold.mjs` | 测试 |  |  | ⚠ |
| `dev` | `(内联命令)` | 工具 / 其他 |  |  | ✔ |
| `web` | `(内联命令)` | 工具 / 其他 |  |  | ✔ |
| `build` | `(内联命令)` | 工具 / 其他 |  | ✔ | ✔ |
| `preview` | `(内联命令)` | 工具 / 其他 |  |  | ✔ |
| `cli` | `src/cli.ts` | 工具 / 其他 |  |  | ✔ |
| `sim` | `src/cli.ts` | 工具 / 其他 |  |  | ✔ |
| `serve` | `src/cli.ts` | 工具 / 其他 |  |  | ✔ |
| `desktop` | `(内联命令)` | 工具 / 其他 |  |  | ✔ |
| `desktop:gpu` | `(内联命令)` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `desktop:nosandbox` | `(内联命令)` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `typecheck` | `(内联命令)` | 工具 / 其他 |  | ✔ | ✔ |
| `env:declared` | `tools/env-declared.mjs` | 门 | `env` | ✔ | ⚠ |
| `doc:links` | `tools/doc-links.mjs` | 门 | `doc-links` | ✔ | ⚠ |
| `workspace:audit` | `tools/workspace-audit.mjs` | 门 | `workspace` | ✔ | ⚠ |
| `where` | `tools/where.mjs` | 工具 / 其他 |  |  | ✔ |
| `verify` | `tools/verify.mjs` | 工具 / 其他 |  | ✔ | ✔ |
| `verify:quick` | `tools/verify.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `typecheck:report` | `tools/tsc-report.cjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `test` | `test/run-all.mjs` | 门 | `test` | ✔ | ✔ |
| `suites` | `tools/run-suites.cjs` | 工具 / 其他 |  |  | ✔ |
| `test:skill` | `test/skill.mjs` | 测试 |  |  | ⚠ |
| `test:migration` | `test/migration.mjs` | 测试 |  |  | ⚠ |
| `test:feel` | `test/feel.mjs` | 测试 |  |  | ⚠ |
| `test:modes` | `test/modes.mjs` | 测试 |  |  | ⚠ |
| `test:dungeon` | `test/dungeon.mjs` | 测试 |  |  | ⚠ |
| `test:story` | `test/story.mjs` | 测试 |  |  | ⚠ |
| `test:synergy` | `test/synergy.mjs` | 测试 |  |  | ⚠ |
| `test:affixes` | `test/affixes.mjs` | 测试 |  |  | ⚠ |
| `test:run-save` | `test/run-save.mjs` | 测试 |  |  | ⚠ |
| `test:art` | `test/art.mjs` | 测试 |  |  | ⚠ |
| `test:audio` | `test/audio.mjs` | 测试 |  |  | ⚠ |
| `art` | `tools/art-audit.mjs` | 门 | `art` | ✔ | ✔ |
| `color:audit` | `tools/color-audit.mjs` | 门 | `color` | ✔ | ⚠ |
| `banner:audit` | `tools/banner-audit.mjs` | 门 | `banner` | ✔ | ⚠ |
| `registration:audit` | `tools/registration-audit.mjs` | 门 | `registration` | ✔ | ⚠ |
| `foundation:map` | `tools/foundation-map.mjs` | 工具 / 其他 |  |  | ⚠ |
| `test:curves` | `test/curves.mjs` | 测试 |  |  | ⚠ |
| `test:persist` | `test/persist.mjs` | 测试 |  |  | ⚠ |
| `test:profile` | `test/profile.mjs` | 测试 |  |  | ⚠ |
| `test:danger` | `test/danger.mjs` | 测试 |  |  | ⚠ |
| `test:daily` | `test/daily.mjs` | 测试 |  |  | ⚠ |
| `test:extras` | `test/extras.mjs` | 测试 |  |  | ⚠ |
| `test:talents` | `test/talents.mjs` | 测试 |  |  | ⚠ |
| `test:camp` | `test/camp.mjs` | 测试 |  |  | ⚠ |
| `test:keep` | `test/keep.mjs` | 测试 |  |  | ⚠ |
| `test:sim` | `test/smoke.mjs` | 测试 |  |  | ⚠ |
| `test:registry` | `test/registry.mjs` | 测试 |  |  | ⚠ |
| `test:containers` | `test/containers.mjs` | 测试 |  |  | ⚠ |
| `test:debug` | `test/debug.mjs` | 测试 |  |  | ⚠ |
| `test:ai` | `test/ai.mjs` | 测试 |  |  | ⚠ |
| `audit` | `tools/arch-audit.cjs` | 门 | `audit` | ✔ | ✔ |
| `curves` | `tools/curve-audit.mjs` | 门 | `curves` | ✔ | ✔ |
| `loop` | `tools/loop-audit.mjs` | 门 | `loop` | ✔ | ✔ |
| `gen:curves` | `tools/gen-curve-tables.py` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `probe` | `tools/bug-probe.mjs` | 工具 / 其他 |  | ✔ | ✔ |
| `run` | `tools/bug-probe.mjs` | 工具 / 其他 |  | ✔ | ✔ |
| `fun` | `tools/fun-audit.mjs` | 工具 / 其他 |  | ✔ | ✔ |
| `bal` | `tools/balance.mjs` | 工具 / 其他 |  | ✔ | ✔ |
| `coverage` | `tools/coverage.mjs` | 工具 / 其他 |  | ✔ | ⚠ |
| `reconcile` | `tools/reconcile.mjs` | 门 | `reconcile` | ✔ | ✔ |
| `matrix` | `tools/matrix.mjs` | 工具 / 其他 |  | ✔ | ⚠ |
| `kit` | `tools/game-kit.mjs` | 工具 / 其他 |  |  | ✔ |
| `guards` | `tools/guard-gaps.mjs` | 门 | `guards` | ✔ | ✔ |
| `yaml` | `tools/yaml-check.mjs` | 门 | `yaml` | ✔ | ✔ |
| `drift` | `tools/registry-drift.mjs` | 门 | `drift` | ✔ | ✔ |
| `readme:stats` | `tools/readme-stats.cjs` | 门 | `readme` |  | ⚠ |
| `readme:check` | `tools/readme-stats.cjs` | 门 | `readme` | ✔ | ✔ |
| `solid` | `tools/solid-audit.cjs` | 门 | `solid` | ✔ | ✔ |
| `name:audit` | `tools/name-audit.mjs` | 门 | `name` | ✔ | ✔ |
| `eol:audit` | `tools/eol-audit.mjs` | 门 | `eol` | ✔ | ✔ |
| `env` | `tools/env.mjs` | 工具 / 其他 |  | ✔ | ✔ |
| `doc:num` | `tools/doc-num-audit.mjs` | 门 | `doc-num` | ✔ | ⚠ |
| `doc:front` | `tools/doc-front-matter.mjs` | 门 | `doc-front` | ✔ | ⚠ |
| `engine:boundary` | `tools/engine-boundary.mjs` | 门 | `engine-boundary` | ✔ | ⚠ |
| `hardcode` | `tools/hardcode-audit.cjs` | 门 | `hardcode` | ✔ | ✔ |
| `audio:census` | `tools/audio-census.mjs` | 门 | `audio` | ✔ | ⚠ |
| `text:census` | `tools/text-census.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `draw` | `tools/draw-census.mjs` | 工具 / 其他 |  |  | ✔ |
| `score` | `tools/score.mjs` | 工具 / 其他 |  |  | ✔ |
| `ui-text` | `tools/extract-ui-text.mjs` | 门 | `ui-text` | ✔ | ✔ |
| `fingerprint` | `tools/fingerprint.mjs` | 门 | `fingerprint` | ✔ | ✔ |
| `fp:repro` | `tools/fp-repro.mjs` | 门 | `repro` | ✔ | ✔ |
| `map` | `tools/map-audit.mjs` | 工具 / 其他 |  |  | ✔ |
| `shot` | `tools/ui-shot.mjs` | 工具 / 其他 |  | ✔ | ⚠ |
| `ui-preview` | `tools/ui-serve.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `flow` | `tools/flow-audit.mjs` | 门 | `flow` | ✔ | ✔ |
| `test:comp` | `test/comp.mjs` | 测试 |  |  | ⚠ |
| `test:world` | `test/world.mjs` | 测试 |  |  | ⚠ |
| `test:object` | `test/object.mjs` | 测试 |  |  | ⚠ |
| `test:character` | `test/character.mjs` | 测试 |  |  | ⚠ |
| `test:dialogue` | `test/dialogue.mjs` | 测试 |  |  | ⚠ |
| `test:trade` | `test/trade.mjs` | 测试 |  |  | ⚠ |
| `test:status` | `test/status.mjs` | 测试 |  |  | ⚠ |
| `test:name` | `test/name-gate.mjs` | 测试 |  |  | ⚠ |
| `test:rig` | `test/rig.mjs` | 测试 |  |  | ⚠ |
| `test:frames` | `test/frames.mjs` | 测试 |  |  | ⚠ |
| `test:states` | `test/states.mjs` | 测试 |  |  | ⚠ |
| `test:signals` | `test/signals.mjs` | 测试 |  |  | ⚠ |
| `test:particles` | `test/particles.mjs` | 测试 |  |  | ⚠ |
| `test:packs` | `test/packs.mjs` | 测试 |  |  | ⚠ |
| `test:i18n` | `test/i18n.mjs` | 测试 |  |  | ⚠ |
| `test:slots` | `test/slots.mjs` | 测试 |  |  | ⚠ |
| `test:tutorial` | `test/tutorial.mjs` | 测试 |  |  | ⚠ |
| `test:items` | `test/items.mjs` | 测试 |  |  | ⚠ |
| `test:economy` | `test/economy.mjs` | 测试 |  |  | ⚠ |
| `test:render` | `test/render-check.mjs` | 测试 |  |  | ⚠ |
| `test:depth` | `test/depth.mjs` | 测试 |  |  | ⚠ |
| `test:rhi` | `test/rhi.mjs` | 测试 |  |  | ⚠ |
| `dev:edit` | `tools/dev-edit.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `test:dev-edit` | `test/dev-edit.mjs` | 测试 |  |  | ✔ |
| `naming:audit` | `tools/naming.mjs` | 门 | `naming` | ✔ | ⚠ |
| `test:naming-gate` | `test/naming-gate.mjs` | 测试 |  |  | ⚠ |
| `rename:inventory` | `tools/rename-inventory.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `test:cache` | `test/cache.mjs` | 测试 |  |  | ⚠ |
| `test:ui` | `test/ui-check.mjs` | 测试 |  |  | ⚠ |
| `test:input` | `test/input.mjs` | 测试 |  |  | ⚠ |
| `test:perf` | `test/perf.mjs` | 测试 |  |  | ⚠ |
| `test:yaml` | `test/yaml.mjs` | 测试 |  |  | ⚠ |
| `test:contract` | `test/data-contract.mjs` | 测试 |  |  | ⚠ |
| `test:rooms` | `test/rooms.mjs` | 测试 |  |  | ⚠ |
| `test:boss` | `test/boss.mjs` | 测试 |  |  | ⚠ |
| `test:g5` | `test/g5.mjs` | 测试 |  |  | ⚠ |
| `test:hub` | `test/hub.mjs` | 测试 |  |  | ⚠ |
| `test:combine` | `test/combine.mjs` | 测试 |  |  | ⚠ |
| `test:craft` | `test/craft.mjs` | 测试 |  |  | ⚠ |
| `test:forge` | `test/forge.mjs` | 测试 |  |  | ⚠ |
| `test:arch` | `test/arch.mjs` | 测试 |  |  | ⚠ |
| `hooks:install` | `tools/install-hooks.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `hooks:status` | `tools/install-hooks.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `hooks:remove` | `tools/install-hooks.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |
| `art-manifest` | `tools/art-manifest.mjs` | 工具 / 其他 · **manual** |  |  | ⚠ |

> **可达性**（谁真的会跑到它）：门 30 · 套件（`pnpm test`）67 · CI 11 · 仅文档 13 · **谁都跑不到 11**
>
> ⚠ **谁都跑不到的命令**（11 条）：`test:for` · `desktop:gpu` · `desktop:nosandbox` · `typecheck:report` · `gen:curves` · `text:census` · `rename:inventory` · `hooks:install` · `hooks:status` · `hooks:remove` · `art-manifest`

## 二、工具链（`tools/`）—— 73 个文件

| 文件 | 角色 | 谁引用它 | `--self-test` |
| --- | --- | --- | --- |
| `_run.mjs` | 库（共用） | `tools/bug-probe.mjs` · `tools/curve-audit.mjs` · `tools/fun-audit.mjs` · `tools/matrix.mjs` · `tools/reconcile.mjs` · `tools/registry-drift.mjs` |  |
| `_tables.mjs` | 库（共用） | `tools/foundation-map.mjs` · `tools/registration-audit.mjs` |  |
| `arch-audit.cjs` | 门 | 门 `audit` · 脚本 `audit` · `tools/readme-stats.cjs` · `tools/systems.cjs` · `tools/verify.mjs` |  |
| `art-audit.mjs` | 门 | 门 `art` · 脚本 `art` · `tools/verify.mjs` |  |
| `art-manifest.mjs` | 普查 / 其他 | 脚本 `art-manifest` |  |
| `audio-census.mjs` | 门 | 门 `audio` · 脚本 `audio:census` · `tools/verify.mjs` |  |
| `balance.mjs` | 普查 / 其他 | 脚本 `bal` · `tools/curve-audit.mjs` · `tools/registry-drift.mjs` |  |
| `banner-audit.mjs` | 门 | 门 `banner` · 脚本 `banner:audit` · `tools/verify.mjs` | ✔ |
| `bug-probe.mjs` | 普查 / 其他 | 脚本 `probe` · 脚本 `run` · `tools/_run.mjs` · `tools/coverage.mjs` · `tools/fun-audit.mjs` |  |
| `color-audit.mjs` | 门 | 门 `color` · 脚本 `color:audit` · `tools/verify.mjs` |  |
| `coverage.mjs` | 普查 / 其他 | 脚本 `coverage` |  |
| `curve-audit.mjs` | 门 | 门 `curves` · 脚本 `curves` · `tools/registry-drift.mjs` · `tools/verify.mjs` |  |
| `dev-edit.mjs` | 开发工具 | 脚本 `dev:edit` · `tools/foundation-map.mjs` · `tools/rename-inventory.mjs` |  |
| `doc-front-matter.mjs` | 门 | 门 `doc-front` · 脚本 `doc:front` · `tools/verify.mjs` |  |
| `doc-links.mjs` | 门 | 门 `doc-links` · 脚本 `doc:links` · `tools/verify.mjs` |  |
| `doc-num-audit.mjs` | 门 | 门 `doc-num` · 脚本 `doc:num` · `tools/verify.mjs` |  |
| `draw-census.mjs` | 普查 / 其他 | 脚本 `draw` · `tools/registry-drift.mjs` |  |
| `engine-boundary.mjs` | 门 | 门 `engine-boundary` · 脚本 `engine:boundary` · `tools/_tables.mjs` · `tools/naming.mjs` · `tools/rename-inventory.mjs` · `tools/verify.mjs` |  |
| `env-declared.mjs` | 门 | 门 `env` · 脚本 `env:declared` · `tools/verify.mjs` | ✔ |
| `env.mjs` | 普查 / 其他 | 脚本 `env` · `tools/where.mjs` |  |
| `eol-audit.mjs` | 门 | 门 `eol` · 脚本 `eol:audit` · `tools/verify.mjs` |  |
| `extract-ui-text.mjs` | 门 | 门 `ui-text` · 脚本 `ui-text` · `tools/verify.mjs` |  |
| `fingerprint.mjs` | 门 | 门 `fingerprint` · 脚本 `fingerprint` · `tools/fp-repro.mjs` · `tools/verify.mjs` |  |
| `flow-audit.mjs` | 门 | 门 `flow` · 脚本 `flow` · `tools/verify.mjs` |  |
| `foundation-map.mjs` | 普查 / 其他 | 脚本 `foundation:map` · `tools/doc-num-audit.mjs` · `tools/registration-audit.mjs` | ✔ |
| `fp-repro.mjs` | 门 | 门 `repro` · 脚本 `fp:repro` · `tools/verify.mjs` |  |
| `fun-audit.mjs` | 普查 / 其他 | 脚本 `fun` · `tools/_run.mjs` · `tools/bug-probe.mjs` · `tools/curve-audit.mjs` · `tools/matrix.mjs` |  |
| `game-kit.mjs` | 普查 / 其他 | 脚本 `kit` |  |
| `gen-curve-tables.py` | 普查 / 其他 | 脚本 `gen:curves` |  |
| `guard-gaps.mjs` | 门 | 门 `guards` · 脚本 `guards` · `tools/verify.mjs` |  |
| `hardcode-audit.cjs` | 门 | 门 `hardcode` · 脚本 `hardcode` · `tools/color-audit.mjs` · `tools/verify.mjs` |  |
| `install-hooks.mjs` | 普查 / 其他 | 脚本 `hooks:install` · 脚本 `hooks:status` · 脚本 `hooks:remove` |  |
| `loop-audit.mjs` | 门 | 门 `loop` · 脚本 `loop` · `tools/verify.mjs` |  |
| `make-migration-fixture.mjs` | 普查 / 其他 · **keep** | `tools/foundation-map.mjs` |  |
| `map-audit.mjs` | 普查 / 其他 | 脚本 `map` |  |
| `matrix.mjs` | 普查 / 其他 | 脚本 `matrix` · `tools/_run.mjs` |  |
| `name-audit.mjs` | 门 | 门 `name` · 脚本 `name:audit` · `tools/color-audit.mjs` · `tools/systems.cjs` · `tools/verify.mjs` |  |
| `name-baseline.json` | 普查 / 其他 | `tools/name-audit.mjs` |  |
| `naming.mjs` | 门 | 门 `naming` · 脚本 `naming:audit` · `tools/verify.mjs` |  |
| `oneoff/apply-comp.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/batch-close.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/batch-num.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/canvas-numbers.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/decal-decide.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/decal-hoist.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/esm-ify.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/esm-tests.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/finalize-comp.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/fix-comp.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/fix-types.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/migrate-types.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/rename-doudou.cjs` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `oneoff/rewrite-items.py` | 子目录（见 `SUBDIRS_STATUS`） · **oneoff** | （无引用，已声明） |  |
| `readme-stats.cjs` | 门 | 门 `readme` · 脚本 `readme:stats` · 脚本 `readme:check` · `tools/verify.mjs` |  |
| `reconcile.mjs` | 门 | 门 `reconcile` · 脚本 `reconcile` · `tools/verify.mjs` |  |
| `registration-audit.mjs` | 门 | 门 `registration` · 脚本 `registration:audit` · `tools/verify.mjs` | ✔ |
| `registry-drift.mjs` | 门 | 门 `drift` · 脚本 `drift` · `tools/eol-audit.mjs` · `tools/verify.mjs` |  |
| `rename-bronana.cjs` | 声明表 | `tools/oneoff/rename-doudou.cjs` |  |
| `rename-inventory.mjs` | 普查 / 其他 | 脚本 `rename:inventory` |  |
| `run-suites.cjs` | 声明表 | 脚本 `suites` |  |
| `score.mjs` | 普查 / 其他 | 脚本 `score` · `tools/registry-drift.mjs` |  |
| `solid-audit.cjs` | 门 | 门 `solid` · 脚本 `solid` · `tools/verify.mjs` |  |
| `src-files.cjs` | 声明表 | `tools/arch-audit.cjs` · `tools/audio-census.mjs` · `tools/foundation-map.mjs` · `tools/game-kit.mjs` · `tools/guard-gaps.mjs` |  |
| `systems.cjs` | 声明表 | `tools/_tables.mjs` · `tools/arch-audit.cjs` · `tools/banner-audit.mjs` · `tools/engine-boundary.mjs` · `tools/foundation-map.mjs` · `tools/guard-gaps.mjs` · `tools/registration-audit.mjs` · `tools/src-files.cjs` · `tools/test-for.mjs` · `tools/verify.mjs` · `tools/workspace-audit.mjs` |  |
| `test-for.mjs` | 普查 / 其他 | 脚本 `test:for` |  |
| `text-census.mjs` | 普查 / 其他 | 脚本 `text:census` |  |
| `tsc-report.cjs` | 声明表 | 脚本 `typecheck:report` |  |
| `ui-serve.mjs` | 普查 / 其他 | 脚本 `ui-preview` · `tools/ui-shot.mjs` |  |
| `ui-shot.mjs` | 普查 / 其他 | 脚本 `shot` |  |
| `verify.mjs` | 普查 / 其他 | 脚本 `verify` · 脚本 `verify:quick` · `tools/doc-num-audit.mjs` · `tools/foundation-map.mjs` · `tools/install-hooks.mjs` · `tools/name-audit.mjs` · `tools/registry-drift.mjs` · CI |  |
| `where.mjs` | 普查 / 其他 | 脚本 `where` |  |
| `workspace-audit.mjs` | 门 | 门 `workspace` · 脚本 `workspace:audit` · `tools/_tables.mjs` · `tools/registration-audit.mjs` · `tools/verify.mjs` | ✔ |
| `yaml-check.mjs` | 门 | 门 `yaml` · 脚本 `yaml` · `tools/registry-drift.mjs` · `tools/verify.mjs` |  |

> ⚠ **没有任何引用的工具**（14 个）：`oneoff/apply-comp.cjs` · `oneoff/batch-close.cjs` · `oneoff/batch-num.cjs` · `oneoff/canvas-numbers.cjs` · `oneoff/decal-decide.cjs` · `oneoff/decal-hoist.cjs` · `oneoff/esm-ify.cjs` · `oneoff/esm-tests.cjs` · `oneoff/finalize-comp.cjs` · `oneoff/fix-comp.cjs` · `oneoff/fix-types.cjs` · `oneoff/migrate-types.cjs` · `oneoff/rename-doudou.cjs` · `oneoff/rewrite-items.py`

## 三、验收门与测试（框架的判据层）

### 门 —— 30 道（清单唯一出处：`tools/verify.mjs` 的 `GATES`）

| # | 门 | 脚本 | `--quick` 跳过 |
| --- | --- | --- | --- |
| 1 | `typecheck` | `node_modules/typescript/bin/tsc` |  |
| 2 | `test` | `test/run-all.mjs` | ✔（慢） |
| 3 | `fingerprint` | `tools/fingerprint.mjs` |  |
| 4 | `audit` | `tools/arch-audit.cjs` |  |
| 5 | `guards` | `tools/guard-gaps.mjs` |  |
| 6 | `drift` | `tools/registry-drift.mjs` |  |
| 7 | `yaml` | `tools/yaml-check.mjs` |  |
| 8 | `art` | `tools/art-audit.mjs` |  |
| 9 | `audio` | `tools/audio-census.mjs` |  |
| 10 | `reconcile` | `tools/reconcile.mjs` |  |
| 11 | `ui-text` | `tools/extract-ui-text.mjs` |  |
| 12 | `curves` | `tools/curve-audit.mjs` |  |
| 13 | `loop` | `tools/loop-audit.mjs` |  |
| 14 | `flow` | `tools/flow-audit.mjs` |  |
| 15 | `readme` | `tools/readme-stats.cjs` |  |
| 16 | `hardcode` | `tools/hardcode-audit.cjs` |  |
| 17 | `solid` | `tools/solid-audit.cjs` |  |
| 18 | `name` | `tools/name-audit.mjs` |  |
| 19 | `eol` | `tools/eol-audit.mjs` |  |
| 20 | `doc-num` | `tools/doc-num-audit.mjs` |  |
| 21 | `engine-boundary` | `tools/engine-boundary.mjs` |  |
| 22 | `doc-front` | `tools/doc-front-matter.mjs` |  |
| 23 | `naming` | `tools/naming.mjs` |  |
| 24 | `workspace` | `tools/workspace-audit.mjs` |  |
| 25 | `doc-links` | `tools/doc-links.mjs` |  |
| 26 | `env` | `tools/env-declared.mjs` |  |
| 27 | `color` | `tools/color-audit.mjs` |  |
| 28 | `repro` | `tools/fp-repro.mjs` |  |
| 29 | `banner` | `tools/banner-audit.mjs` |  |
| 30 | `registration` | `tools/registration-audit.mjs` |  |

### 测试 —— 67 套（清单唯一出处：`test/suites.mjs`）

`模拟层 / 战斗循环` · `技能 / 技能树 / 技能构筑 / 战斗模式` · `存档迁移 / 用旧版本的档启动` · `打击感 / 命中定帧（唯一会改模拟时序的手感项）` · `扩展点总账 / 跨表引用` · `数值折叠 / 一张表四种折法 · 四张声明表跨表对账` · `数据契约 / 字段→家族 · 值域 · 未读字段` · `货币与循环 / 战斗·经营·养成三个游戏模式` · `大厅（站）/ 三道门 · 开门顺序 · 可达性` · `数值曲线 / 角色与怪物的成长表` · `容器与对象管理 / 回收与上限` · `调试工具 / 存档迁移 · 录制回放 · 诊断面板` · `怪物行为 / 弹幕模式注册表` · `组件系统 / 组合与校验` · `世界系统 / 坐标·区域·网格` · `对象系统 / 身份·普查·容器` · `开局流程 / 存档角色·外观（时装）·入门三选` · `对话引擎 / 打字机·分支·历史·战斗短句` · `NPC 交易 / 报价·关系门槛·§6.5 硬约束` · `状态系统 / 可叠层·定身·读数收口` · `用词门 / 权威名·弃用词·同名两物（自检）` · `骨架系统 / 骨头·部件·几何等价` · `碰撞体 / 帧模型 / 插值` · `三种运行形态 / web·cli·desktop` · `地牢地图 / 随机楼层与隐藏要素` · `房间接进对局 / 门·房型内容·暗门墙·翻层·存档` · `随机 Boss 池 / 四种应对方式` · `深度层 / 限时房·层间契约·隐藏要素` · `剧情 / 枢纽对话·碎片·结局` · `剧情接入 / 档案⇄剧情表⇄枢纽` · `武器联动 / 家族与四条轴` · `词条 / 前缀后缀·档位·折叠·存档` · `一局存档的编解码 / 数值卫生·字段顺序·校验·往返 + 升级池` · `美术资源体系 / 规范·瓦片·自动规则·着色器·归属` · `背景音乐与错误兜底 / 曲目表·场景映射·崩溃卡` · `武器合成 / 品级台阶与买武器的落位规则` · `制造 / 配方·费用·档位门槛·产线` · `全局状态 / 设置 / 存档` · `账号档案 / 挑战 / 局外成长` · `难度阶梯 / 通关条件 / 每角色进度` · `每日挑战 / 成绩码可复算` · `离线产出 / 每周挑战（附加内容）` · `角色天赋树 / 只改开局条件` · `局内营地 / 模拟经营第一级` · `跨局据点 / 两条循环互供` · `图纸工坊 / 合金·合成链的局外出口` · `状态机 / 转换表与守卫` · `信号总线 / 异常隔离与重入` · `粒子发生器 / 对象池` · `随机道具包 / 定价与概率` · `本地化（文案表 / 切换 / 缺键）` · `存档槽位（备份回退 / 导出导入）` · `文件存储后端 / 原子写 · 备份回退 · 写失败不破坏` · `NPC 关系（养成线产出 / 双轨 / 每波限次）` · `首局引导（时机 / 只说一次 / 落盘）` · `道具的取舍 / 有得有失·代价轴·接入` · `渲染层 / 美术宪法 / 绘制预算` · `Z 深度 / 层带与 y 排序` · `RHI 渲染硬件接口 / 透明性与面完整性` · `开发工具 / 结构化文本编辑（挡住 shell 的 6 类）` · `命名边界门 / 三种注入都会红` · `缓存 / 烘焙倍率 / 条目收敛` · `界面层 / DOM 流程` · `架构 / 系统分层与依赖方向` · `输入层 / 键鼠·手柄·触摸` · `性能基准 / 帧预算` · `YAML 校验器 / GitHub 配置`

## 四、功能（`Registry` 家族 —— 扩展点的总账）—— 149 个

`actor` · `affix` · `affixFamily` · `affixMod` · `affixSlot` · `affixTag` · `aiBehaviour` · `aiPattern` · `animClip` · `archetype` · `artAnchor` · `artAtlas` · `artBlend` · `artKind` · `artStage` · `banner` · `bannerTier` · `bannerVariant` · `bark` · `barkWhen` · `bondStage` · `boon` · `boonGroup` · `boonMod` · `boss` · `bulletKind` · `campCombo` · `campEffect` · `campFacility` · `campLevelCount` · `challenge` · `challengeGroup` · `challengeMetric` · `char` · `charSpecial` · `charTag` · `character` · `codexLevel` · `component` · `container` · `coreLink` · `craftRecipe` · `currency` · `currencyRole` · `curve` · `curveDomain` · `curveShape` · `dailyField` · `dangerLevel` · `dangerMod` · `depthBand` · `depthDomain` · `element` · `elementEffect` · `enemy` · `enemyEye` · `enemyLegs` · `enemyMouth` · `enemyShape` · `exchange` · `floorTheme` · `foldOp` · `forgeMod` · `forgeNode` · `guideRule` · `hallRoom` · `hallSpot` · `hubStation` · `item` · `itemCost` · `itemCostAxis` · `itemIcon` · `itemSet` · `itemSpecial` · `keepFacility` · `keepMod` · `keyGroup` · `ledger` · `ledgerSystem` · `locale` · `lookAccessory` · `lookFace` · `lookPalette` · `manageSubMode` · `messageKey` · `modeScreen` · `module` · `musicTrack` · `objectKind` · `offlineRate` · `openingChoice` · `openingColumn` · `overlay` · `parallaxLayer` · `particleKind` · `pickupKind` · `profileSection` · `rhiSurface` · `roomMod` · `roomType` · `saveSlot` · `scene` · `scoreField` · `screenAct` · `seasonField` · `setting` · `shader` · `shaderOp` · `skill` · `skillForm` · `skillPayload` · `skillRune` · `skillTreeCard` · `soundEffect` · `state` · `stationSite` · `status` · `statusKind` · `storyChoice` · `storyEnding` · `storyFlag` · `storyLine` · `storyNpc` · `storySource` · `synergyAxis` · `talent` · `talentEcon` · `talentSector` · `talentType` · `term` · `termAlias` · `termRetired` · `terrain` · `textSurface` · `themeProp` · `tier` · `tileShape` · `tradeOffer` · `trainingDrill` · `tutorialHint` · `upgradeCard` · `viewportScale` · `weapon` · `weaponFamily` · `weaponKind` · `weaponType` · `workspace` · `worldGrid` · `worldZone`

> 家族数是**运行时算出来的**（真加载模拟层后读 `Registry.names()`），不是抄的。

## 五、模块与分层（`src/`）—— 101 个模块 · 9 层

| 层 | 系统 | 模块数 | 模块 |
| --- | --- | --- | --- |
| undefined | 工具与机制 | 28 | `utils.ts` `registry.ts` `selfcheck.ts` `viewport.ts` `rhi.ts` `workspace.ts` `text.ts` `fold.ts` `containers.ts` `envelope.ts` `comp.ts` `collide.ts` `rig.ts` `draw2d.ts` `depth.ts` `ai.ts` `world.ts` `object.ts` `appearance.ts` `openings.ts` `character.ts` `dialogue.ts` `status.ts` `curves.ts` `stats.ts` `banner.ts` `banner_data.ts` `module.ts` |
| undefined | 数据表 | 19 | `data_tiers.ts` `data_elems.ts` `ledger.ts` `eco_combat.ts` `eco_manage.ts` `eco_grow.ts` `eco_global.ts` `link.ts` `economy.ts` `terms.ts` `station.ts` `art_spec.ts` `affixes.ts` `data_weapons.ts` `data_items.ts` `data_chars.ts` `enemies.ts` `levelup.ts` `run_save.ts` |
| undefined | 地牢与内容 | 5 | `dungeon.ts` `art_tiles.ts` `arena.ts` `story.ts` `hall.ts` |
| undefined | 局外成长（元进度） | 23 | `camp.ts` `stronghold.ts` `forge.ts` `craft.ts` `talents.ts` `training.ts` `bonds.ts` `exchange.ts` `guide.ts` `boons.ts` `synergy.ts` `challenges.ts` `profile.ts` `daily.ts` `season.ts` `danger.ts` `offline.ts` `settings.ts` `storage.ts` `trade.ts` `slots.ts` `i18n.ts` `tutorial.ts` |
| undefined | 模拟内核 | 9 | `game.ts` `market.ts` `emit.ts` `scene.ts` `record.ts` `grid.ts` `chamber.ts` `impact.ts` `skills.ts` |
| undefined | 一局的进出 | 2 | `save.ts` `score.ts` |
| undefined | 造型与声音 | 6 | `bronana.ts` `art_parallax.ts` `art_shaders.ts` `sprites.ts` `audio.ts` `music.ts` |
| undefined | 表现与界面 | 5 | `render.ts` `ui.ts` `input.ts` `diag.ts` `crash.ts` |
| undefined | 入口 | 4 | `main.ts` `cli.ts` `demo.ts` `storage_fs.ts` |

**引擎 / 内容分类**（门 `engine-boundary`）：引擎 27 · 混合 4 · 显式内容 39 · 数据表 31 · **未认领 0**

**测试加载集**：`MODULES` 99 个键 · SIM 97 · RENDER 98 · UI 99 · 清单键（persist/arch）51 个

## 六、文档体系 —— 46 份 `.md`

| 文件 | 分类 | 状态 | 行数 | 在主索引 |
| --- | --- | --- | --- | --- |
| `AGENTS.md` | 协作 | 现行 | 577 | —（分卷） |
| `CHANGELOG.md` | 变更史 | 现行 | 2256 | —（分卷） |
| `CODE_OF_CONDUCT.md` | 协作 | 现行 | 71 | —（分卷） |
| `CONTRIBUTING.md` | 协作 | 现行 | 225 | —（分卷） |
| `README.md` | 门面 | 现行 | 1886 | —（分卷） |
| `SECURITY.md` | 安全 | 现行 | 103 | —（分卷） |
| `design/README.md` | 决定 | 现行 | 165 | —（分卷） |
| `docs/README.md` | 门面 | 现行 | 49 | ✔ |
| `docs/editor-roadmap.md` | 决定 | 现行 | 77 | ✔ |
| `docs/engine-first.md` | 决定 | 现行 | 213 | ✔ |
| `docs/external-benchmarks.md` | 外部参考 | 现行 | 446 | ✔ |
| `docs/external-game-mechanics.md` | 外部参考 | 现行 | 3111 | ✔ |
| `docs/external-workspace-conventions.md` | 调研 | 现行 | 152 | ✔ |
| `docs/foundation-audit.md` | 协作 | 现行 | 171 | ✔ |
| `docs/history/01-长线化与三角.md` | 交付记录 | 现行 | 842 | —（分卷） |
| `docs/history/02-地牢化与设计复查.md` | 交付记录 | 现行 | 1186 | —（分卷） |
| `docs/history/03-体系化与数值曲线.md` | 交付记录 | 现行 | 756 | —（分卷） |
| `docs/history/04-三模块循环与美术体系.md` | 交付记录 | 现行 | 809 | —（分卷） |
| `docs/history/05-验收与全量测试.md` | 交付记录 | 现行 | 918 | —（分卷） |
| `docs/history/06-阶段收尾.md` | 交付记录 | 现行 | 103 | —（分卷） |
| `docs/history/07-需求清单批次执行.md` | 交付记录 | 现行 | 460 | —（分卷） |
| `docs/history/08-美术审查与绘图逻辑修复.md` | 交付记录 | 现行 | 161 | —（分卷） |
| `docs/history/09-Teapot口径修正与E3入口.md` | 交付记录 | 现行 | 136 | —（分卷） |
| `docs/history/10-E3第一步-去掉引擎里的内容名.md` | 交付记录 | 现行 | 107 | —（分卷） |
| `docs/history/11-E3第二步-存储命名空间由宿主注入.md` | 交付记录 | 现行 | 97 | —（分卷） |
| `docs/history/12-文档与环境的收口.md` | 交付记录 | 现行 | 100 | —（分卷） |
| `docs/history/13-E3第三步-引擎身份字符串.md` | 交付记录 | 现行 | 78 | —（分卷） |
| `docs/history/14-批次1-工作区清单落地.md` | 交付记录 | 现行 | 92 | —（分卷） |
| `docs/history/15-批次2-内容模块显式认领.md` | 交付记录 | 现行 | 67 | —（分卷） |
| `docs/history/16-批次2后半-draw2d那一刀.md` | 交付记录 | 现行 | 64 | —（分卷） |
| `docs/history/17-工具层三个洞的结构性消除.md` | 交付记录 | 现行 | 145 | —（分卷） |
| `docs/history/18-地基体检.md` | 交付记录 | 现行 | 91 | —（分卷） |
| `docs/history/19-引擎启动横幅与编辑器前置.md` | 交付记录 | 现行 | 104 | —（分卷） |
| `docs/history/20-引擎的模块.md` | 交付记录 | 现行 | 85 | —（分卷） |
| `docs/history/21-无感知-宿主身份从清单来.md` | 交付记录 | 现行 | 50 | —（分卷） |
| `docs/history/README.md` | 交付记录 | 现行 | 52 | —（分卷） |
| `docs/requirements.md` | 需求账本 | 现行 | 4352 | ✔ |
| `docs/scaling-benchmarks.md` | 外部参考 | 现行 | 246 | ✔ |
| `docs/scaling-isaac-gungeon.md` | 外部参考 | 现行 | 61 | ✔ |
| `docs/scaling-ror2-vs-sts.md` | 外部参考 | 现行 | 154 | ✔ |
| `docs/skill-audit.md` | 自检 | 现行 | 271 | ✔ |
| `docs/teapot-restructure.md` | 决定 | 现行 | 314 | ✔ |
| `docs/techstack-upgrade-decision.md` | 决定 | 现行 | 354 | ✔ |
| `docs/techstack-upgrade-research.md` | 调研 | 已取代 | 1761 | ✔ |
| `docs/workspace-migration.md` | 决定 | 现行 | 105 | ✔ |
| `docs/workspace-spec.md` | 决定 | 现行 | 158 | ✔ |

## 七、工作区清单 —— 1 份

| 目录 | `id` | `engine` |
| --- | --- | --- |
| `workspace/Bronana/` | `bronana` | `>=2.0.0 <3` |

## 八、CI 步骤 —— 35 步

| 工作流 | 步骤 | 跑什么 |
| --- | --- | --- |
| `ci.yml` | 取代码 | `` |
| `ci.yml` | 装 pnpm（版本从 packageManager 字段读） | `` |
| `ci.yml` | 装 Node | `` |
| `ci.yml` | 装依赖（锁定版本，`--frozen-lockfile` 防止 CI 偷偷改锁文件） | `pnpm install --frozen-lockfile` |
| `ci.yml` | 构建（dist/ —— 生产形态测试需要） | `pnpm run build` |
| `ci.yml` | 门 1 · typecheck（tsc ×2） | `pnpm run typecheck` |
| `ci.yml` | 门 2 · 全部无头测试套件 | `pnpm test` |
| `ci.yml` | 门 3 · 行为指纹 | `pnpm run fingerprint` |
| `ci.yml` | 门 4a · 分层 / 环 / 死代码 / 未读字段 | `pnpm run audit` |
| `ci.yml` | 门 4b · 家族与模块守卫 | `pnpm run guards` |
| `ci.yml` | 门 4c · 登记漂移（每个工具/每套测试有没有入口） | `pnpm run drift` |
| `ci.yml` | 门 4d · YAML 校验（CI 与 issue 模板本身） | `pnpm run yaml` |
| `ci.yml` | 门 5a · 美术规范与资源归属 | `pnpm run art` |
| `ci.yml` | 门 5b · 音效调用普查（该响的时候有没有人按按钮） | `pnpm run audio:census` |
| `ci.yml` | 门 5c · 声明表 ↔ 运行时读点对账 | `pnpm run reconcile` |
| `ci.yml` | 门 5d · i18n 表（只报"表中孤儿"，未翻译量不是失败） | `pnpm run ui-text -- --check` |
| `ci.yml` | 附加 · 数值曲线体检 | `pnpm run curves` |
| `ci.yml` | 附加 · 三模块循环体检 | `pnpm run loop` |
| `ci.yml` | 附加 · 局内进度字段一致性 | `pnpm run flow` |
| `ci.yml` | 附加 · README 存量表与实测一致 | `pnpm run readme:check` |
| `ci.yml` | 附加 · 硬编码体检 | `pnpm run hardcode -- --strict` |
| `ci.yml` | 附加 · SOLID 体检 | `pnpm run solid -- --strict` |
| `ci.yml` | 附加 · 工作区清单（每份清单都要被引擎认下来） | `pnpm run workspace:audit` |
| `ci.yml` | 附加 · 文档链接与索引（链得到 · 找得到） | `pnpm run doc:links` |
| `ci.yml` | 附加 · 环境变量声明（每个被读的键都在 .env.example 里） | `pnpm run env:declared` |
| `ci.yml` | 附加 · 用词规范 | `pnpm run name:audit` |
| `ci.yml` | 附加 · 行尾（LF） | `pnpm run eol:audit` |
| `ci.yml` | 附加 · 文档数字对账 | `pnpm run doc:num` |
| `ci.yml` | 附加 · 引擎 / 内容边界 | `pnpm run engine:boundary` |
| `ci.yml` | 附加 · 文档 front matter | `pnpm run doc:front` |
| `ci.yml` | 附加 · 颜色宪法 | `pnpm run color:audit` |
| `ci.yml` | 附加 · 命名边界（引擎前缀 vs 内容前缀） | `pnpm run naming:audit` |
| `ci.yml` | 附加 · 跨进程可复现性 | `pnpm run fp:repro` |
| `ci.yml` | 附加 · 登记一致性（元门） | `pnpm run registration:audit` |
| `ci.yml` | 附加 · 引擎启动横幅（两个载体逐字节对账） | `pnpm run banner:audit` |

