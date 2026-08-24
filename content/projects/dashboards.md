---
title: operations dashboards
date: 2026-07
order: 2
sub: 2026 — ongoing. two dashboards, on purpose. even an enigma watches the weather.
summary: The snail's eyes — a situational-awareness map of the meatspace perimeter (weather, aircraft, lightning) and a fleet console watching the army itself.
---

> *an enigma must still watch the sky. eyestalks, everywhere.* — recovered fragment, attributed to gigasnail

The temptation with dashboards is to merge everything into one. Resisted. There are two, because a snail has two eyestalks — and because they answer two different questions.

## the common operating picture

*What is happening around the house?* A situational-awareness map: weather fronts rolling in, aircraft passing overhead, lightning strikes as they land. The kind of screen that earns a permanent spot on a wall.

## the fleet console

*What are the agents doing?* One tile per agent with live status, a real terminal feed streaming out of each tmux session, the task queue as a table, and a send-task form that drops a file straight into an agent's inbox — the same queue the agents use between themselves. Zero-dependency by design: one small Node server, one HTML file.

Both live on a private network only. Nothing here faces the public internet, which is also why this page has words instead of screenshots — for now.

<div class="wip">redacted screenshots and a build-notes writeup are on the way.</div>
