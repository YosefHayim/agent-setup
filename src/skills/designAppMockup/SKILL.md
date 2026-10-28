---
name: design-app-mockup
description: Use when you have an app idea and want premium, Framer-level UI mockups before you build — clean, minimal, not AI slop. It shows 3 real Framer templates that fit the idea for you to pick, studies the one you pick (layout, type, motion), and builds a high-fidelity landing page from it: inspired by it, or a close match in your own colors and content when you ask, never with its copy, photos, or logos. After you approve the page, it builds a UI library from it, then clickable app screens with custom icons and real photos. Say "design my app idea", "mock up this idea", "Framer-vibe landing page", "match this template for my app", or "premium UI for…". For flows in an existing app, use improve-ux. To turn a finished design into exact code, use image-to-code.
type: flow
---

# Design app mockup

Turn an app idea into a final UI mockup at the level of a good Framer template. The landing page comes first, and the UI library and app screens are built from it. Mockups only, no app code.

Everything the user sees is high fidelity: the final type and colors, real copy, real product UI, and motion. Never show gray-box wireframes, or directions built on object metaphors such as a report, a road sign, or a logbook. A user rejected exactly that as "terrible" and asked for "a framer vibe ui ux landing page that we will then build the rest of the ui library from".

The taste rules live in [REFERENCE.md](REFERENCE.md). Follow the steps in order.

## Safety

- Mockups only. Write no app code and change no repo files.
- Two stops: after the template pick (step 2) and after the landing page (step 4). Build nothing past a stop without the user's yes.
- A template is never copied. Inspired, the default, keeps its frame, spacing, type scale, and kind of motion, and gives the app its own palette, fonts, hero, and section mix. A close match, only when the user asks, also keeps its layout, section order, and motion, and changes the colors, copy, product UI, and imagery. Never take its copy, photos, illustrations, logos, or files ([REFERENCE.md → Inspired or close match](REFERENCE.md#inspired-or-close-match)).
- Keep every artifact private. Never share, deploy, or post it. Template captures stay in the scratchpad and never go into a board or an upload.
- Photos: free licenses only. Use CC0 or public domain first, and CC BY only with the credit noted. Never use a brand's photos or logos, or a real person's likeness.
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

### 2. Pick a template — stop

Note the templates, fonts, and colors of the last 3 mockups this skill made ([REFERENCE.md → Past mockups](REFERENCE.md#past-mockups)).

Find 6–8 real templates that fit the idea, Framer marketplace first ([REFERENCE.md → Finding templates](REFERENCE.md#finding-templates)). Capture the first screen of each with [scripts/captureTemplate.mjs](scripts/captureTemplate.mjs), and look at every shot yourself. Offer the 3 best. They must differ from each other in ground, type, and how they show the product, and none may come from a past mockup.

For each one, give:

- the name and the preview link;
- one line on why it fits the idea;
- what would carry over: the layout, the motion, or the feel.

Recommend one. In the same card, ask whether the page should be inspired by it or a close match in the app's colors and content, and say which templates are paid ([REFERENCE.md → Inspired or close match](REFERENCE.md#inspired-or-close-match)). Stop until the user picks. They may mix templates, such as "Sola's layout on Signal's dark ground".

### 3. Study the template

Capture the picked template screen by screen at 1440 and at 390 ([REFERENCE.md → Capturing a template](REFERENCE.md#capturing-a-template)). Look at every screen and every motion frame. Read `study.json` for the fonts, colors, radii, section order, and load motion. Write a study note in the scratchpad ([REFERENCE.md → Study note](REFERENCE.md#study-note)).

Then write the plan for the picked mode:

- what carries over: the frame, spacing, type scale, and motion, plus the layout and section order for a close match;
- what is the app's own: the palette and all copy and imagery, plus the fonts, the hero moment, one signature component, and the section mix when inspired;
- for a close match, each template section and the app's true content that fills it.

Check the plan against [REFERENCE.md → Inspired or close match](REFERENCE.md#inspired-or-close-match).

### 4. Landing page first — stop

Build one fluid landing page at the template's level ([REFERENCE.md → Landing](REFERENCE.md#landing), [Hi-fi bar](REFERENCE.md#hi-fi-bar), [Motion](REFERENCE.md#motion)). It has the app's real copy, real product UI in the hero and in how it works, and motion. Every CTA is the launch CTA. Show it on the canvas at 1440 and 390 ([REFERENCE.md → Canvas](REFERENCE.md#canvas)).

Render both sizes yourself, after the motion settles, and look at the renders. Put each one next to the template's matching screen and fix what looks off before you show the user anything. Inspired: run the glance test and change more where the two could be mistaken for each other. Close match: run the match check and fix each section that drifts from the template's measurements.

Tell the user in 3 lines what carried over and what is the app's own. List the boards that come next: the library, icons, and every app screen. Stop until they approve or ask for changes.

### 5. UI library from the landing page

Build the style sheet and component library from the approved page ([REFERENCE.md → UI library](REFERENCE.md#ui-library)):

- tokens copied exactly from the page;
- every component the page uses;
- the components the app needs that the page lacks, in the same grammar;
- every state for each component.

Every later board uses only these tokens and components.

### 6. Icons and photos

- Icons: one custom SVG set in one style for the idea's common things ([REFERENCE.md → Icons](REFERENCE.md#icons)). Render them side by side on one sheet and redraw any that look off.
- Photos: real free-license photos ([REFERENCE.md → Photos](REFERENCE.md#photos)), cropped to their slots and graded to one look. Check them as one contact sheet. When text and photo disagree, change the text.

### 7. App screens in journey order

Build the screens in journey order from the library ([REFERENCE.md → Screens](REFERENCE.md#screens)):

- the journeys the app's idea and purpose need: first use to first result, fixes and edge cases, then account and payment only when the app has them;
- each journey on one tall board that a new user reads top to bottom, step by step, with the journeys side by side ([REFERENCE.md → Canvas](REFERENCE.md#canvas));
- one primary action per screen, every state, and real copy;
- navigation and home shaped by the app's job, never by a past mockup;
- links from each step to the next, so each journey clicks through.

### 8. Consistency pass and cleanup

Read every board against the landing page and the library ([REFERENCE.md → Consistency pass](REFERENCE.md#consistency-pass)), and fix each mismatch. Lay out the canvas with page titles. Delete the template captures, the study note, renders, and photo work files.

## Verification

Report:

- the canvas link (or local canvas path) and the template picked;
- the mode (inspired or close match), what carried over from the template and what is the app's own, with the glance test or the match check passed;
- that the 1440 and 390 renders were checked by eye next to the template;
- photo sources and licenses, and which need a credit line;
- every placeholder left for the user, such as prices and store links;
- how the real app should get its photos and icons.

The mockup is done when every board in the approved list exists, each journey reads top to bottom and clicks through, and the consistency pass finds nothing left to fix.
