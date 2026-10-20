import { describe, expect, it } from "vitest";
import { badgeText, categoriesForTab, tabUnread, unreadElsewhere } from "./tab-activity";
import { ALL_CATEGORIES, CATEGORY_MENU } from "./notification-rules";

describe("activity numbers on the bottom bar", () => {
  const unread = { REQUISITIONS: 3, PURCHASING: 1, CASH: 2, PROJECTS: 4, SECURITY: 5 };

  it("counts each tab's own kind of notification", () => {
    expect(tabUnread("/requisitions", unread)).toBe(3);
    expect(tabUnread("/cash-expense", unread)).toBe(2);
    expect(tabUnread("/deliveries", unread)).toBe(0);
    expect(tabUnread("/people", unread)).toBe(0);
  });

  it("flags activity in tabs that are not on the bar, but not security alerts (they have no tab)", () => {
    expect(unreadElsewhere(["/requisitions", "/purchasing", "/cash-expense"], unread)).toBe(4); // projects only
    expect(unreadElsewhere(["/projects"], unread)).toBe(6); // requisitions + purchasing + cash
    expect(unreadElsewhere([], {})).toBe(0);
  });

  it("knows which kinds to clear when a tab is opened", () => {
    expect(categoriesForTab("/cash-expense")).toEqual(["CASH"]);
    expect(categoriesForTab("/people")).toEqual([]);
  });

  it("every notification kind that lives in a tab is wired to that tab", () => {
    for (const [category, menu] of Object.entries(CATEGORY_MENU)) expect(categoriesForTab(menu as string), category).toContain(category);
    for (const c of ["CASH", "FINANCE", "LEADS"]) expect(ALL_CATEGORIES).toContain(c);
  });

  it("caps the number shown", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});
