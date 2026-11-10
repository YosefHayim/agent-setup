// The one config.json reader and writer behind the `config` command.

import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";

import { isNotFound } from "../install/file-bytes.js";
import { type InstallationDestination, receiptPath } from "../install/install-paths.js";
import { wrapAsInstallError } from "../install/install-request.js";
import { preparePackage } from "../install/prepare-package.js";
import { readReceipt, type Scope } from "../install/receipt.js";
import { update } from "../install/update.js";
import { managedConfigPath, planManagedConfig, readConfigFile } from "./config-file.js";
import { type Config, defaultConfig } from "./config-schema.js";
import { destinationForScope, type HostScan, scanHost } from "./host-scan.js";

type ConfigTarget = {
  readonly scope: Scope;
  readonly host: HostScan;
  readonly destination: InstallationDestination;
  readonly configPath: string;
};

type ConfigWrite = { readonly _tag: "selected"; readonly config: Config } | { readonly _tag: "reset" };

// Locates a scope's config.json without reading it, so a full reset still works when the file is unreadable.
export const resolveConfigTarget = (scope: Scope) =>
  Effect.gen(function* () {
    const host = yield* Effect.tryPromise({ try: () => scanHost(), catch: (error) => error });
    const path = yield* Path.Path;
    const destination = destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });
    return {
      scope,
      host,
      destination,
      configPath: path.join(destination.root, managedConfigPath),
    } satisfies ConfigTarget;
  });

// Hooks under `root` read its own config.json, else the global one that a first project install copies.
export const readConfigAt = (request: { readonly root: string; readonly homeRoot: string }) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const ownConfig = yield* Effect.tryPromise({
      try: () => readConfigFile(path.join(request.root, managedConfigPath)),
      catch: (error) => error,
    });
    if (ownConfig._tag === "present") {
      return ownConfig.config;
    }

    if (path.resolve(request.root) === path.resolve(request.homeRoot)) {
      return defaultConfig;
    }

    const globalConfig = yield* Effect.tryPromise({
      try: () => readConfigFile(path.join(request.homeRoot, managedConfigPath)),
      catch: (error) => error,
    });
    return globalConfig._tag === "present" ? globalConfig.config : defaultConfig;
  });

export const readConfig = (scope: Scope) =>
  Effect.gen(function* () {
    const target = yield* resolveConfigTarget(scope);
    const config = yield* readConfigAt({ root: target.destination.root, homeRoot: target.host.homeRoot });
    return { ...target, config };
  });

const readPreviousConfigFile = (configPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.readFile(configPath).pipe(
      Effect.map((bytes) => ({ _tag: "priorFile" as const, bytes })),
      Effect.catchIf(isNotFound, () => Effect.succeed({ _tag: "missing" as const })),
    );
  });

// An installed scope saves through `update` so the receipt keeps owning config.json; otherwise write the file directly.
export const saveConfig = (request: { readonly target: ConfigTarget; readonly configuration: ConfigWrite }) =>
  Effect.gen(function* () {
    const { target, configuration } = request;
    const path = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;
    const receiptSnapshot = yield* Effect.tryPromise({
      try: () => readReceipt(path.join(target.destination.root, receiptPath)),
      catch: wrapAsInstallError,
    });
    if (receiptSnapshot._tag === "present") {
      if (receiptSnapshot.receipt.scope !== target.scope) {
        return yield* Effect.fail(
          new Error(
            `Receipt scope is ${receiptSnapshot.receipt.scope}, not ${target.scope}; select the matching scope.`,
          ),
        );
      }

      yield* update({
        destination: target.destination,
        host: { homeRoot: target.host.homeRoot },
        preparedPackage: yield* Effect.tryPromise({ try: preparePackage, catch: (error) => error }),
        features: { _tag: "preserve" },
        agents: { _tag: "detected", evidence: target.host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration,
      });
      return "receipt" as const;
    }

    // The plan keeps the old bytes only as its restoration value and never decodes them, so a broken file is replaceable.
    const previousConfigFile = yield* readPreviousConfigFile(target.configPath);
    const plan = yield* Effect.try({
      try: () =>
        planManagedConfig({
          scope: target.scope,
          selection: {
            _tag: "selected",
            config: configuration._tag === "reset" ? defaultConfig : configuration.config,
          },
          previousConfigFile,
        }),
      catch: (error) => error,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.configPath), { recursive: true });
    yield* fileSystem.writeFile(target.configPath, plan.managedConfigWrite.bytes);
    return "file" as const;
  });
