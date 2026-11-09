---
name: check-rtl-ui
description: Use when you want to check or fix right-to-left screens (Hebrew, Arabic, Persian, Urdu). It checks mirroring, mixed-direction text, icons, forms, and mobile sizes. Say "check RTL", "Hebrew UI is broken", or "mirror the layout".
type: flow
---

# Check RTL UI

Verify the real localized interface, not a blanket `direction: rtl` approximation. Direction, reading order, interaction, mixed content, and visual hierarchy must all remain correct.

## Safety

- Read the repository's localization, design-system, and browser-testing instructions before editing.
- Preserve language meaning. Do not rewrite copy you cannot confidently review; flag linguistic uncertainty separately from layout defects.
- Do not mirror brand marks, media controls, clocks, checkmarks, phone numbers, or other semantically fixed assets without evidence.
- Avoid global transforms and broad physical-property rewrites that can regress left-to-right locales. Fix the owning component or token.

## Workflow

1. Launch the real page in the RTL locale and its corresponding LTR locale. Record route, locale mechanism, viewport set, and build identity.
2. Inspect document `lang` and `dir`, framework locale state, DOM order, accessibility tree, focus order, and computed styles.
3. Audit layout with logical properties: inline/block margins, padding, inset, border radii, text alignment, flex/grid order, scroll origin, sticky edges, overlays, and safe areas.
4. Audit content: headings, paragraphs, lists, tables, forms, placeholders, validation, dates, currency, phone numbers, email, URLs, code, filenames, and user-generated mixed-direction strings. Apply bidi isolation such as `bdi`, `dir="auto"`, or Unicode isolation only where semantics require it.
5. Classify icons and motion as directional, neutral, or fixed. Mirror back/forward arrows and progress direction where appropriate; keep neutral and culturally fixed assets unchanged.
6. Exercise keyboard navigation, screen-reader names/order, pointer targets, selection, horizontal scrolling, carousels, menus, dialogs, toasts, and animation direction.
7. Fix source using shared tokens/components when the defect repeats. Verify no LTR regression.
8. Re-run at representative narrow, medium, and wide viewports with realistic short and long localized content. Capture before/after screenshots.

## Verification

Report:

- routes, locales, viewports, and build or commit tested;
- `lang`/`dir` and locale activation evidence;
- defects grouped by layout, bidi content, icons/motion, interaction, and accessibility;
- exact source fixes and before/after screenshot paths;
- keyboard/focus and mixed-content results;
- LTR regression check plus automated UI/build checks;
- copy questions that require a fluent reviewer.

Do not call an RTL page correct after inspecting only static CSS, one viewport, or pure Hebrew text without numbers and Latin-script content.
