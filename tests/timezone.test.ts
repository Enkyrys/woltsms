import { describe, it, expect } from "vitest";
import { parseTurkeyDateTime, providerSchedule, formatInZone, zoneOffsetMinutes } from "../src/lib/timezone";

describe("Türkiye saati girişi → UTC", () => {
  it("saat dilimsiz değer Türkiye saati kabul edilir (UTC+3)", () => {
    expect(parseTurkeyDateTime("2026-11-05T14:30")).toBe("2026-11-05T11:30:00.000Z");
  });
  it("boşluklu ve saniyeli biçim", () => {
    expect(parseTurkeyDateTime("2026-07-01 00:00:15")).toBe("2026-06-30T21:00:15.000Z");
  });
  it("açık saat dilimli değer olduğu gibi yorumlanır", () => {
    expect(parseTurkeyDateTime("2026-11-05T14:30:00Z")).toBe("2026-11-05T14:30:00.000Z");
    expect(parseTurkeyDateTime("2026-11-05T14:30:00+03:00")).toBe("2026-11-05T11:30:00.000Z");
  });
  it("geçersiz değer null", () => {
    expect(parseTurkeyDateTime("yarın")).toBeNull();
    expect(parseTurkeyDateTime("")).toBeNull();
  });
});

describe("sağlayıcıya İngiltere saati (Europe/London)", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("kış (GMT): TR 14:30 → UK 11:30", () => {
    const utc = parseTurkeyDateTime("2026-11-05T14:30")!;
    expect(providerSchedule(utc, "Europe/London", now)).toMatchObject({ beginDate: "2026-11-05", beginTime: "11:30" });
  });
  it("yaz (BST): TR 14:30 → UK 12:30", () => {
    const utc = parseTurkeyDateTime("2026-07-15T14:30")!;
    expect(providerSchedule(utc, "Europe/London", now)).toMatchObject({ beginDate: "2026-07-15", beginTime: "12:30" });
  });
  it("gün geçişi: TR 01:30 → UK önceki gün 22:30 (kış)", () => {
    const utc = parseTurkeyDateTime("2026-12-10T01:30")!;
    expect(providerSchedule(utc, "Europe/London", now)).toMatchObject({ beginDate: "2026-12-09", beginTime: "22:30" });
  });
  it("geçmiş zaman şimdiye yuvarlanır", () => {
    const n = new Date("2026-11-05T12:00:00Z");
    expect(providerSchedule("2026-11-05T08:00:00Z", "Europe/London", n)).toMatchObject({ beginDate: "2026-11-05", beginTime: "12:00" });
  });
  it("ofsetler", () => {
    expect(zoneOffsetMinutes(new Date("2026-11-05T12:00:00Z"), "Europe/Istanbul")).toBe(180);
    expect(zoneOffsetMinutes(new Date("2026-11-05T12:00:00Z"), "Europe/London")).toBe(0);
    expect(zoneOffsetMinutes(new Date("2026-07-05T12:00:00Z"), "Europe/London")).toBe(60);
    expect(formatInZone(new Date("2026-07-05T23:30:00Z"), "Europe/London").date).toBe("2026-07-06");
  });
});
