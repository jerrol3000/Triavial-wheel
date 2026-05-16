# AI asset prompt template

Locked-in prompts so any future asset (categories, badges, store items,
celebration effects) matches the existing illustrated style in
`public/icons/`. Tested against the assets already shipped — paste
verbatim, just change the SUBJECT line.

Works best in **[Bing Image Creator](https://www.bing.com/create)**
(DALL-E 3, free, no signup needed). Same prompts also work in Leonardo
(pick the "RPG v5" or "DreamShaper" model) and Krea.

---

## Master prompt (UI / icon assets)

```
A single illustrated app icon of {{SUBJECT}}, isolated on transparent
background (or solid white background if transparency unsupported).
Bold semi-flat 2.5D vector style with thick outlines, vibrant saturated
colors, soft inner shadows for depth. Color palette weighted toward
deep purple (#7c3aed), hot pink (#ec4899), warm amber (#f59e0b), and
cyan accents (#22d3ee) against dark background. Crisp readable shapes
at 64×64 px, mobile game UI feel, no text, no logos, no signature.
Centered composition with generous padding around the subject. Style
similar to modern casual mobile game icons — clean, friendly, premium.
```

**Just swap `{{SUBJECT}}` with the thing you want.** Examples that
matched the existing set well:

- `a golden trophy with purple gem inset`
- `a stack of glowing pink coins`
- `a magical question-mark crystal floating in space`
- `a friendly cartoon owl wearing a graduation cap`
- `a treasure chest overflowing with gold and gems`
- `a cosmic galaxy swirl frame`
- `a fiery red comet streaking diagonally`

---

## Category-icon prompt (for new wheel categories)

```
Illustrated game category icon representing {{CATEGORY_NAME}}.
{{CATEGORY_DESCRIPTION}}. Same visual language as a "movie clapperboard"
icon for Film, "music notes with treble clef" for Music — single
iconic object, bold outline, vibrant colors, soft drop shadow,
transparent background, 256×256 px, mobile trivia game style. Color
palette MUST favor {{CATEGORY_COLOR}} as the dominant accent. Centered
composition, no text overlay.
```

Existing wheel categories + their dominant colors (for `{{CATEGORY_COLOR}}`):

| Category | Color |
|---|---|
| General | `#7c3aed` purple |
| Film | `#ec4899` pink |
| TV | `#06b6d4` cyan |
| Science | `#10b981` green |
| Sports | `#ef4444` red |
| Geography | `#3b82f6` blue |
| Music | `#f59e0b` amber |
| Computers | `#64748b` slate |
| Mythology | `#14b8a6` teal |
| Animals | `#f97316` orange |

---

## Badge prompt (for new tier-coloured badges)

```
A circular game achievement badge for "{{BADGE_NAME}}", featuring
{{BADGE_SYMBOL}}. {{TIER}} tier styling:
  - bronze: warm metallic copper, simple chiselled edge
  - silver: cool polished chrome, double rim
  - gold: bright shiny gold, ornate edge, slight glow
  - legendary: rainbow-iridescent gold-pink-purple gradient, radiant
    rays behind, particles, intense glow
Centered illustration, transparent background, 256×256 px,
mobile-game-trophy aesthetic, no text on the badge itself.
```

---

## Celebration-effect prompt (for new win animations)

```
A bursting {{EFFECT_NAME}} celebration animation frame, viewed
straight-on against transparent background. Vibrant {{COLOR_THEME}}
palette, particles radiating outward from center, motion blur trails,
sense of explosive joy. Pixar-quality 3D render, soft volumetric
lighting, 512×512 px. Single frame suitable for stop-motion sequence.
```

Effect themes to match the in-game set:

- `fireworks` → red/yellow/orange
- `coins` → gold/amber
- `hearts` → pink/red/white
- `stars` → silver/blue/white
- `rainbow` → full spectrum
- `phoenix` → orange/red/gold with feather wisps

---

## Avatar / mascot prompt

```
A cute friendly character avatar of {{DESCRIPTION}}, in casual mobile
game art style. Round soft shapes, big expressive eyes, single solid
warm background color (one of: purple, pink, amber, teal, blue, green).
Bust shot from the shoulders up. Same visual language as memoji or
Notion avatars. Transparent background outside the colored circle.
512×512 px.
```

---

## Things to AVOID in your prompts

- `photorealistic` — clashes with the existing illustrated style
- `text on image` — DALL-E often produces gibberish text; let CSS
  handle labels instead
- `dark background` in the subject prompt — keep backgrounds light or
  transparent; the app's dark UI handles the contrast
- `complex scene` — single subject icons read better at small sizes
- Generic "high quality, 8k, hdr" jargon — DALL-E 3 ignores these and
  it bloats your prompt

---

## Workflow

1. Generate 4 variations per prompt (Bing returns 4 per request)
2. Pick the one that matches color palette + composition best
3. If background isn't transparent, use [remove.bg](https://remove.bg)
   (free, 1-click) or **Photopea** (free Photoshop clone in browser)
4. Drop into `public/icons/` with a descriptive name
5. Add an entry to `src/data/icons.js`
