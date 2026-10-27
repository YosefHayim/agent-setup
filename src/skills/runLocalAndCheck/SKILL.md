---
name: run-local-and-check
description: Use when you want to run the app on your computer and prove it works. It starts the app, tests it in a real browser with Playwright, or in the iOS simulator or Android emulator for Expo and React Native apps. No deploy. Say "run local", "test it in the browser", "simulator", "emulator", "on my phone", "relaunch so I see it", or "did you check it works". For production, use deploy-and-check.
type: flow
---

# Run local and check

Validate the product through the surface the user actually sees. Source inspection and automated tests support the claim; they do not replace a real browser-visible run.

## Safety

- Read the repository's run, test-data, and environment instructions before starting services.
- Use local, sandbox, preview, or explicitly authorized test accounts and payment methods. Never create a production charge, send a real campaign, or mutate customer data to prove a flow.
- Do not expose credentials, cookies, tokens, personal data, or private screenshots in logs or the final report.
- For mobile, boot only a simulator or emulator, never a real phone, and shut down the one you started when done. Screenshots may show private data, so keep them out of the repo.
- Ask only when a required credential, irreversible action, or product choice cannot be discovered safely. If a surface is unavailable, report it as unverified.

## Workflow

1. Define the exact route, actor, viewport, preconditions, success state, and side effects to verify. For checkout, authentication, onboarding, and other stateful funnels, include at least one safe failure-and-recovery path.
2. Inspect repository instructions and start the real application plus required local dependencies. Record the URL, build identity, seed/test account, and relevant feature flags without revealing secrets.
3. Open the app in a real browser. Reproduce the flow through visible controls rather than bypassing it with direct API calls.
4. Observe the page, accessibility tree, console, failed requests, redirects, cookies/storage, and network responses relevant to the flow.
5. Verify the durable outcome behind the confirmation UI: persisted record, sandbox provider state, session transition, delivered local event, or other authoritative readback.
6. Test representative desktop and mobile viewports when layout matters. Capture before/after screenshots for fixes and freeze animation or nondeterministic data when comparison matters.
7. Fix only after reproducing the problem. Re-run the complete flow from a clean state, then run the repository's relevant automated checks.

## Mobile apps (Expo / React Native)

Use this path when the repo has `app.json` or `app.config.*`, or `ios/` or `android/` folders. Prefer the repo's own scripts in `package.json` over the commands below.

iOS Simulator (`xcrun simctl help` lists every subcommand):

1. Boot one: `xcrun simctl boot <device>` (list them with `xcrun simctl list devices`), or let `npx expo run:ios` boot one.
2. Launch the app: `npx expo run:ios`, or `npx expo start` and press `i`.
3. Screenshot: `xcrun simctl io booted screenshot <path>.png`.

Android emulator:

1. List devices: `emulator -list-avds`. Start one: `emulator -avd <name>`.
2. Wait for it: `adb wait-for-device`.
3. Launch the app: `npx expo run:android`, or `npx expo start` and press `a`.
4. Screenshot: `adb exec-out screencap -p > <path>.png`.

To clean the cache and relaunch like a new build, run `npx expo start --clear`. If native code or config changed, do a fresh native build with `npx expo run:ios` or `npx expo run:android`.

Read each screenshot and check the screen against the success state from step 1. When done, shut down what you started: `xcrun simctl shutdown <device>`, or `adb emu kill` for the emulator.

Docs: Expo CLI (https://docs.expo.dev/more/expo-cli/), Android adb (https://developer.android.com/tools/adb).

For extensions, verify the unpacked extension in a headed browser and its actual host permissions/content-script behavior. For OAuth or payments, include redirect and callback/webhook state, not only the final page.

## Verification

Report:

- exact route, actor, viewport, environment, and build or commit identity;
- steps performed and the observed visible result;
- console/network errors, including “none observed” only when inspected;
- authoritative persisted or provider-side readback;
- screenshot or artifact paths when safe to retain, and for mobile the screen you read in each one;
- automated checks and any surface that remained inaccessible.

For mobile, do not say it works unless a screenshot from the simulator or emulator was read, and say that you shut it down.

Do not say “works in the UI” if only source, unit tests, an API, or a mocked component was exercised.
