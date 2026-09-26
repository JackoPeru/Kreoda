import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { en } from "../src/i18n/en";
import { it as itDict } from "../src/i18n/it";
import { getLocale, setLocale, t, featureTypeName, sketchKindName } from "../src/i18n";
import { CommandBar } from "../src/components/CommandBar";
import { parseCommand, describeStep } from "../src/intent/parse";

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("i18n dictionaries (§i18n)", () => {
  it("italian covers every english key with a non-empty string", () => {
    const missing = (Object.keys(en) as (keyof typeof en)[]).filter(
      (k) => typeof itDict[k] !== "string" || itDict[k].trim().length === 0,
    );
    expect(missing).toEqual([]);
  });

  it("interpolates {vars} and falls back to the key for unknowns", () => {
    setLocale("en");
    expect(t("chip.items", { n: 3 })).toBe("3 items");
    expect(t("common.save")).toBe("Save");
    expect(
      t("unknown.key" as unknown as keyof typeof en),
    ).toBe("unknown.key");
  });

  it("switches to italian and back", () => {
    act(() => setLocale("it"));
    expect(getLocale()).toBe("it");
    expect(t("common.save")).toBe("Salva");
    expect(t("chip.items", { n: 3 })).toBe("3 elementi");
    act(() => setLocale("en"));
    expect(t("common.save")).toBe("Save");
  });

  it("re-renders UI in italian and switches back live", () => {    render(<CommandBar />);
    expect(
      screen.getByPlaceholderText(/What do you want to do/),
    ).toBeTruthy();
    act(() => setLocale("it"));
    expect(screen.getByPlaceholderText(/Cosa vuoi fare/)).toBeTruthy();
    // Language selector lives in the settings popup.
    fireEvent.click(screen.getByText("⚙"));
    const select = screen.getByTestId("locale-select") as HTMLSelectElement;
    expect(select.value).toBe("it");
    fireEvent.change(select, { target: { value: "en" } });
    expect(screen.getByPlaceholderText(/What do you want to do/)).toBeTruthy();
  });

  it("translates feature type and constraint kind names", () => {
    setLocale("it");
    expect(featureTypeName("Box")).toBe("Scatola");
    expect(featureTypeName("HolePattern")).toBe("Serie di fori");
    expect(featureTypeName("Whatever")).toBe("Whatever");
    expect(sketchKindName("horizontal")).toBe("orizzontale");
    expect(sketchKindName("nope")).toBe("nope");
    setLocale("en");
    expect(featureTypeName("Box")).toBe("Box");
  });

  it("parses italian command aliases (english still works)", () => {
    setLocale("it");
    const ok = (text: string) => {
      const r = parseCommand(text);
      if (!r.ok) throw new Error(`should parse ${text}: ${r.message}`);
      return r.plan;
    };
    expect(ok("scatola 100 50 20").steps[0]!.command).toBe("CreateBox");
    expect(ok("cilindro 20 60").steps[0]!.command).toBe("CreateCylinder");
    expect(ok("sfera 25").steps[0]!.command).toBe("CreateSphere");
    expect(ok("fori 6 4 angoli 8").steps[0]).toMatchObject({
      command: "CreateHolesCorners",
      params: { diameterMm: 6, count: 4, insetMm: 8 },
    });
    expect(ok("foro 8 cieco 5").steps[0]).toMatchObject({
      command: "CreateHole",
      params: { diameterMm: 8, depthMode: "blind", depthMm: 5 },
    });
    expect(ok("raccordo 3").steps[0]!.command).toBe("CreateFillet");
    expect(ok("smusso 2").steps[0]!.command).toBe("CreateChamfer");
    expect(ok("imposta widthMm 150").steps[0]!.command).toBe("SetDimension");
    expect(ok("annulla").steps[0]!.command).toBe("Undo");
    expect(ok("ripeti").steps[0]!.command).toBe("Redo");
    expect(ok("vista fronte").steps[0]).toMatchObject({
      command: "View",
      params: { name: "front" },
    });
    expect(ok("aiuto").steps[0]!.command).toBe("Help");
    // View preview shows the localized view name.
    expect(describeStep(ok("vista fronte").steps[0]!)).toBe("Vista: Vista frontale");
    // English still parses under the italian locale.
    expect(ok("box 100 50 20").steps[0]!.command).toBe("CreateBox");
    setLocale("en");
    expect(describeStep(ok("view front").steps[0]!)).toBe("View: Front view");
  });
});
