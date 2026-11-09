/** Plan roots and target paths: resolve the real root once and refuse any target a symlink could redirect outside it. */

import { FileSystem, Path } from "@effect/platform";
import { BadArgument } from "@effect/platform/Error";
import { Effect, Option } from "effect";

import { isNotFound } from "./file-bytes.js";
import { isInsideFolder } from "./recovery.js";

const realPathError = (description: string) =>
  new BadArgument({ module: "FileSystem", method: "realPath", description });

export const validatePlanRoot = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const normalizedRoot = path.normalize(root);
    if (!path.isAbsolute(root) || path.resolve(root) !== normalizedRoot) {
      return yield* realPathError(`Plan root ${root} is not a fully qualified canonical path on this host.`);
    }

    const realRoot = yield* fileSystem.realPath(normalizedRoot);
    const entry = yield* fileSystem.stat(realRoot);
    if (entry.type !== "Directory") {
      return yield* realPathError(`Plan root ${root} is not a directory.`);
    }

    return realRoot;
  });

const validateExistingEntry = (entry: { root: string; targetPath: string; existingPath: string; realPath: string }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const expectedRealPath = path.resolve(entry.root, path.relative(entry.root, entry.existingPath));
    const stat = yield* fileSystem.stat(entry.existingPath);
    const expectedType = entry.existingPath === entry.targetPath ? "File" : "Directory";
    if (entry.realPath !== expectedRealPath || stat.type !== expectedType) {
      return yield* realPathError(
        `Transaction target ${entry.targetPath} has a symlinked or non-file path component at ${entry.existingPath}.`,
      );
    }
  });

// Resolves the nearest existing path so a symlinked ancestor cannot redirect a later write outside the root.
export const validateTarget = (root: string, targetPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if ((yield* fileSystem.realPath(root)) !== root || !isInsideFolder(root, targetPath)) {
      return yield* realPathError(`Transaction target ${targetPath} is outside its captured installation root.`);
    }

    let existingPath = targetPath;
    while (true) {
      const realPath = yield* fileSystem.realPath(existingPath).pipe(
        Effect.map(Option.some),
        Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
      );
      if (Option.isSome(realPath)) {
        return yield* validateExistingEntry({ root, targetPath, existingPath, realPath: realPath.value });
      }

      const parent = path.dirname(existingPath);
      if (parent === existingPath) {
        return yield* realPathError(`Transaction target ${targetPath} is outside installation root ${root}.`);
      }

      existingPath = parent;
    }
  });

// Directories between the root and the target, outermost first; empty when the target is not below the root.
export const parentDirectories = (root: string, targetPath: string) =>
  Effect.map(Path.Path, (path) => {
    const directories: Array<string> = [];
    let directory = path.dirname(targetPath);
    while (directory !== root) {
      const relativeDirectory = path.relative(root, directory);
      if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) {
        return [];
      }

      directories.push(directory);
      const parent = path.dirname(directory);
      if (parent === directory) {
        return [];
      }

      directory = parent;
    }

    return directories.reverse();
  });
