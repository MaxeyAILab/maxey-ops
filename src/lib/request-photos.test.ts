import { describe, expect, it } from "vitest";
import { MAX_REQUEST_PHOTOS, photoList, photoRoom, withPhotos } from "./request-photos";

describe("request photos", () => {
  it("reads the stored list, ignoring anything that is not text", () => {
    expect(photoList(["/api/files/a.jpg", "/api/files/b.jpg"])).toEqual(["/api/files/a.jpg", "/api/files/b.jpg"]);
    expect(photoList(null)).toEqual([]);
    expect(photoList({ 0: "x" })).toEqual([]);
    expect(photoList(["a", 3, "", null, "b"])).toEqual(["a", "b"]);
  });

  it("says how many more can be added", () => {
    expect(photoRoom(null)).toBe(MAX_REQUEST_PHOTOS);
    expect(photoRoom(["a", "b", "c"])).toBe(MAX_REQUEST_PHOTOS - 3);
    expect(photoRoom(Array.from({ length: 12 }, (_, i) => String(i)))).toBe(0);
  });

  it("adds new photos after the old ones and never goes over the limit", () => {
    expect(withPhotos(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(withPhotos(null, ["x"])).toEqual(["x"]);
    expect(withPhotos(Array.from({ length: 7 }, (_, i) => `o${i}`), ["n1", "n2", "n3"])).toHaveLength(MAX_REQUEST_PHOTOS);
  });
});
