import { describe, expect, it } from "vitest";

import {
  configSchema,
  configSettings,
  defaultConfig,
  defaultSettingValue,
  encodeConfigJson,
  settingValueFromText,
  withSettingValue,
} from "./config-schema.js";

const DEFAULT_ROOT_FOLDERS = ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"];

const decodeConfig = (input: unknown) => configSchema.parse(input);

const settingNamed = (name: string) => {
  const setting = configSettings.find((candidate) => candidate.name === name);
  if (setting === undefined) {
    throw new Error(`Expected a ${name} setting.`);
  }
  return setting;
};

describe("configSchema", () => {
  it("decodes the complete executable defaults", () => {
    expect(decodeConfig({})).toEqual({
      sessionRehomeRoots: DEFAULT_ROOT_FOLDERS,
      diskCleanupRoots: DEFAULT_ROOT_FOLDERS,
      debugLogs: false,
    });
    expect(defaultConfig).toEqual(decodeConfig({}));
  });

  it("keeps a label and a description on every setting", () => {
    for (const setting of configSettings) {
      expect(setting.label).not.toBe(setting.key);
      expect(setting.description).not.toBe("");
    }
  });

  it("derives kebab-case CLI names and value kinds from the schema keys", () => {
    expect(configSettings.map((setting) => setting.name)).toContain("session-rehome-roots");
    expect(settingNamed("debug-logs").kind).toBe("boolean");
    expect(settingNamed("session-rehome-roots").kind).toBe("list");
    expect(settingNamed("disk-cleanup-roots").kind).toBe("list");
  });

  it("fills omitted properties but rejects excess properties", () => {
    expect(decodeConfig({ debugLogs: true })).toEqual({
      ...defaultConfig,
      debugLogs: true,
    });
    expect(() => decodeConfig({ unknownProperty: true })).toThrow();
  });

  it.each(configSettings.map((setting) => setting.key))("rejects explicit undefined for %s", (property) => {
    expect(() => decodeConfig({ [property]: undefined })).toThrow();
  });

  it("accepts a list of root folders", () => {
    expect(decodeConfig({ diskCleanupRoots: ["Work", "Clients"] })).toMatchObject({
      diskCleanupRoots: ["Work", "Clients"],
    });
  });

  it("rejects an empty root folder", () => {
    expect(() => decodeConfig({ diskCleanupRoots: [""] })).toThrow();
  });
});

describe("setting values from CLI text", () => {
  const applyText = (name: string, text: string) =>
    withSettingValue({
      config: defaultConfig,
      key: settingNamed(name).key,
      value: settingValueFromText({ setting: settingNamed(name), text }),
    });

  it("parses booleans and comma lists by the setting's kind", () => {
    expect(applyText("debug-logs", "true").debugLogs).toBe(true);
    expect(applyText("session-rehome-roots", "vendor, generated ,, tmp").sessionRehomeRoots).toEqual([
      "vendor",
      "generated",
      "tmp",
    ]);
  });

  it("reads a setting's schema default", () => {
    expect(defaultSettingValue("debugLogs")).toBe(false);
  });

  it("rejects text the setting cannot hold", () => {
    expect(() => applyText("debug-logs", "sometimes")).toThrow();
  });
});

describe("encodeConfigJson", () => {
  it("encodes every owned property into JSON", () => {
    const json = encodeConfigJson(defaultConfig);
    expect(JSON.parse(json)).toEqual(defaultConfig);
    expect(Object.keys(JSON.parse(json))).toHaveLength(3);
  });
});
