import { describe, expect, it } from "vitest";

import { decideRehome, isDeletedReposDominate, scoreSession } from "./rehome-decision.js";

const readEvidenceWith = (request: {
  readonly paths?: Record<string, number>;
  readonly prompts?: Record<string, number>;
}) => ({
  pathHits: new Map(Object.entries(request.paths || {})),
  promptHits: new Map(Object.entries(request.prompts || {})),
  firstPrompt: "",
});

describe("rehome decision", () => {
  it("moves a session started in a generic folder when one repo owns most of its work", () => {
    const scores = scoreSession({
      evidence: readEvidenceWith({ paths: { vybekiit: 80, replybase: 10 } }),
      folderRepoName: null,
    });

    expect(decideRehome({ scores, homeRepoName: undefined })).toEqual({
      _tag: "move",
      repoName: "vybekiit",
      share: 80 / 90,
    });
  });

  it("keeps a cross-repo session uncertain instead of guessing", () => {
    const scores = scoreSession({
      evidence: readEvidenceWith({ paths: { "agent-setup": 50, replybase: 30, vybekiit: 20 } }),
      folderRepoName: null,
    });

    expect(decideRehome({ scores, homeRepoName: undefined })._tag).toBe("uncertain");
  });

  it("treats a session with too few signals as uncertain even when one repo has all of them", () => {
    const scores = scoreSession({
      evidence: readEvidenceWith({ prompts: { vybekiit: 1 } }),
      folderRepoName: null,
    });

    expect(decideRehome({ scores, homeRepoName: undefined })._tag).toBe("uncertain");
  });

  it("moves a short session from a generic folder once a prompt and a file both name one repo", () => {
    const scores = scoreSession({
      evidence: readEvidenceWith({ prompts: { vybekiit: 1 }, paths: { vybekiit: 2 } }),
      folderRepoName: null,
    });

    expect(decideRehome({ scores, homeRepoName: undefined })).toMatchObject({ _tag: "move", repoName: "vybekiit" });
  });

  it("does not move a short session that only names a repo in prompts and never touches it", () => {
    const scores = scoreSession({
      evidence: readEvidenceWith({ prompts: { extensions: 2 } }),
      folderRepoName: null,
    });

    expect(decideRehome({ scores, homeRepoName: undefined })._tag).toBe("uncertain");
  });

  it("keeps the same short session in the repo it started in", () => {
    const scores = scoreSession({
      evidence: readEvidenceWith({ prompts: { vybekiit: 1 }, paths: { vybekiit: 2 } }),
      folderRepoName: null,
    });

    expect(decideRehome({ scores, homeRepoName: "replybase" })).toEqual({ _tag: "stay", repoName: "replybase" });
  });

  it("reports no signal when nothing in the session names a repo", () => {
    const scores = scoreSession({ evidence: readEvidenceWith({}), folderRepoName: null });

    expect(decideRehome({ scores, homeRepoName: undefined })).toEqual({ _tag: "noSignal" });
  });

  it("keeps a session in its own repo unless another repo clearly dominates", () => {
    const mostlyElsewhere = scoreSession({
      evidence: readEvidenceWith({ paths: { replybase: 70, vybekiit: 30 } }),
      folderRepoName: null,
    });
    const almostAllElsewhere = scoreSession({
      evidence: readEvidenceWith({ paths: { replybase: 95, vybekiit: 5 } }),
      folderRepoName: null,
    });

    expect(decideRehome({ scores: mostlyElsewhere, homeRepoName: "vybekiit" })).toEqual({
      _tag: "stay",
      repoName: "vybekiit",
    });
    expect(decideRehome({ scores: almostAllElsewhere, homeRepoName: "vybekiit" })._tag).toBe("move");
  });

  it("weighs prompts above single paths and a repo-named launch folder above both", () => {
    const scores = scoreSession({
      evidence: readEvidenceWith({ paths: { replybase: 12 }, prompts: { vybekiit: 1 } }),
      folderRepoName: "vybekiit",
    });

    expect(scores[0]).toMatchObject({ repoName: "vybekiit", score: 13 });
  });

  it("counts repos named for deletion together", () => {
    const scores = scoreSession({
      evidence: readEvidenceWith({ paths: { aria: 40, "extension-installer": 35, "agent-setup": 25 } }),
      folderRepoName: null,
    });

    expect(isDeletedReposDominate({ scores, deletedRepoNames: new Set(["aria", "extension-installer"]) })).toBe(true);
    expect(isDeletedReposDominate({ scores, deletedRepoNames: new Set(["aria"]) })).toBe(false);
  });
});
