# Design app mockup — reference

The craft rules here hold on every run. The values (colors, fonts, radii, motion timings) always come from the approved landing page, never from an example in this file.

## Canvas

**With an Artifact tool (Claude Code):** run `quickstart` with intent `design` and create the canvas from the Design type it names. Follow that type's own instructions for boards, pages, and the canvas file.

- Pages: Landing, Library, Icons and photos, then one page per journey.
- One row per journey, with a short note under each screen.
- Publish each board right after you write it.
- Before you publish the canvas file again, read the published copy and edit that, so boards the user moved stay where they are.
- Upload photos and icons as assets, and use each one by the URL the upload returns.
- Add a short note on the Landing page that names the template it was inspired by, so the next run can find it.

**Without an Artifact tool (Codex and others):** write the boards into a folder the user names, one HTML file per board. Add a `canvas.html` that shows every board in rows by page, each in an iframe at its real size with its title above it. Open it in the browser. Use no build step and no framework, and load fonts from Google Fonts.

**Sizes:** phone boards are 390x844. The landing page is one fluid file, shown at 1440 and at 390.

**Checking a board yourself:** render a local copy with `scripts/captureTemplate.mjs --url file:///<path to board>` at each size, and look at the motion frames and every screen. Give each board `<meta name="viewport" content="width=device-width, initial-scale=1">` in its head, or the 390 render lays out at 980 and the phone styles never apply. For the still state, also render a copy with `prefers-reduced-motion: no-preference` changed to `reduce`: it shows what users who turn motion off see, and the accordion and panel at rest.

## Past mockups

Before picking a template, look at the last 3 mockups this skill made, so the new one does not repeat them.

- **With an Artifact tool:** run `list` and take the 3 newest Design canvases this skill made. Save each one's `project/canvas.json` and its landing board (or style sheet) to the scratchpad. Grep them for the template note, the Google Fonts link, and the hex colors. Do not read whole boards.
- **Without one:** use the canvas folders the user names, or ask once for them.
- From each, note the template, the fonts, the ground and accent colors, and how the hero shows the product.
- None of these comes back as the new template, font pair, or color set.

## Finding templates

- **Sources, in order:** the Framer marketplace (framer.com/marketplace/templates), searched by the idea's category, then webflow.com/templates, then galleries of live sites such as Land-book or Godly. Use only templates with a live preview link.
- **Fit:** match the audience (business tool, consumer app, local service), the launch CTA (a download suits phone-led templates, a sign-up suits product-led ones), what the app can show (a product UI, photos, or only type), and the language direction. An RTL app needs a layout that mirrors cleanly.
- **The 3 offered** differ from each other on all three of:
  - the ground: light paper, dark, or a bold brand block;
  - the type: a serif display, a grotesk, a rounded or condensed face;
  - how they show the product: a framed dashboard, a phone, a live widget, photos, or type only.
- Shortlist by the first screen and the load motion: `screen-00.jpg` and the 4 `motion-*.jpg` frames of each capture.

## Capturing a template

```sh
node <skill folder>/scripts/captureTemplate.mjs --url <preview url> --out-folder <scratchpad>/refs/<name>-1440
node <skill folder>/scripts/captureTemplate.mjs --url <preview url> --out-folder <scratchpad>/refs/<name>-390 --width 390 --height 844
```

It needs Node 22 or later and Chrome. Pass `--chrome-path` or set `CHROME_PATH` when Chrome is not in the macOS default place. It opens the page in headless Chrome and saves to the out folder:

- `motion-0.jpg` to `motion-3.jpg`: the load animation at about 0.35, 0.85, 1.55, and 2.75 seconds;
- `screen-00.jpg` and on: the page one screen at a time, each after the scroll animations settle;
- `study.json`: the type of h1, h2, h3, and body, the most used fonts, text colors, backgrounds, radii, and shadows, the section order with headings, and the load motion (Framer appear animations, split headlines, CSS animations, backdrop blurs).

Captures are for looking only. They stay in the scratchpad and are deleted at the end.

## Study note

Write it in the scratchpad after looking at every screen. Keep it to what makes the template feel premium:

- **Frame:** the column width, the gutters, hairline rules, cells, and where they meet.
- **Type:** the display, body, and label roles, with family, sizes at 1440 and 390, weight, tracking, and line height.
- **Color:** the base, the brand ground, the ink, the accent, and where each one appears.
- **Shape and depth:** the radius set, borders, rings, shadows, and glows.
- **Sections:** the order, and what each one shows (columns, split, carousel, timeline, accordion).
- **Motion:** what moves on load, from where, with what delays and easing; what reveals on scroll; which product UI loops; hover.
- **The 3–5 touches** that carry the feel, such as a framed column with dot nodes, a serif headline that rises word by word, or mini product cards with a moving cursor.

