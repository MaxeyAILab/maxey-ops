import { describe, expect, it } from "vitest";
import { canConfirmDelivery, deliveryStage, isAwaitingConfirmation, missingNames } from "./delivery-confirm";

describe("delivery stage", () => {
  it("old deliveries (before the rule) are fully verified", () => {
    expect(isAwaitingConfirmation({ needsConfirmation: false })).toBe(false);
    expect(deliveryStage({ needsConfirmation: false })).toBe("CONFIRMED");
  });

  it("a driver-verified delivery waits until the receiver confirms", () => {
    expect(deliveryStage({ needsConfirmation: true, confirmedAt: null })).toBe("AWAITING");
    expect(deliveryStage({ needsConfirmation: true, confirmedAt: new Date() })).toBe("CONFIRMED");
  });

  it("a receiver who reported a problem leaves it disputed, still not confirmed", () => {
    expect(deliveryStage({ needsConfirmation: true, confirmedAt: null, disputedAt: new Date() })).toBe("DISPUTED");
    expect(isAwaitingConfirmation({ needsConfirmation: true, confirmedAt: null, disputedAt: new Date() })).toBe(true);
  });
});

describe("canConfirmDelivery", () => {
  const waiting = { needsConfirmation: true, confirmedAt: null, receiverId: "recv" };

  it("is the named receiver, or the Owner", () => {
    expect(canConfirmDelivery({ id: "recv", role: "FOREMAN" }, waiting)).toBe(true);
    expect(canConfirmDelivery({ id: "owner", role: "OWNER" }, waiting)).toBe(true);
  });

  it("is nobody else — not the driver, not the PM, not Purchasing", () => {
    expect(canConfirmDelivery({ id: "driver", role: "DRIVER" }, waiting)).toBe(false);
    expect(canConfirmDelivery({ id: "pm", role: "PM" }, waiting)).toBe(false);
    expect(canConfirmDelivery({ id: "pur", role: "PURCHASING" }, waiting)).toBe(false);
  });

  it("when the receiver is not in the app, the PM, Purchasing and the Owner can confirm", () => {
    const outsider = { needsConfirmation: true, confirmedAt: null, receiverId: null };
    expect(canConfirmDelivery({ id: "pm", role: "PM" }, outsider)).toBe(true);
    expect(canConfirmDelivery({ id: "pur", role: "PURCHASING" }, outsider)).toBe(true);
    expect(canConfirmDelivery({ id: "owner", role: "OWNER" }, outsider)).toBe(true);
    expect(canConfirmDelivery({ id: "f", role: "FOREMAN" }, outsider)).toBe(false);
  });

  it("nobody confirms twice, or confirms an old delivery that never needed it", () => {
    expect(canConfirmDelivery({ id: "recv", role: "FOREMAN" }, { ...waiting, confirmedAt: new Date() })).toBe(false);
    expect(canConfirmDelivery({ id: "owner", role: "OWNER" }, { needsConfirmation: false, receiverId: null })).toBe(false);
  });
});

describe("missingNames", () => {
  it("needs the driver's name", () => {
    expect(missingNames({ driverName: "", receiverId: "r1" })).toBe("Enter the driver's name");
    expect(missingNames({ driverName: "  ", receiverId: "r1" })).toBe("Enter the driver's name");
    expect(missingNames({ driverName: "J", receiverId: "r1" })).toBe("Enter the driver's name");
    expect(missingNames({ receiverId: "r1" })).toBe("Enter the driver's name");
  });

  it("needs a receiver: someone in the app, or a typed name", () => {
    expect(missingNames({ driverName: "Zoilo", receiverId: null, recipientName: "" })).toBe("Enter who is receiving the delivery");
    expect(missingNames({ driverName: "Zoilo" })).toBe("Enter who is receiving the delivery");
    expect(missingNames({ driverName: "Zoilo", receiverId: "r1" })).toBeNull();
    expect(missingNames({ driverName: "Zoilo", recipientName: "Mark Catalan" })).toBeNull();
  });
});
