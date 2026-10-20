import { describe, expect, it } from "vitest";
import { mapsLink, osmEmbedUrl, parseGps } from "./geo";

describe("parseGps", () => {
  it("reads what clock-in and deliveries record", () => {
    expect(parseGps("14.206800,121.156300")).toEqual({ lat: 14.2068, lng: 121.1563 });
    expect(parseGps(" 14.2,121.1 ")).toEqual({ lat: 14.2, lng: 121.1 });
    expect(parseGps("-33.86,151.2")).toEqual({ lat: -33.86, lng: 151.2 });
  });
  it("refuses anything that isn't a real fix", () => {
    for (const bad of [null, undefined, "", "unknown", "14.2", "14.2,121.1,5", "91,10", "10,181", "0,0", "a,b", "14.2;121.1"]) expect(parseGps(bad as string)).toBeNull();
  });
});

describe("map links", () => {
  it("puts the pin on the spot", () => {
    const url = osmEmbedUrl({ lat: 14.2068, lng: 121.1563 });
    expect(url).toContain("marker=14.206800%2C121.156300");
    expect(url.startsWith("https://www.openstreetmap.org/export/embed.html?bbox=")).toBe(true);
    expect(mapsLink({ lat: 14.2068, lng: 121.1563 })).toBe("https://www.google.com/maps/search/?api=1&query=14.206800%2C121.156300");
  });
});
