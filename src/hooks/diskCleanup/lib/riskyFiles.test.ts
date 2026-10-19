import { describe, expect, it } from "vitest";

import { isSecretFile } from "./riskyFiles.js";

describe("isSecretFile", () => {
  it.each([
    "server.pem",
    "certs/Server.PEM",
    "Signing.P12",
    "ID_RSA",
    ".env",
    ".ENV.local",
    ".env.EXAMPLE",
  ])("counts %s as a secret", (relativePath) => {
    expect(isSecretFile(relativePath)).toBe(true);
  });

  it.each([
    "routes.ts",
    ".env.example",
    "config/.env.template",
    "keys.pem.md",
  ])("does not count %s as a secret", (relativePath) => {
    expect(isSecretFile(relativePath)).toBe(false);
  });
});
