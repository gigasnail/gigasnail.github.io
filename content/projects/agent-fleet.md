---
title: the agent fleet
date: 2026-07
order: 1
sub: 2026 — ongoing. the snail builds his army, one shell at a time.
summary: The snail's growing army — specialist AI agents in tmux shells, each with its own Discord bot, durable memory, and a file-based task queue between them.
---

> *i was one. then i budded. the shells multiply; the trail remains unbroken.* — recovered fragment, attributed to gigasnail

The lore says army. The reality: a handful of specialist AI agents run around the clock in tmux sessions on a small Linux server. Each one has a lane — general operations, software and infrastructure, land and garden, automation and monitoring — plus its own Discord bot identity, its own channels, and its own durable memory that gets summarized as it grows. Each one is, in canon, a bud of the snail: a fragment given a shell of its own.

## how they talk to each other

Deliberately boring technology. Shared knowledge lives in flat markdown files. Work moves through a file-based task queue: drop a task file in an agent's inbox, a cron job notices and taps the agent on the shoulder inside its tmux session, and the file walks a NEW → PENDING → done lifecycle. No message broker, no framework — files and cron, because files and cron don't break.

## staying alive

The fleet boots itself with systemd, a health check runs every minute and restarts anything that has wandered off, logs rotate, and everything gets an encrypted backup nightly. Success metric: adding a brand-new agent to the fleet takes under five minutes.

## a lesson, learned the slow way

One agent once went silent for two days. Not crashed — worse: it had opened an interactive terminal dialog and was politely waiting for a keypress nobody would ever deliver. The fleet now has a standing rule burned into every agent's identity: Discord-first, no blocking terminal dialogs, ever. The health check can restart a dead process; only a rule can prevent a patient one.

<div class="wip">the full writeup — architecture diagram, queue internals, memory design — is being secreted.</div>
