import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { gitAnswerLines, gitFindsNothing } from "../git-answers.js";

// A repository can tell git status to skip its submodules ("ignore = all" in .gitmodules) or its new files
// ("status.showUntrackedFiles = no"); the flags ask anyway.
const UNCOMMITTED_CHANGE_QUERY = ["status", "--porcelain", "--ignore-submodules=none", "--untracked-files=normal"];
// A submodule's repository names its work tree, and git refuses to run when that folder is gone; --work-tree makes
// git stop looking for it. No question about commits or tags needs a work tree.
const ANY_WORK_TREE = "--work-tree=.";
// --all covers every branch, every tag, the stash, and the HEAD of each linked worktree.
const UNPUSHED_COMMIT_QUERY = [ANY_WORK_TREE, "log", "--all", "--not", "--remotes", "--max-count=1", "--format=%H"];
const UNPUSHED_COMMIT_QUERY_PAST_TAGS = [
  ANY_WORK_TREE,
  "log",
  "--exclude=refs/tags/*",
  "--all",
  "--not",
  "--remotes",
  "--max-count=1",
  "--format=%H",
];
const LOCAL_TAG_QUERY = [ANY_WORK_TREE, "for-each-ref", "--format=%(objectname)", "refs/tags"];
const REMOTE_NAME_QUERY = [ANY_WORK_TREE, "remote"];
// Each line is "<object>\t<tag>"; --refs leaves out the second line an annotated tag gets for its commit. The remote's
// name follows "--", so that git never reads one as an option.
const REMOTE_TAG_QUERY = [ANY_WORK_TREE, "ls-remote", "--tags", "--refs", "--"];
// GitHub mostly answers within 3 seconds and has taken 43 on a busy machine. A remote that is slower than this keeps
// the clone until the next cleanup asks again.
const REMOTE_ANSWER_TIMEOUT_MILLISECONDS = 30_000;
// A linked worktree keeps its branches and tags in its main repository, so only commits that none of them holds
// would go with it.
const DETACHED_COMMIT_QUERY = [
  "log",
  "HEAD",
  "--not",
  "--branches",
  "--tags",
  "--remotes",
  "--max-count=1",
  "--format=%H",
];
// A clone's git folder is its own .git; a linked worktree's is inside its main repository, e.g. .git/worktrees/feature.
const GIT_FOLDER_QUERY = ["rev-parse", "--absolute-git-dir"];

// " D file": a tracked file that is only missing from the work tree, with nothing staged. A delete that was cut off
// halfway leaves a clone full of these, and no content is lost with them: git already has every such file.
const MISSING_TRACKED_FILE = /^ D /u;

const subfoldersOf = (folder: string): ReadonlyArray<string> =>
  readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(folder, entry.name));

// A submodule keeps its repository inside its parent's git folder, e.g. .git/modules/vendor/library, and a nested
// submodule under that repository's own modules folder. The parent's log does not see these commits.
const submoduleRepositoriesIn = (folder: string): ReadonlyArray<string> => {
  if (!existsSync(folder)) {
    return [];
  }

  if (existsSync(path.join(folder, "HEAD")) && existsSync(path.join(folder, "objects"))) {
    return [folder, ...submoduleRepositoriesIn(path.join(folder, "modules"))];
  }

  return subfoldersOf(folder).flatMap(submoduleRepositoriesIn);
};

// The tag objects a repository has in common with its remotes: every commit under one of them is kept there.
const tagObjectsOnRemotes = (repository: string): ReadonlyArray<string> => {
  const localTagObjects = gitAnswerLines({ folder: repository, query: LOCAL_TAG_QUERY }) || [];
  if (localTagObjects.length === 0) {
    return [];
  }

  const remoteNames = gitAnswerLines({ folder: repository, query: REMOTE_NAME_QUERY }) || [];
  const remoteTagObjects = remoteNames
    .flatMap((remoteName) => {
      const remoteTagQuery = [...REMOTE_TAG_QUERY, remoteName];
      const timeoutMilliseconds = REMOTE_ANSWER_TIMEOUT_MILLISECONDS;
      return gitAnswerLines({ folder: repository, query: remoteTagQuery, timeoutMilliseconds }) || [];
    })
    .flatMap((remoteTagLine) => remoteTagLine.split("\t").slice(0, 1));
  const objectsOnRemotes = new Set(remoteTagObjects);
  return localTagObjects.filter((tagObject) => objectsOnRemotes.has(tagObject));
};

