import { expect, it } from "vitest";
import { commandNativeRequest, validateLegacyNativeCommand } from "./native-command.js";
import { commandJsonSchema } from "./index.js";

it("allows explicit Base activation while preserving strict named configuration definitions", () => {
  expect(commandNativeRequest("ActivateConfiguration", { name: "" }))
    .toEqual({ type: 41, fields: { name: "" } });
  expect(validateLegacyNativeCommand(41, { name: "" }))
    .toEqual({ type: 41, fields: { name: "" } });
  expect(commandJsonSchema("ActivateConfiguration")?.parameters)
    .toMatchObject({ properties: { name: { type: "string", maxLength: 64 } } });
  expect(() => commandNativeRequest("ActivateConfiguration", { name: "unrelated", extra: true })).toThrow();
  expect(() => commandNativeRequest("DefineConfiguration", { name: "", overrides: { box: { widthMm: 10 } } })).toThrow();
});
