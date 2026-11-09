# TEACH-FORMAT.md — how to write the chat answer

The answer teaches the user *why this stack, and how it works*, in plain language they can re-read
and re-explain. It stays in chat; never save it to a file. It is **deduped** within the chat — never
repeat a decision or term already explained earlier in the conversation.

It is **not** `LANGUAGE.md` (that's the shared human↔agent glossary for *domain* terms) and **not** a
PR description (that's the terse, maintainer-facing record). This answer teaches *the human*.

## Answer layout

Two sections, in this order.

```markdown
## Decisions            <- one lean decision block per choice
## Glossary             <- one entry per term, alphabetical-ish, self-closing
```

## A Decision entry — lean and scannable (≈15-second read)

Keep the decision itself tight. Depth lives in the Glossary, not here.

```markdown
### Why <choice> — not <alt A>, <alt B>, <alt C>

**The deciding constraint.** <the one fact that forces the call, in one or two sentences.>

**The call, one line each:**
- **<alt A>** ✗ — <its real strength>, but <why it loses HERE>.
- **<alt B>** ✗ *here* — <genuine strength conceded>, but <the cost for this project>.
- **<choice>** ✓ — <the two or three concrete wins>.

**Principle: <name>.** <the reusable rule this decision is an instance of, one line.>

**When each wins instead:** <alt A> → <case> · <alt B> → <case> · <alt C> → <case>.
```

Rules for the decision block:
- **Concede the alternatives honestly.** Every ✗ names a real strength before the "but". A verdict
  with no conceded alternative is a sales pitch — reject it.
- **Name the principle**, not just the verdict, so the reader can re-derive the next decision.
- **Cite** any factual claim (version, limit, capability) inline to the official doc.

## A Glossary entry — self-closing, one snippet each

Every term used in a Decision (or inside another glossary entry) gets one entry. **The glossary must
close over itself**: if an explanation uses another jargon word, that word is *also* an entry — the
reader is left with zero unexplained terms.

```markdown
- **<term>** — <one plain-English line>. [official: <link>, when one exists]
  `<one short, real code snippet or ASCII "how it works" sketch>`
```

Rules for glossary entries:
- **One line of prose + one snippet.** The snippet is a *real* command / code / data shape / pipeline
  diagram — not pseudo-filler. Pick the snippet style that fits the term (see the styles below).
- **Cite official docs** for named tools/technologies (their own docs page), not blogs.
- **Order** foundational terms before the specific ones that build on them.
- **Dedup:** if a term was already explained earlier in this chat, skip it. Terms only get explained
  the first time they appear.
- **Beginner-safe:** assume the reader is new to the term. Better to define one they knew than to
  leave one they didn't.

### Snippet styles (match the style to the term)

| Term kind | Snippet style | Example |
|---|---|---|
| a tool you run | a terminal command | `$ pnpm tsx src/cli/main.ts install` |
| a language feature | a tiny code line + result | `const n = "x"; // -> "x"` |
| a data format | the shape itself | `{ "name": "setup" }` |
| a mechanism / engine | an ASCII "how it works" flow | `"1+1" ─▶ V8 ─▶ machine code ─▶ 2` |
| runtime vs compile behavior | line-by-line with a comment marking *when* | `print(1/0) # error only HERE, at runtime` |
| config-driven thing (a hook…) | the real config JSON | `{ "hooks": { "PostToolUse": [ … ] } }` |
| a principle | a two-branch contrast | `Node ─▶ TS ✓   Node ─▶ Go ✗ (adapter)` |

---

## Worked exemplar — copy this shape

This is the canonical output for one decision. New decisions mirror its structure and voice.

### Decision block

```markdown
### Why TypeScript for the agent-setup CLI — not bash, Go, or Python

**The deciding constraint.** Claude Code runs our hooks as Node, so hook code *must* be JavaScript
regardless. The only open question is the language for the rest of the CLI.

**The call, one line each:**
- **bash** ✗ — fine for gluing commands, bad at our real work (editing JSON, safe config merges, a
  menu, tests). No types, breaks across operating systems.
- **Go** ✗ *here* — superb for CLIs (one fast binary, no runtime), but our hooks are already JS, so
  it'd split the tool across two languages and ship outside `npx`.
- **Python** ✗ — great for data/ML, but needs its own interpreter shipped to every user.
- **TypeScript** ✓ — one language for CLI *and* hooks, ships with `npx`, types catch mistakes before
  release.

**Principle: substrate fit.** Match the language to the ground your code already runs on. Our ground
is Node, so TS = one language, one install, zero adapters.

**When each wins instead:** bash → a 20-line glue script · Go → a standalone perf-critical CLI with
no Node host · Python → real data/ML (that's the `ib-bot` project).
```

### Glossary block (self-closing — every term above, and every term used inside these, is here)

```markdown
- **terminal** — the text window where you type commands to your computer (Terminal, Ghostty…).
  `$ agent-setup install`
- **CLI (command-line interface)** — a tool you run by typing commands in a terminal.
  `$ agent-setup install image-to-code`
- **shell command** — one instruction typed in a terminal.
  `$ git status`
- **JavaScript (JS)** — the programming language of the web; also runs on servers via Node.
  `const name = "setup"; console.log(name); // -> setup`
- **JSON** — a plain-text format for structured data: keys and values.
  `{ "name": "setup", "features": ["image-to-code"] }`
- **structured data** — data in a defined shape (objects, lists), not free-form text.
  `{ name: "setup", features: [ "a", "b" ] }   // vs "setup,a,b"`
- **executable / binary** — a single file the computer runs directly, no extra tools.
  `$ ./agent-setup install`
- **Node (Node.js)** — the program that runs JavaScript outside a browser (laptop or server).
  [official: https://nodejs.org] `$ node app.js`
- **JS engine** — the part inside Node (or a browser) that reads and executes JavaScript.
  `"1 + 1" ─▶ engine parses ─▶ machine code ─▶ CPU ─▶ 2`
- **V8** — the specific JS engine Google built (used by Chrome and Node); turns JS into fast
  low-level code the computer runs directly. `$ node -e "console.log(1+1)" # V8 runs it -> 2`
- **npm** — Node's package manager: installs and publishes JS libraries.
  [official: https://docs.npmjs.com] `$ npm install commander`
- **npm package** — a bundle of JS code published to npm that others can install.
  `{ "name": "agent-setup", "bin": { "agent-setup": "dist/cli.js" } }`
- **npx** — "run a command from a local or remote npm package": fetch + run in one step.
  [official: https://docs.npmjs.com/cli/v11/commands/npx/] `$ npx prettier --check .`
- **runtime** — the engine a program needs *present* to run (Node for JS, the interpreter for
  Python). "Runtime install" = install that engine first:
  `$ node app.js   # works    |    $ python app.py   # fails first without a Python runtime`
- **interpreter** — a program that reads code and runs it line by line; Python needs one installed,
  JS/TS run on Node (usually already there).
  `print("a")   # runs now` / `print(1/0)   # error only surfaces HERE, at runtime`
- **compiles to one binary (Go)** — Go turns source into a single self-contained executable that
  runs with no runtime installed. `$ go build -o agent-setup && ./agent-setup`
- **pip** — Python's package installer (npm, but for Python). `$ pip install requests`
- **brew (Homebrew)** — the common macOS installer for programs. `$ brew install python`
- **hook** — "user-defined shell commands … that execute automatically at specific points in Claude
  Code's lifecycle". [official: https://code.claude.com/docs/en/hooks]
  `{ "hooks": { "PostToolUse": [{ "type": "command", "command": "biome check --write $FILE" }] } }`
- **lifecycle** — the ordered stages a program moves through as it runs.
  `SessionStart ─▶ PreToolUse ─▶ PostToolUse ─▶ Stop`
- **gluing (bash)** — bash's strength: chaining existing programs; a wiring language, not one for
  structured data. `cat urls.txt | grep https | sort -u > clean.txt`
- **substrate fit** — match the language to the ground your code already runs on, before debating
  syntax or speed. `host=Node ─▶ TS ✓ (same ground)   host=Node ─▶ Go ✗ (adapter needed)`
- **Node-hosted installer** — an install tool (like agent-setup) that itself runs on Node and ships
  through npm; a non-Node language is weaker for it because you'd bolt a second engine onto a
  Node-shaped ecosystem. `$ pnpm tsx src/cli/main.ts install   # runs on Node, no extra engine`
```

> **Dedup in action:** the *next* decision (say "why Biome not ESLint+Prettier") re-uses `Node`,
> `npm`, `runtime` — already defined above, so its glossary adds **only** the new terms (`linter`,
> `formatter`, `AST`…). The glossary never repeats itself; it only ever grows by what's new.