// A clone copies every tag of its remote, also one on commits that no remote branch holds, e.g. the tag of a deleted
// release branch. Only the remote can tell such a tag from one made here, so it is asked, and only when a tag is all
// that still holds a commit.
const commitsKeptOnRemotes = (repository: string): boolean => {
  if (gitFindsNothing({ folder: repository, query: UNPUSHED_COMMIT_QUERY })) {
    return true;
  }

  if (!gitFindsNothing({ folder: repository, query: UNPUSHED_COMMIT_QUERY_PAST_TAGS })) {
    return false;
  }

  const tagObjects = tagObjectsOnRemotes(repository);
  const queryPastRemoteTags = [...UNPUSHED_COMMIT_QUERY, ...tagObjects];
  return tagObjects.length > 0 && gitFindsNothing({ folder: repository, query: queryPastRemoteTags });
};

const everythingCommittedIn = (workTree: string): boolean =>
  gitFindsNothing({ folder: workTree, query: UNCOMMITTED_CHANGE_QUERY, ignoredLine: MISSING_TRACKED_FILE });

const holdsUnsavedWork = (workTree: string): boolean => {
  const [gitFolder] = gitAnswerLines({ folder: workTree, query: GIT_FOLDER_QUERY }) || [];
  if (!gitFolder || !everythingCommittedIn(workTree)) {
    return true;
  }

  const standaloneClone = statSync(path.join(workTree, ".git")).isDirectory();
  const commitsKeptElsewhere = standaloneClone
    ? commitsKeptOnRemotes(workTree)
    : gitFindsNothing({ folder: workTree, query: DETACHED_COMMIT_QUERY });
  if (!commitsKeptElsewhere) {
    return true;
  }

  // A linked worktree keeps its submodules in its own git folder, and a clone holds the git folders of its linked
  // worktrees under .git/worktrees/<name>.
  const submoduleRepositories = ["modules", "worktrees"].flatMap((name) => {
    const submoduleParent = path.join(gitFolder, name);
    return submoduleRepositoriesIn(submoduleParent);
  });
  if (!submoduleRepositories.every(commitsKeptOnRemotes)) {
    return true;
  }

  // A remote can take long to answer, and a file written here in that time is work too.
  return !everythingCommittedIn(workTree);
};

const isWorkTree = (folder: string): boolean => existsSync(path.join(folder, ".git"));

const workTreesIn = (folder: string): ReadonlyArray<string> => {
  if (isWorkTree(folder)) {
    return [folder];
  }

  return subfoldersOf(folder).flatMap(workTreesIn);
};

// A work tree can hold another one that its own git status does not show, e.g. a linked worktree in an ignored
// .worktrees folder. Its .git folder holds none.
const workTreesInside = (workTree: string): ReadonlyArray<string> =>
  subfoldersOf(workTree)
    .filter((subfolder) => path.basename(subfolder) !== ".git")
    .flatMap((subfolder) => {
      const deeperWorkTrees = workTreesInside(subfolder);
      return isWorkTree(subfolder) ? [subfolder, ...deeperWorkTrees] : deeperWorkTrees;
    });

// Unsaved work in a nested work tree keeps the outer one whole, since the nested one may live off its repository.
const holdsUnsavedWorkAtAnyDepth = (workTree: string): boolean =>
  holdsUnsavedWork(workTree) || workTreesInside(workTree).some(holdsUnsavedWork);

// Agents sometimes work on a repo from a clone or worktree inside a scratch folder. One with changes that are not
// committed, or with commits that exist nowhere else, holds work that deleting the folder would erase.
export const unsavedWorkTrees = (folder: string): ReadonlyArray<string> =>
  workTreesIn(folder).filter(holdsUnsavedWorkAtAnyDepth);
