import { describe, expect, it } from "vitest";

import {
  defaultConfig,
  encodeSettingsDocument,
  readDefaultSettingField,
  readSettingFieldFromString,
  setSettingField,
  settingList,
  settingsSchema,
} from "./config-schema.js";

const DEFAULT_ROOT_FOLDERS = ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"];

const decodeSettings = (details: unknown) => settingsSchema.parse(details);

const readSettingNamed = (name: string) => {
  const setting = settingList.find((candidate) => candidate.name === name);

  const isSettingMissing = setting == null;
  if (isSettingMissing) {
    throw new Error(`Expected a ${name} setting.`);
  }

  return setting;
};

describe("configSchema", () => {
  it("decodes the complete executable defaults", () => {
    expect(decodeSettings({})).toEqual({
      sessionRehomeRoots: DEFAULT_ROOT_FOLDERS,
      diskCleanupRoots: DEFAULT_ROOT_FOLDERS,
      debugLogs: false,
    });
    expect(defaultConfig).toEqual(decodeSettings({}));
  });

  it("keeps a label and a description on every setting", () => {
    for (const setting of settingList) {
      expect(setting.label).not.toBe(setting.key);
      expect(setting.description).not.toBe("");
    }
  });

  it("derives kebab-case CLI names and value kinds from the schema keys", () => {
    expect(settingList.map((setting) => setting.name)).toContain("session-rehome-roots");
    expect(readSettingNamed("debug-logs").kind).toBe("boolean");
    expect(readSettingNamed("session-rehome-roots").kind).toBe("list");
    expect(readSettingNamed("disk-cleanup-roots").kind).toBe("list");
  });

  it("fills omitted properties but rejects excess properties", () => {
    expect(decodeSettings({ debugLogs: true })).toEqual({
      ...defaultConfig,
      debugLogs: true,
    });
    expect(() => decodeSettings({ unknownProperty: true })).toThrow();
  });

  it.each(settingList.map((setting) => setting.key))("rejects explicit undefined for %s", (property) => {
    expect(() => decodeSettings({ [property]: undefined })).toThrow();
  });

  it("accepts a list of root folders", () => {
    expect(decodeSettings({ diskCleanupRoots: ["Work", "Clients"] })).toMatchObject({
      diskCleanupRoots: ["Work", "Clients"],
    });
  });

  it("rejects an empty root folder", () => {
    expect(() => decodeSettings({ diskCleanupRoots: [""] })).toThrow();
  });
});

describe("setting values from CLI text", () => {
  const applyTypedAnswer = (settingName: string, typedAnswer: string) =>
    setSettingField({
      config: defaultConfig,
      key: readSettingNamed(settingName).key,
      value: readSettingFieldFromString({ setting: readSettingNamed(settingName), text: typedAnswer }),
    });

  it("parses booleans and comma lists by the setting's kind", () => {
    expect(applyTypedAnswer("debug-logs", "true").debugLogs).toBe(true);
    expect(applyTypedAnswer("session-rehome-roots", "vendor, generated ,, tmp").sessionRehomeRoots).toEqual([
      "vendor",
      "generated",
      "tmp",
    ]);
  });

  it("reads a setting's schema default", () => {
    expect(readDefaultSettingField("debugLogs")).toBe(false);
  });

  it("rejects text the setting cannot hold", () => {
    expect(() => applyTypedAnswer("debug-logs", "sometimes")).toThrow();
  });
});

describe("encodeConfigJson", () => {
  it("encodes every owned property into JSON", () => {
    const document = encodeSettingsDocument(defaultConfig);
    expect(JSON.parse(document)).toEqual(defaultConfig);
    expect(Object.keys(JSON.parse(document))).toHaveLength(3);
  });
});
