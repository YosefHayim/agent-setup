import { describe, expect, it } from "vitest";

import { killTargetsIn } from "./killTargets.js";

describe("killTargetsIn", () => {
  it("reads the quoted pattern and -f of the pkill that crashed the sessions", () => {
    const killTargets = killTargetsIn('pkill -f "cat" 2>/dev/null; cd /repo && git status --short');

    expect(killTargets).toEqual([
      {
        commandWords: "pkill -f cat",
        patterns: ["cat"],
        matchesFullCommand: true,
        ignoresCase: false,
        matchesWholeText: false,
        inverted: false,
      },
    ]);
  });

  it("skips signals and option values, and reads combined flags", () => {
    const [killTarget] = killTargetsIn("sudo /usr/bin/pkill -9 -u root -fix 'node .*server'");

    expect(killTarget).toMatchObject({
      patterns: ["node .*server"],
      matchesFullCommand: true,
      ignoresCase: true,
      matchesWholeText: true,
    });
  });

  it("reads killall names as exact text and killall -m as a regular expression", () => {
    const [exactName, regex] = killTargetsIn("killall -9 Google.Chrome; killall -m 'Chrome.*'");

    expect(exactName).toMatchObject({ patterns: ["Google\\.Chrome"], matchesWholeText: true });
    expect(regex).toMatchObject({ patterns: ["Chrome.*"], matchesWholeText: false });
  });

  it("judges pgrep only when its pids feed a kill", () => {
    expect(killTargetsIn("kill $(pgrep -f vite)")).toHaveLength(1);
    expect(killTargetsIn("pgrep -f vite | xargs kill -9")).toHaveLength(1);
    expect(killTargetsIn("pgrep -fl vite")).toEqual([]);
    expect(killTargetsIn("pgrep -fl vite; kill 4242")).toEqual([]);
    expect(killTargetsIn("pids=$(pgrep -f vite); kill $pids")).toHaveLength(1);
    expect(killTargetsIn("pgrep -fl cat; kill $SERVER_PID")).toEqual([]);
    expect(killTargetsIn("# kill the old server\npgrep -fl vite")).toEqual([]);
  });

  it("reads Linux long options like their short forms", () => {
    const [killTarget] = killTargetsIn("pkill --signal KILL --euid root --full --ignore-case cat");

    expect(killTarget).toMatchObject({ patterns: ["cat"], matchesFullCommand: true, ignoresCase: true });
  });

  it("judges a shell value in the pattern as matching any text", () => {
    const [regex, exactName] = killTargetsIn('PATTERN=cat; pkill -f "$PATTERN-server"; killall "$APP.app"');

    expect(regex).toMatchObject({ commandWords: "pkill -f $...-server", patterns: [".*-server"] });
    expect(exactName).toMatchObject({ patterns: [".*\\.app"], matchesWholeText: true });
  });

  it("reads kills inside bash -c, zsh -lc, and eval", () => {
    const killTargets = killTargetsIn(`bash -c 'pkill -f cat' && zsh -lc "killall Dock"; eval "pkill -f $P"`);

    expect(killTargets.map((killTarget) => killTarget.patterns)).toEqual([["cat"], ["Dock"], [".*"]]);
  });

  it("ignores a kill without a pattern and text that only mentions pkill", () => {
    expect(killTargetsIn("pkill -P 4242")).toEqual([]);
    expect(killTargetsIn('git commit -m "stop running pkill -f cat"')).toEqual([]);
  });
});
