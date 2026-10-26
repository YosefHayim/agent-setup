---
name: design-app-mockup
description: Use when you have an app idea and want premium, Framer-level UI mockups before you build — clean, minimal, not AI slop. It shows wireframes with 3 directions that differ in how the app works and never repeat your past mockups, for you to pick, then builds the final UI with a style sheet, custom icons, real photos, clickable app journeys, and a landing page. Say "design my app idea", "mock up this idea", or "premium UI for…". For flows in an existing app, use improve-ux. To turn a finished design into exact code, use image-to-code.
type: flow
---

# Design app mockup

Turn an app idea into a final UI mockup at the level of a good Framer template: real photos, custom icons, and every UX state thought through. Mockups only, no app code.

The quality comes from the order of the work and a few hard rules, not from polishing each screen. Follow the steps in order. The taste rules live in [REFERENCE.md](REFERENCE.md).

## Safety

- Mockups only. Write no app code and change no repo files.
- Two stops: after the wireframe directions (step 3) and after the build plan (step 4). Build nothing past a stop without the user's yes.
- Keep every artifact private. Never share, deploy, or post it.
- Photos: free licenses only — CC0 or public domain first, CC BY only with the credit noted. Never a brand's photos or logos, and never a real person's likeness.
- Never invent stats, reviews, testimonials, press logos, user counts, or prices. Use a placeholder such as `[YOUR PRICE]`.
- Working files go in the session scratchpad or a folder the user names, never in `/tmp` and never inside a repo. Delete them at the end.

## Workflow

### 1. Brief

Quote the idea word for word. Read anything the user points at (old designs, copy, a repo) and reuse its flows, copy, and rules. Do not invent features.

Ask in one question card only what is still open:

- who it is for and the one job it does;
- platforms and sizes (iPhone 390x844 by default, web 1440);
- the launch CTA: download, sign up, or waitlist;
- the pricing model. Prices stay placeholders unless the user gives them.

### 2. Past mockups and signatures

Read the last 3 mockups this skill made and write what they used in a "Not again" note ([REFERENCE.md → Past mockups](REFERENCE.md#past-mockups)). Every mockup gets its own look, so nothing on that note comes back.

Then pick 3 different metaphors from the idea's own world, one per direction, such as a fridge, a recipe card, and a shopping list for a pantry app. Give each part one job and keep it the same on every screen ([REFERENCE.md → Signature and job map](REFERENCE.md#signature-and-job-map)).

### 3. Wireframes with 3 directions — stop

Build a canvas ([REFERENCE.md → Canvas](REFERENCE.md#canvas)) with:

- a "Directions" page: 3 directions, one row each, and a good and bad note under each row. Every row shows the same 3 key jobs, each laid out its own way. Mark the one you recommend;
- the direction table that places each direction on the axes, so the user sees they differ in how the app works, not only in looks ([REFERENCE.md → Directions](REFERENCE.md#directions)). Redo a direction that differs from another on fewer than 3 axes or repeats the Not again note;
- the Not again note, each direction's job map, and a "how to read this canvas" note;
- one page per journey with screens left to right and a "Step N" note under each: first use to first result, fixes and edge cases, account and payment. Draw them in the recommended direction, not a neutral shell;
- grays plus each row's own accent and font pairing, gray squares for icons, and real text and data. Never lorem ipsum.

Tell the user in 3 lines which direction you recommend and why. Stop until they pick.

### 4. References and build plan — stop

Pick 3–4 real templates that fit the picked direction, Framer marketplace first. For each, name the one touch you borrow, never a layout to copy. Name the one whose section order the landing page takes. Name the slop you will avoid ([REFERENCE.md → Slop list](REFERENCE.md#slop-list)).

List the boards: style sheet, icon sheet when the idea has physical things, every app screen, and the landing page at desktop and phone. Say how the real app will get its photos and icons. Stop until the user says go.

### 5. Style sheet first

Build the style sheet board before any screen, from [REFERENCE.md → Craft rules](REFERENCE.md#craft-rules) and [Components](REFERENCE.md#components): a one-line identity, colors with one role each, the type scale, the radius set, the grid, touch size, buttons, navigation, chips, cards, and the signature parts. The values come from the picked direction, never from the pantry example. Every later board copies them exactly.

### 6. Icons and photos

- Icons: one custom SVG set in one style for the idea's common things ([REFERENCE.md → Icons](REFERENCE.md#icons)). Render them side by side on one sheet and redraw any that look off.
- Photos: real free-license photos ([REFERENCE.md → Photos](REFERENCE.md#photos)), cropped to their slots and graded to one look. Check them as one contact sheet. When text and photo disagree, change the text.

### 7. App screens in journey order

Build the key screens from step 3 first, then the rest in journey order ([REFERENCE.md → Screens](REFERENCE.md#screens)): one primary action per screen, every state, real copy. Make a board interactive where a tap teaches something, and link screens so each journey clicks through.

### 8. Landing page

Follow the section order of the template named in step 4 ([REFERENCE.md → Landing](REFERENCE.md#landing)) with the app's own content. Every CTA is the launch CTA from step 1. Build one fluid page and show it at desktop 1440 and phone 390.

### 9. Consistency pass and cleanup

Read every board against the others ([REFERENCE.md → Consistency pass](REFERENCE.md#consistency-pass)) and fix each mismatch. Lay out the canvas with page titles and the legend. Delete research notes, renders, and photo work files.

## Verification

Report:

- the canvas link (or local canvas path) and the chosen direction;
- the direction table: every pair differs on at least 3 axes, and none repeats the Not again note;
- the references used and the touch taken from each;
- photo sources and licenses, and which need a credit line;
- every placeholder left for the user, such as prices and store links;
- how the real app should get its photos and icons.

The mockup is done when every board in the approved plan exists, each journey clicks through, and the consistency pass finds nothing left to fix.
