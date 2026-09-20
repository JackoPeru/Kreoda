// @intentcad/units — canonical units (§43): mm internal, rad angles.
// Never infer from locale. All IPC numerics carry explicit units.

export type LengthUnit = "mm" | "cm" | "m" | "inch";
export type AngleUnit = "rad" | "deg";

const TO_MM: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  inch: 25.4,
};

export function toMm(value: number, unit: LengthUnit): number {
  return value * TO_MM[unit];
}

export function fromMm(valueMm: number, unit: LengthUnit): number {
  return valueMm / TO_MM[unit];
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Parse "125", "125 mm", "12.5 cm", "2 in" → mm. Throws on invalid. */
export function parseLengthToMm(input: string): number {
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|inch|in)?$/i);
  if (!m) throw new Error(`invalid length: ${input}`);
  const value = Number(m[1]);
  const unit = (m[2]?.toLowerCase() === "in" ? "inch" : (m[2]?.toLowerCase() ?? "mm")) as LengthUnit;
  return toMm(value, unit);
}

/** Parse "90", "90 deg", "1.57 rad" → canonical degrees number. */
export function parseAngleToDeg(input: string): number {
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*(deg|rad)?$/i);
  if (!m) throw new Error(`invalid angle: ${input}`);
  const value = Number(m[1]);
  const unit = (m[2]?.toLowerCase() ?? "deg") as AngleUnit;
  return unit === "rad" ? radToDeg(value) : value;
}
