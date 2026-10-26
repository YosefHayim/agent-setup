# Design app mockup — reference

Two kinds of rules live here. The craft rules hold on every run. The pantry example at the end shows the depth one finished mockup reached. Read it for the level of detail, and never reuse its colors, fonts, components, or layout. Every mockup gets its own look.

## Canvas

**With an Artifact tool (Claude Code):** run `quickstart` with intent `design` and create the canvas from the Design type it names. Follow that type's own instructions for boards, pages, and the canvas file.

- One page per area: Directions, one per journey, Landing, Style and icons.
- One row per journey, with a short note under each screen.
- Publish each board right after you write it.
- Before you publish the canvas file again, read the published copy and edit that, so boards the user moved stay where they are.
- Upload photos and icons as assets, and use each one by the URL the upload returns.

**Without an Artifact tool (Codex and others):** write the boards into a folder the user names, one HTML file per board. Add a `canvas.html` that shows every board in rows by page, each in an iframe at its real size with its title above it. Open it in the browser. Use no build step and no framework, and load fonts from Google Fonts.

**Sizes:** phone boards are 390x844. The landing page is one fluid file, shown at 1440 and at 390.

## Past mockups

Before any direction, look at the last 3 mockups this skill made, so the new one does not repeat them.

- **With an Artifact tool:** run `list` and take the 3 newest Design canvases that have a Directions page. Save each one's `project/canvas.json` and its style sheet board (or the picked direction's home board when there is no style sheet) to the scratchpad. Grep them for the Google Fonts link and the hex colors. Do not read whole boards.
- **Without one:** use the canvas folders the user names, or ask once for them.
- From each, note the fonts, the ground, ink, and accent colors, the primary button shape, the navigation, and what the home screen is built around.
- Write these in a "Not again" note on the Directions page.

## Directions

Each direction is a different answer to how the app works, not a new skin on the same screens. Place each one on these axes, and show the table on the Directions page:

| Axis | Choices (examples, not a full list) |
|---|---|
| Navigation | tab bar, one screen that changes state, feed, card stack, step by step, map or space, search or command bar, sidebar |
| Home is built around | list, grid, timeline or calendar, one big readout, a chat, a map, a document, one object to touch |
| Main input | camera, typing, voice, swipe, drag, tap a grid, pick from cards |
| Look | type (grotesk, serif, mono, rounded, condensed), color world (light neutral, dark, one bold color ground, paper), shape (sharp, soft, pill, cut corners), imagery (photos, drawings, type only, objects) |

