import { expect, it } from "vitest";
import { composer } from "../config";
it("keeps trusted Content policy outside serialized browser settings", () => {
  const contentValidation = { module: "host/policy", id: "host", version: "1" };
  const config = composer({ pack: "host/pack", contentValidation });
  expect(config.contentValidation).toEqual(contentValidation);
  expect(config.settings).not.toHaveProperty("contentValidation");
  for (const value of [{ ...contentValidation, module: "./policy" }, { ...contentValidation, id: "" }, { ...contentValidation, extra: true }, [], null]) expect(() => composer({ pack: "host/pack", contentValidation: value as never })).toThrow();
});
