# Design app mockup — reference

Values here come from a mockup the user approved. Use them as the default, and change a value only when the idea needs it.

## Canvas

**With an Artifact tool (Claude Code):** run `quickstart` with intent `design` and create the canvas from the Design type it names. Follow that type's own instructions for boards, pages, and the canvas file.

- One page per area: Directions, one per journey, Landing, Style and icons.
- One row per journey, with a short note under each screen.
- Publish each board right after you write it.
- Before you publish the canvas file again, read the published copy and edit that, so boards the user moved stay where they are.
- Upload photos and icons as assets, and use each one by the URL the upload returns.

**Without an Artifact tool (Codex and others):** write the boards into a folder the user names, one HTML file per board. Add a `canvas.html` that shows every board in rows by page, each in an iframe at its real size with its title above it. Open it in the browser. Use no build step and no framework, and load fonts from Google Fonts.

**Sizes:** phone boards are 390x844. The landing page is one fluid file, shown at 1440 and at 390.

## Signature and job map

Give each part of the metaphor one job and keep it on every screen. The pantry app's map:

| Part | Job | Rule |
|---|---|---|
| Dark display | Status: counts, time, progress | Never holds buttons |
| Interior lamp | Warm when open, accent blue while the AI works | Blue means nothing else |
| Glass shelves, crisper | The ingredients, each on its own shelf | A blue ring and a `?` mark a guess |
| Door bin | Staples such as oil and salt | Never assumed; the user ticks them |
| Handle | The one main action | One per screen |

Take the metaphor from the idea's own object: a fridge, a ticket, a passport, a receipt, a car dashboard. When none fits, make one component the signature, such as a dark mono readout bar, and use it the same way everywhere.

## Slop list

Never use:

- purple or blue gradients, glow orbs, neon borders, mesh blobs, or glass blur on everything;
- emojis as icons, generic icon packs, or sparkle "AI" icons;
- lorem ipsum, "Revolutionize your…", "Unlock the power of…", "seamless", or "effortless";
- three identical feature cards, each an icon, a title, and two lines;
- "As seen in" logos, stock-face testimonials, invented stats such as "10k+ users", or star ratings;
- everything centered, every card the same size, or a shadow on everything;
- more than one accent color, more than two font families, or weights above 600.

## Tokens

- **Identity line:** two short sentences that name the light and the precision. Pantry: "Warm kitchen light. Appliance precision."
- **The content is the color:** photos and icons bring the color, and the chrome stays neutral.
- **Colors**, each with one role:

| Token | Pantry value | Role |
|---|---|---|
| ground | `#F4F4F1` | App background, warm off-white |
| surface | `#FFFFFF` | Cards, sheets |
| line, line-2 | `#E5E5E0`, `#D4D4CE` | Borders, dividers |
| ink | `#111110` | Text and the one action |
| ink-2 | `#5C5C57` | Secondary text |
| accent | `#2456D3` on `#EAF0FD` | One meaning only (pantry: guessing or working) |
| green | `#1F7A4A` on `#E5F2EA` | Ready, done |
| amber | `#94570A` on `#FBEFD9` | Needs one thing |
| red | `#B3261E` | Destructive only |
| glass | `#0E0F11` | Displays and the one dark card |

- **Type:** Inter with optical sizing for everything. A mono (Geist Mono) only for readouts, counts, and small caps labels. Weights 400, 500, and 600 only.
  - Headlines: letter-spacing −0.03 to −0.05em, line-height 0.98–1.1, `text-wrap: balance`.
  - Phone scale: display 64, H1 32, H2 22, title 16, body 15, small 13, readout 19–22 mono.
  - Landing scale: hero 84, section 56, lead 18; on phone, hero 46 and section 36.
- **Radius:** 12, 20, 28, and pill. A nested radius is the outer radius minus the padding: a 22 card with 5 padding holds a photo with radius 17.
- **Spacing:** 8 pt grid, 16 phone gutter, section gaps of 112 on desktop and 80 on phone.
- **Touch:** 44 minimum. The primary button is 56 tall.
- **Depth:** 1px borders by default. Use one soft long shadow, such as `0 16px 30px -14px rgba(17,17,16,.3)`, only for things that float.

