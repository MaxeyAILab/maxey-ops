import { describe, expect, it } from "vitest";
import {
  availableToPromise,
  canApproveTallyOut,
  canConfirmTallyOut,
  canDecideOwnTallyOut,
  canVerifyTallyOut,
  checkDriverRows,
  checkReceiverRows,
  mergeLines,
  movedQuantities,
  reservedByItem,
  shortLines,
  shortfallText,
} from "./tally-out";

const lines = [
  { itemId: "elbow", name: 'PVC Elbow 3"x90', unit: "pcs", qty: 39 },
  { itemId: "pipe", name: 'PVC Pipe 3"', unit: "pcs", qty: 19 },
];

describe("the form's lines", () => {
  it("merges the same item entered twice and drops empty lines", () => {
    const m = mergeLines([
      { itemId: "a", name: "A", unit: "pc", qty: 2 },
      { itemId: "a", name: "A", unit: "pc", qty: 3.5 },
      { itemId: "b", name: "B", unit: "pc", qty: 0 },
    ]);
    expect(m).toEqual([{ itemId: "a", name: "A", unit: "pc", qty: 5.5 }]);
  });
});

describe("reserving stock for open forms", () => {
  it("adds up what the open forms promise, leaving one form out when asked", () => {
    const open = [
      { id: "t1", items: [{ itemId: "elbow", qty: 10 }] },
      { id: "t2", items: [{ itemId: "elbow", qty: 5 }, { itemId: "pipe", qty: 2 }] },
    ];
    expect(reservedByItem(open).get("elbow")).toBe(15);
    expect(reservedByItem(open, "t2").get("elbow")).toBe(10);
    expect(reservedByItem(open, "t2").has("pipe")).toBe(false);
  });
  it("what can be promised is what is on hand minus what is reserved, never below zero", () => {
    expect(availableToPromise(20, 15)).toBe(5);
    expect(availableToPromise(10, 15)).toBe(0);
  });
  it("flags every line that asks for more than can be promised", () => {
    const short = shortLines(lines, new Map([["elbow", 45], ["pipe", 54]]), new Map([["elbow", 10]]));
    expect(short.map((s) => [s.line.itemId, s.available])).toEqual([["elbow", 35]]);
    expect(shortLines(lines, new Map([["elbow", 45], ["pipe", 54]]), new Map())).toEqual([]);
  });
});

describe("who may do each step", () => {
  const owner = { id: "o", role: "OWNER" };
  const joseph = { id: "j", role: "PM", canApproveTallyOut: true };
  const pm = { id: "p", role: "PM" };
  it("the Owner and a person the Owner switched on may approve; nobody else", () => {
    expect(canApproveTallyOut(owner)).toBe(true);
    expect(canApproveTallyOut(joseph)).toBe(true);
    expect(canApproveTallyOut(pm)).toBe(false);
    expect(canApproveTallyOut({ id: "a", role: "PURCHASING" })).toBe(false);
  });
  it("only the Owner decides their own form", () => {
    expect(canDecideOwnTallyOut(owner)).toBe(true);
    expect(canDecideOwnTallyOut(joseph)).toBe(false);
  });
  it("drivers (by account or department), foremen, engineers, PM and Owner may verify the load", () => {
    expect(canVerifyTallyOut({ id: "d", role: "DRIVER" })).toBe(true);
    expect(canVerifyTallyOut({ id: "d", role: "OFFICE", department: "DRIVER" })).toBe(true);
    expect(canVerifyTallyOut({ id: "f", role: "FOREMAN" })).toBe(true);
    expect(canVerifyTallyOut({ id: "x", role: "OFFICE", department: "OFFICE" })).toBe(false);
    expect(canVerifyTallyOut({ id: "a", role: "PURCHASING" })).toBe(false);
  });
  it("the named receiver confirms; the Owner for anyone; PM and Purchasing only when the receiver is not in the app", () => {
    const t = { receiverId: "r", status: "VERIFIED" };
    expect(canConfirmTallyOut({ id: "r", role: "FOREMAN" }, t)).toBe(true);
    expect(canConfirmTallyOut({ id: "z", role: "FOREMAN" }, t)).toBe(false);
    expect(canConfirmTallyOut(owner, t)).toBe(true);
    expect(canConfirmTallyOut(pm, t)).toBe(false);
    expect(canConfirmTallyOut(pm, { receiverId: null, status: "VERIFIED" })).toBe(true);
    expect(canConfirmTallyOut({ id: "r", role: "FOREMAN" }, { receiverId: "r", status: "APPROVED" })).toBe(false);
  });
});

describe("the driver's count and the receiver's count", () => {
  it("the driver may count less than the form but never more, and must count every line", () => {
    expect(checkDriverRows(lines, [{ itemId: "elbow", countedQty: 39, ok: true }, { itemId: "pipe", countedQty: 18, ok: false }])).toBeNull();
    expect(checkDriverRows(lines, [{ itemId: "elbow", countedQty: 40, ok: true }, { itemId: "pipe", countedQty: 19, ok: true }])).toMatch(/more/);
    expect(checkDriverRows(lines, [{ itemId: "elbow", countedQty: 39, ok: true }])).toMatch(/Count/);
    expect(checkDriverRows(lines, [{ itemId: "elbow", countedQty: 39, ok: true }, { itemId: "pipe", countedQty: 19, ok: true }, { itemId: "ghost", countedQty: 1, ok: true }])).toMatch(/not on this form/);
  });
  it("the receiver may receive less than the driver counted but never more", () => {
    const counted = new Map([["elbow", 39], ["pipe", 18]]);
    expect(checkReceiverRows(counted, [{ itemId: "elbow", receivedQty: 39 }, { itemId: "pipe", receivedQty: 17 }])).toBeNull();
    expect(checkReceiverRows(counted, [{ itemId: "elbow", receivedQty: 39 }, { itemId: "pipe", receivedQty: 19 }])).toMatch(/more/);
    expect(checkReceiverRows(counted, [{ itemId: "elbow", receivedQty: 39 }])).toMatch(/every item/);
  });
  it("only what the receiver confirmed moves, and lines with nothing received move nothing", () => {
    const moved = movedQuantities([{ itemId: "elbow", receivedQty: 39 }, { itemId: "pipe", receivedQty: 0 }]);
    expect([...moved]).toEqual([["elbow", 39]]);
  });
  it("lists what did not arrive as the form said", () => {
    expect(shortfallText(lines, new Map([["elbow", 39], ["pipe", 15]]))).toEqual(['PVC Pipe 3": form 19, received 15']);
    expect(shortfallText(lines, new Map([["elbow", 39], ["pipe", 19]]))).toEqual([]);
  });
});
