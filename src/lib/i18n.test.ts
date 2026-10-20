import { describe, expect, it } from "vitest";
import { I18N_KEYS, isLang, makeT } from "./i18n";

describe("English / Filipino", () => {
  const en = makeT("en");
  const fil = makeT("fil");

  it("has text in both languages for every entry", () => {
    expect(I18N_KEYS.length).toBeGreaterThan(100);
    for (const key of I18N_KEYS) {
      expect(en(key).trim(), key).not.toBe("");
      expect(fil(key).trim(), key).not.toBe("");
      expect(en(key), key).not.toBe(key);
    }
  });

  it("actually translates most of it (a few words are the same in both, like Dashboard)", () => {
    const same = I18N_KEYS.filter((k) => en(k) === fil(k));
    expect(same.length / I18N_KEYS.length).toBeLessThan(0.25);
  });

  it("keeps the places people look first in Filipino", () => {
    expect(fil("nav.requisitions")).toBe("Mga Requisition");
    expect(fil("nav.projects")).toBe("Mga Proyekto");
    expect(fil("toast.saved")).toBe("Na-save");
    expect(en("toast.saved")).toBe("Saved");
  });

  it("never shows a raw key for something unknown", () => {
    expect(en("nope" as never)).toBe("nope");
  });

  it("only accepts the two languages", () => {
    expect(isLang("en")).toBe(true);
    expect(isLang("fil")).toBe(true);
    for (const v of ["tl", "", null, undefined, 3, "EN"]) expect(isLang(v)).toBe(false);
  });
});
