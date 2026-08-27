# The Alotion Golf Club

A single-page landing site for a private golf estate in Batesville, Arkansas —
old money meets the Ozarks.

## The idea

The page is a slow dolly down an 18th-hole fairway. A procedural three.js scene
(rolling fairway with mow stripes, the White River, cypress and oak groves, a
stone clubhouse with warm windows, a fluttering oxblood flag, a golf ball,
wheeling birds, drifting clouds and a low sun) is pinned behind the page and
moves with your scroll: the camera walks the course from the first tee to the
clubhouse as you read, the ball rolls ahead of you, and the sun settles in as
you arrive. HTML sections parallax over the scene with scroll reveals,
counters, an interactive signature-holes board, and a membership suite.

## Running it

It's a static site — serve the repo root:

```sh
python3 -m http.server 8080
# → http://localhost:8080
```

No build step. `three` and all fonts are vendored locally
(`vendor/`, `fonts/`) so the page works offline.

## Structure

```
index.html          page
css/style.css       design system + layout + motion
js/main.js          UI motion + the three.js scene (import map → vendor/)
vendor/             three.module.js (r160, vendored)
fonts/              Marcellus, Cormorant Garamond, EB Garamond (woff2)
assets/images/      editorial photography (AI-generated)
```

## Notes

- Honors `prefers-reduced-motion` (static render, no parallax, no flutters).
- If WebGL is unavailable the canvas silently drops out and the page degrades
  to the static editorial layout.
- Copy, membership figures and the 1897 heritage are fictional placeholders.