## Components

- **Primary action:** a black pill 56 tall. The label sits left, and a 44 white circle with an arrow sits right. One per screen.
- **Secondary:** a white round 44 button with a 1px border. Use a ghost pill only on photos and dark bands.
- **Eyebrow:** a white pill with a 6px dot, above a heading.
- **Readout display:** a dark glass bar with 2–3 mono cells (10px caps label, 19px value) and an LED dot for live status.
- **Chip:** a white pill with a 28px icon in a light circle. A guess gets the accent ring and a `?` badge.
- **Tab bar:** a floating white pill 24 from the bottom. The active tab is a black pill.
- **Photo card:** a white card with 5px padding around the photo.
- **Tag:** 24 tall, on a soft semantic background.

## Icons

- Use one grid (such as a 48 viewBox), one stroke or fill style, 2–3 tones per item from a shared palette, and light from the same side.
- Cover the 20–30 most common things in the idea's world.
- Put them on one sheet board with names. Render the sheet and redraw any icon that looks heavier, smaller, or in another style.

## Photos

- **Sources, in order:** Wikimedia Commons filtered to CC0 or public domain, then Openverse, then the Unsplash or Pexels license (no credit needed). Record each file's source URL and license.
- **Pick** shots with one subject, a calm background, and natural light, at the same angle within a group (top-down for food).
- **Grade** after cropping, all with one look: a small warm or cool shift (pantry: red ×1.035, green ×1.0, blue ×0.94), a lift for dark shots, contrast ×1.05, saturation ×1.06. Compare before and after as one contact sheet.
- **Match:** when a photo and its text disagree, rename the dish or item.
- **Hero photo:** wide and calm, with room for text, and a dark gradient scrim under white text.
- **For the real app:** match each item to a licensed photo library first. Generate an image only when nothing matches.

## Screens

Every app gets these states, not only the happy path:

- welcome that shows the result, not a feature list;
- empty state with the one next action;
- capture or input, with guidance;
- review, where the app shows what it is unsure of and the user can confirm, swap, or remove it;
- loading with real progress and a skeleton of the result;
- the result, with what is ready and what is missing shown up front;
- detail with steps;
- paywall with a free path, the usage count, restore, and terms;
- saved or history, with filters and an empty filter state;
- account: subscription, preferences, privacy, help, log out.

Rules:

- one primary action per screen;
- copy says what happens next ("Find 3 meals", not "Submit");
- numbers carry units;
- uncertainty is shown, never hidden;
- safety settings, such as allergies, are checked and named on the result.

## Landing

Section order, taken from App Land on Framer:

1. Nav: logo, 3–4 section links, one CTA.
2. Hero: a big rounded card with a full photo and a scrim, an eyebrow pill, a 2-line headline, a 1-line subhead, the launch CTA (the App Store badge for an app), a ghost "See how it works", and a "Free to try" line.
3. A phone showing the real result screen, overlapping the bottom of the hero, with 2 floating UI cards beside it.
4. The things the app knows, as icons with names, in place of press logos.
5. How it works: 3 gray cards labeled "01 / Snap", each holding a real piece of the UI.
6. A split: copy with 3 checks next to a photo card with floating UI cards.
7. Features as a 3+3 bento grid with one dark card.
8. Facts: true product facts only (what the app does in numbers), one dark card.
9. Pricing: a free card and a dark paid card, a billing toggle, and placeholder prices.
10. FAQ: a two-column accordion with real questions: account, wrong results, safety, what paid adds.
11. A dark CTA band with a photo and the launch CTA.
12. Footer with the legal line.

Build it fluid: one file, `auto-fit` grids, and one breakpoint near 760px.

## Consistency pass

Check across all boards:

- every item, meal, and person name is spelled the same everywhere;
- numbers agree: display counts match the lists, and prices and limits match;
- each photo shows what its text says;
- nothing is both "on hand" and "to buy", and a setting shown on one screen holds on the others;
- every link goes where its label says, and every control does something;
- no lorem ipsum, emoji, or invented data is left.
