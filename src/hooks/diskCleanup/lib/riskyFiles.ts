import path from "node:path";

import { escapeForPattern } from "../../lib/patternEscape.js";

// Environment files, keys, certificates, and SSH identities, e.g. server.pem, signing.p12, id_ed25519. Names match in
// any case, so Server.PEM counts too.
export const SECRET_FILE_GLOBS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "*.jks",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
  "id_dsa*",
];
const SHAREABLE_ENV_FILE = /^\.env\.(?:example|sample|template)$/iu;
// GitHub refuses files over 100 MB; one this big is a build or a download, not work.
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;
// Every file an unpushed commit adds or changes; a deleted one has nothing left to push.
export const COMMITTED_FILE_FORMAT = ["--format=", "--name-only", "--diff-filter=d"];

const globPattern = (glob: string): RegExp => {
  const literalParts = glob.split("*").map(escapeForPattern);
  return new RegExp(`^${literalParts.join(".*")}$`, "iu");
};

const SECRET_FILE_PATTERNS = SECRET_FILE_GLOBS.map(globPattern);

export const isSecretFile = (relativePath: string): boolean => {
  const fileName = path.basename(relativePath);
  const looksSecret = SECRET_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
  return looksSecret && !SHAREABLE_ENV_FILE.test(fileName);
};

// A pushed secret cannot be taken back, and a file git had to quote has a name too odd to check.
export const hasRiskyName = (relativePath: string): boolean =>
  relativePath.startsWith('"') || isSecretFile(relativePath);
