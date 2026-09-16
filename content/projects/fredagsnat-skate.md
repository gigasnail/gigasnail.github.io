---
title: fredagsnat skate
date: 2026-09
order: 4
sub: 2026. a friday night on roller skates through neon copenhagen.
summary: A tiny canvas endless-runner — one HTML file, no assets. Skate through nighttime Copenhagen, hop cones and bike racks, collect leaves, with Remy & Lucy trotting behind. Helmet on, obviously.
---

<p><a href="fredagsnat-skate/"><b>▶ play it in the browser</b></a> — space / tap to jump, double-jump works, M toggles sound.</p>

The whole thing is a single HTML file: a 400×225 pixel canvas, a palette, and a fixed-step game loop. No sprites, no sound files — every house, canal reflection, lamp glow and dog is drawn with `fillRect`, and the beeps come from a throwaway WebAudio oscillator.

The dogs follow the skater by replaying a buffer of the player's recent heights, so they hop the same obstacles a half-second late. And if you skate long enough, a certain giant snail drifts across the sky.
