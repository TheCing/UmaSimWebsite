# Uma Sim (fork by Cing)

Website Link: https://thecing.github.io/UmaSimWebsite/

> This is Cing's fork of **[Sevoii/UmaSimWebsite](https://github.com/Sevoii/UmaSimWebsite)**. The simulator, the Room Match Simulator and the Skill Optimizer are Sevoii's work; this fork adds importing umas from other Uma tools (see [What this fork adds](#what-this-fork-adds)). The original site is at https://sevoii.github.io/UmaSimWebsite/.

This is a collection of various tools Sevoii made using a WASM port of [Global Sim](https://github.com/Sevoii/GlobalSim).

## Room Match Simulator

This is the main tool of the website. It allows you to import Umamusume and Teams to compare their relative strengths across a variety of opponents. 

Why use this over Hakuraku/uma.moe race sims?
- everything runs locally, so you can choose how many simulations you want to run. I suggest 1,000 - 10,000 simulations to get relatively stable confidence intervals
- randomly selects teams from the CM population that are actual team comps, so you can measure your performance across the field instead of against 2 specific teams

## Skill Optimizer

This is an experimental tool which relies on a genetic algorithm to find the best build possible. It's currently in a WIP state.

## What this fork adds

**Import from file** (Saved Umas, and the optimizer's uma editor) reads umas saved by other tools, not just this site's own JSON:

| Source | File |
|---|---|
| [UmaExtractor](https://github.com/xancia/UmaExtractor), [Trackside](https://github.com/TheCing/Trackside) | `data.json` / `veterans.json` (the game's veteran records) |
| [umadump](https://github.com/Werseter/umadump) | `trained_chara_data.json`, career `veteran.json` |
| [horseACT](https://github.com/ayaliz/horseACT) / Trackside | race dumps and `veterans.json`; Trackside CM dumps |
| [UmaLauncher](https://github.com/KevinVG207/UmaLauncher) | training logs, race logs, account exports |
| [Trackside Dashboard](https://github.com/TheCing/Trackside-Dashboard) | Team Trials history (`team_trials_history.jsonl`) |
| [Moomoolator](https://umalator.app/umalator-global) | exported uma JSON |

Imported umas keep every aptitude, so their distance and surface aptitudes follow the race you run. Race files (UmaLauncher and horseACT race logs) also import as teams. When a source leaves something out (UmaLauncher account exports have no skill list; Team Trials history has no aptitudes), the picker says what was estimated.

## Credits

[Sevoii](https://github.com/Sevoii) for the original site, the Room Match Simulator, the Skill Optimizer and the WASM port of GlobalSim

Hakuraku for vague styling inspos and a lot of data

Uma Tools / Umalator for editor design and data and icons

GlobalSim for making the actual simulator

The tools above whose files the importer reads: UmaExtractor, umadump, horseACT, UmaLauncher, Trackside and Moomoolator
