# how to post 🐌

Everything on the site is written as markdown in this folder and built
into plain HTML by `tools/build.py` (python3, zero dependencies).

## the whole workflow

1. Write a file: `content/<section>/<name>.md` (sections: `writing`, `art`, `projects`, `music`)
2. Publish:

       ./tools/publish.sh

   That builds the HTML, regenerates the section index, commits and pushes.
   Live at https://gigasnail.github.io/ about a minute later.

## the file format

    ---
    title: my post title
    date: 2026-08
    summary: One sentence shown on the section index page.
    sub: optional subtitle shown under the big heading (defaults to the date)
    ---

    Plain paragraphs. **bold**, *italic*, `code`, [links](https://...).

    ## a section heading

    - lists work
    - like this

    ![a picture](img/photo.jpg)

- The filename becomes the URL: `content/writing/slow-web.md` → `/writing/slow-web.html`.
  A `2026-08-23-` filename prefix is stripped from the URL and used as the date if
  `date:` is missing.
- Newest date sorts first on the index. Same date? Add `order: 1` (1 = highest).
- Images go in `<section>/img/`, audio in `music/audio/`. Embed audio with a raw
  HTML line: `<audio controls src="audio/track.mp3"></audio>` — any line starting
  with `<` passes through as-is.
- `<div class="wip">something is coming</div>` renders the dashed "in progress" box.
- Delete the `.md` and republish to take a page down (its HTML and index entry go too).

## house rules

- REAL, finished work only — no stubs, no "coming soon" entries.
- Never include real names, hostnames, IPs, tokens, ports or channel IDs.
- Public identity is **Gigasnail** only; commits come from the repo-local
  git identity (`gigasnail@users.noreply.github.com`) — don't override it.