See [Study note example](#study-note-example-sola-do-not-reuse).

## Not a copy

Keep the template's grammar and change its values. The page should feel like the same family of quality, never like the same site.

**Carries over:** the framing, the section rhythm, the density, the kinds of components, and the kind and pace of motion.

**The app's own:**

- the palette: a different hue family for the brand ground and the accent;
- the fonts: different families, even when they play the same roles;
- the hero moment: the app's real product UI doing its job, never the template's dashboard;
- one signature component the template does not have, built from what the app does;
- the section mix: drop, merge, and add sections to fit the app's real content, never the template's full order 1:1;
- all copy, imagery, and icons;
- the motion choreography: which things move and in what order. Timings may sit in the same range.

**Never taken:** the template's code, files, images, illustrations, logos, or SVGs.

**Glance test:** put each render next to the template's matching screen. If someone could mistake one for the other at a glance, change more. Start with the ground color, the hero layout, and the display font.

## Hi-fi bar

Every board the user sees meets all of these:

- **Frame:** a clear column or grid that every section lines up to.
- **Real product UI:** in the hero and in most sections, built in HTML with real data from the brief. Never gray bars, fake charts, or "image here" boxes.
- **Color:** one brand ground used for 2–4 big blocks (such as the hero, a feature panel, and the closing CTA), a paper or dark base, and one bright accent used sparingly (the primary button, ticks, live dots).
- **Type roles:** display, body, and label. Large display type gets tight tracking (−0.02 to −0.04em) and `text-wrap: balance`.
- **Section rhythm:** an eyebrow, a headline, one line of sub, then the piece. The pieces vary (columns, split, carousel, timeline, accordion). Never the same card grid twice.
- **Details:** buttons with an inner ring or highlight, a pill badge in the hero, check lists, time pills, key hints, and visible hover and focus on every control.
- **Phone:** designed at 390, not squeezed. Choose the stack order, crop or simplify the product UI, use a menu button for the nav, and give it its own type scale.

## Motion

Motion is part of the mockup, and every board that has it is checked in the motion frames. All of it sits inside `prefers-reduced-motion: no-preference`, and the base styles keep every piece of content visible and in place, so nothing is lost with motion off or before it runs.

```css
@media (prefers-reduced-motion: no-preference) {
  .rise { animation: rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay: calc(var(--step) * 90ms); }
  .blur-in { animation: blur-in 0.7s ease-out both; animation-delay: calc(var(--step) * 90ms); }
  @supports (animation-timeline: view()) {
    .reveal { animation: rise linear both; animation-timeline: view(); animation-range: entry 0% cover 30%; }
  }
}
@keyframes rise { from { opacity: 0; translate: 0 12px; } }
@keyframes blur-in { from { opacity: 0; filter: blur(8px); } }
```

- **Load:** one sequence, 80–120ms apart, done within about 1.5 seconds: the badge, the headline, the sub, the buttons, then the product UI.
- **Headline:** split by word, each word an inline-block span with its own `--step`. Never split by letter: it breaks screen readers and RTL scripts.
- **Scroll:** each section's piece reveals once with `animation-timeline: view()`, and stays shown where it is not supported.
- **Product UI:** one loop per view that shows the app working, such as a cursor that moves and clicks, a progress bar, rows that appear one by one, or a counter. Loop every 6–10 seconds with a pause. Text never loops.
- **Accordion or tabs:** may auto-advance every few seconds with a progress line, and stop on the first click.
- **Hover:** a 2px lift or a stronger ring, 150–200ms.

## Slop list

Never show:

- gray-box wireframes, placeholder rectangles, or "image here" frames;
- directions or layouts forced from an object metaphor, such as the app as a report, a road sign, or a logbook;
- purple or blue gradients, glow orbs, neon borders, mesh blobs, or glass blur on everything;
- emojis as icons, generic icon packs, or sparkle "AI" icons;
- lorem ipsum, "Revolutionize your…", "Unlock the power of…", "seamless", or "effortless";
- three identical feature cards, each an icon, a title, and two lines, as the main explanation;
- invented logos, stats, testimonials, star ratings, or user counts;
- a product shot that is a fake dashboard of gray bars instead of the app's real UI;
- every section in the same layout, or a shadow on everything;
- more than one accent color, more than two font families, or more than three weights;
- the template, font pair, or color set of a past mockup;
- a 1:1 copy of the template ([Not a copy](#not-a-copy)).

Normal Framer polish is welcome when it serves the page: hairline frames, pill buttons, a serif display, a dark brand block, soft shadows on floating product UI.

## Craft rules

- **Identity line:** two short sentences that name the feel, such as "Quiet paper, navy depth. Every claim shows its proof."
- **Colors:** each color has one role. One accent with one meaning. Ready, needs-one-thing, and destructive colors are separate from the accent, and red is for destructive only.
- **Type:** at most two families and three weights. One type scale for the landing page and one for the app screens. App screens use the body family; the display face is for big moments only.
- **Radius:** one set of 3–4 radii, plus pill if the page uses it. A nested radius is the outer radius minus the padding: a 22 card with 5 padding holds a photo with radius 17.
- **Spacing:** 8 pt grid, 16 phone gutter, section gaps near 112 on desktop and 80 on phone.
- **Touch:** 44 minimum. The primary action is 48–56 tall.
- **Depth:** one depth model everywhere: borders and rings, shadows, or color blocks.
- **Direction:** an RTL app is built RTL from the start, with logical properties (`margin-inline-start`, `inset-inline-end`) and icons that point the right way.

## UI library

Built from the approved landing page, on the Library page:

- **Tokens:** colors with their roles, the landing and app type scales, radii, spacing, depth, and motion (durations, easing, stagger step). Copy each value exactly from the page.
- **From the page:** nav, primary and secondary buttons (also on the brand ground), the pill badge, eyebrow and section header, cards, check lists, time pills, accordion, tabs, pricing column, FAQ item, and footer.
- **For the app:** inputs, selects, toggles for anything on or off, lists or tables, status chips (ready, needs one thing, error), progress, empty states, toasts, dialogs, and the app navigation. Each one uses the page's shapes, rings, and type roles.
- **States:** default, hover, focus, pressed, disabled, loading, error, and selected, where each applies.

## Icons

- Use one grid (such as a 48 viewBox), one stroke or fill style, 2–3 tones per item from the library's palette, and light from the same side.
- Cover the 20–30 most common things in the idea's world.
- Put them on one sheet board with names. Render the sheet and redraw any icon that looks heavier, smaller, or in another style.

## Photos

- **Sources, in order:** Wikimedia Commons filtered to CC0 or public domain, then Openverse, then the Unsplash or Pexels license (no credit needed). Record each file's source URL and license.
- **Pick** shots with one subject, a calm background, and natural light, at the same angle within a group (top-down for food).
- **Grade** after cropping, all with one look: a small warm or cool shift (such as red ×1.035, green ×1.0, blue ×0.94), a lift for dark shots, contrast ×1.05, saturation ×1.06. Compare before and after as one contact sheet.
- **Match:** when a photo and its text disagree, rename the item.
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

Take the rhythm of the picked template and fill it with the app's own section mix. Whatever the order, the page has:

- a nav with one CTA, and the launch CTA from the brief on every CTA;
- a hero that shows the real product doing its job early, not a feature list;
- how it works, with real pieces of the UI and how long each step takes;
- true product facts only;
- pricing shaped by the pricing model from the brief: for free plus paid, a free tier and a paid tier with placeholder prices, and a billing toggle only when there are monthly and yearly plans. A free app skips pricing;
- an FAQ with real questions: account, wrong results, safety, what paid adds;
- a closing CTA and a footer with the legal line.

Proof sections from the template become true content:

| Template section | Becomes |
|---|---|
| Customer logo strip | The platforms or tools the app really works with, as text |
| Stats row | True product facts, such as limits, times, or the rule the app follows |
| Testimonials, case study | Only when the user gives real ones. Otherwise drop it, or show a worked example labeled as an example, with no person |
| Changelog | Only real releases. Otherwise a "what happens after you sign up" timeline |

Build it fluid: one file, `auto-fit` grids, and one breakpoint near 760px.

## Consistency pass

Check across all boards:

- every item, plan, and person name is spelled the same everywhere;
- numbers agree: counts match the lists, and prices and limits match;
- each photo shows what its text says;
- a setting shown on one screen holds on the others;
- every token and component on a board comes from the library;
- every link goes where its label says, and every control does something;
- no lorem ipsum, emoji, gray box, or invented data is left.

## Study note example (Sola, do not reuse)

The study that the first landing-first mockup came from. It shows the depth a note needs. Its values belong to Sola.

- **Frame:** a 1336 column framed by vertical hairlines, a hairline between sections, and small dot nodes where they cross. Cells split by hairlines, never cards with gaps.
- **Type:** a serif display (48 at 1440, weight 400, −0.02em, line height 1.1), a sans body, a mono label in caps for eyebrows and dates.
- **Color:** a warm paper base, a deep navy brand ground for the hero, the feature panel, and the CTA, charcoal ink, and one mint accent for the primary button, ticks, and a glowing dot.
- **Shape and depth:** radii 30 (pill), 16, 12, 8. Buttons have a 1px ring and an inset highlight.
- **Sections:** hero in an inset navy block, logo strip, how it works in 3 hairline columns with mini product cards and time pills, a big serif statement, stats with ticks, features as an auto-advancing accordion beside a navy product panel, integrations orbit, a 3-card carousel, changelog timeline, dark security band, pricing in 3 hairline columns with the middle one ruled in mint, FAQ with tabs, closing CTA with a dashboard rising into the footer.
- **Motion:** load stagger at 0.1s steps (fade and rise 10px on a soft spring), the headline rising letter by letter, logos blurring in, a cursor clicking inside each mini card, the accordion's progress line, reveals on scroll.
- **Touches:** the framed column with dot nodes, the serif rising on navy, mini product cards with time pills.