- Every pair of directions differs on at least 3 of the 4 axes.
- No direction reuses anything on the Not again note: a font family, the ground, ink, and accent set, the primary button shape, or the navigation.
- Each direction gets its own metaphor and job map ([Signature and job map](#signature-and-job-map)).
- At most one direction is the safe one, close to what similar apps do. The other two take a risk, and their bad note says what the risk costs.
- Each still does the job in the brief and keeps every state in [Screens](#screens). Steps may merge or change order.
- Name each direction after its idea, such as "The cabinet". Templates come later, in step 4.
- Wireframes stay grays plus one accent, but each row uses its own accent and its own font pairing, so the difference shows before any color work.

## Signature and job map

Take the metaphor from the idea's own world: a fridge, a ticket, a passport, a receipt, a car dashboard, a field notebook. The parts come from that object, so their number and kind change with it. A ticket has a stub, a perforation, and a seat. A passport has pages and stamps. Do not start from a fixed set such as a display, a lamp, and a handle.

Give each part one job and one rule, and keep both on every screen. When no object fits, make one component the signature and use it the same way everywhere.

## Slop list

Never use:

- purple or blue gradients, glow orbs, neon borders, mesh blobs, or glass blur on everything;
- emojis as icons, generic icon packs, or sparkle "AI" icons;
- lorem ipsum, "Revolutionize your…", "Unlock the power of…", "seamless", or "effortless";
- three identical feature cards, each an icon, a title, and two lines;
- "As seen in" logos, stock-face testimonials, invented stats such as "10k+ users", or star ratings;
- everything centered, every card the same size, or a shadow on everything;
- more than one accent color, more than two font families, or more than three weights;
- this skill's own house look: an off-white ground with near-black ink and one blue, a black pill button with a white circle arrow, a floating pill tab bar, a dark mono status bar with an LED dot, and thin padding around every photo. Use one of these only when a direction's idea needs it, and never all together;
- three directions that are the same screens in three skins.

## Craft rules

These hold on every run. The values are the picked direction's own.

- **Identity line:** two short sentences that name the feel, such as "Warm kitchen light. Appliance precision."
- **Colors:** each color has one role. One accent with one meaning. Ready, needs-one-thing, and destructive colors are separate from the accent, and red is for destructive only.
- **Type:** at most two families and three weights. One type scale for the phone and one for the landing page. Large sans headlines get negative letter-spacing (−0.02 to −0.05em), a tight line height, and `text-wrap: balance`.
- **Radius:** one set of 3–4 radii, plus pill if the direction uses it. A nested radius is the outer radius minus the padding: a 22 card with 5 padding holds a photo with radius 17.
- **Spacing:** 8 pt grid, 16 phone gutter, section gaps near 112 on desktop and 80 on phone.
- **Touch:** 44 minimum. The primary action is 48–56 tall.
- **Depth:** one depth model per direction, used everywhere: borders, shadows, or color blocks.

## Components

Each direction designs its own versions of these on the style sheet:

- the primary action, one per screen, in the direction's own shape;
- a secondary action, and its version on photos or dark areas;
- navigation;
- the status display, for counts, time, and progress;
- chips or tags, with a visible guess state when the app guesses;
- cards, inputs, and the photo frame.

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
- paywall, when the app has a paid tier: a free path, the usage count, restore, and terms;
- saved or history, with filters and an empty filter state;
- account: subscription, preferences, privacy, help, log out.

Rules:

- one primary action per screen;
- copy says what happens next ("Find 3 meals", not "Submit");
- numbers carry units;
- uncertainty is shown, never hidden;
- safety settings, such as allergies, are checked and named on the result.

## Landing

Take the section order from one reference template picked in step 4, and fill it with the app's own content. Whatever the order, the page has:

- a nav with one CTA, and the launch CTA from the brief on every CTA;
- a hero that shows the real product or its result early, not a feature list;
- how it works, with real pieces of the UI;
- true product facts only, never invented stats or logos;
- pricing shaped by the pricing model from the brief: for free plus paid, a free tier and a paid tier with placeholder prices, and a billing toggle only when there are monthly and yearly plans. A free app skips pricing;
- an FAQ with real questions: account, wrong results, safety, what paid adds;
- a closing CTA and a footer with the legal line.

Build it fluid: one file, `auto-fit` grids, and one breakpoint near 760px.

## Consistency pass

Check across all boards:

- every item, meal, and person name is spelled the same everywhere;
- numbers agree: display counts match the lists, and prices and limits match;
- each photo shows what its text says;
- nothing is both "on hand" and "to buy", and a setting shown on one screen holds on the others;
- every link goes where its label says, and every control does something;
- no lorem ipsum, emoji, or invented data is left.

## Pantry example (do not reuse)

The first mockup the user approved. It shows how far a style sheet and a job map go. Its values are taken. A new mockup uses none of them unless its direction needs one, and never the set.

Job map:

| Part | Job | Rule |
|---|---|---|
| Dark display | Status: counts, time, progress | Never holds buttons |
| Interior lamp | Warm when open, accent blue while the AI works | Blue means nothing else |
| Glass shelves, crisper | The ingredients, each on its own shelf | A blue ring and a `?` mark a guess |
| Door bin | Staples such as oil and salt | Never assumed; the user ticks them |
| Handle | The one main action | One per screen |

Colors:

| Token | Value | Role |
|---|---|---|
| ground | `#F4F4F1` | App background, warm off-white |
| surface | `#FFFFFF` | Cards, sheets |
| line, line-2 | `#E5E5E0`, `#D4D4CE` | Borders, dividers |
| ink | `#111110` | Text and the one action |
| ink-2 | `#5C5C57` | Secondary text |
| accent | `#2456D3` on `#EAF0FD` | Guessing or working |
| green | `#1F7A4A` on `#E5F2EA` | Ready, done |
| amber | `#94570A` on `#FBEFD9` | Needs one thing |
| red | `#B3261E` | Destructive only |
| glass | `#0E0F11` | Displays and the one dark card |

- **Type:** Inter for everything, Geist Mono for readouts and small caps labels. Phone scale: display 64, H1 32, H2 22, title 16, body 15, small 13, readout 19–22 mono. Landing: hero 84, section 56, lead 18; on phone, hero 46 and section 36.
- **Radius:** 12, 20, 28, and pill.
- **Depth:** 1px borders, and one soft long shadow (`0 16px 30px -14px rgba(17,17,16,.3)`) only for things that float.
- **Components:** a black 56 pill with the label left and a 44 white circle arrow right; white round 44 secondary buttons; an eyebrow pill with a 6px dot; a dark glass readout bar with mono cells and an LED dot; chips with a 28px icon circle; a floating white pill tab bar 24 from the bottom with a black active tab; photo cards with 5px padding.
- **Landing order (App Land on Framer):** nav, photo hero card, phone overlapping the hero, things the app knows, how it works in 3 cards, split with checks, 3+3 bento, facts, pricing, FAQ, dark CTA band, footer.
