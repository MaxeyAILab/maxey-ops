/**
 * English / Filipino for the screens site staff use every day: the menu and phone chrome, clock in/out, requisitions,
 * delivery checks and the confirmations that pop up after saving. A string with no Filipino entry is shown in English,
 * so a screen that isn't translated yet is never blank. Each entry is [English, Filipino].
 */
export type Lang = "en" | "fil";
export const LANG_COOKIE = "maxey_lang";

export const isLang = (v: unknown): v is Lang => v === "en" || v === "fil";

const D = {
  // ----- menu & chrome -----
  "nav.dashboard": ["Dashboard", "Dashboard"],
  "nav.finance": ["Finance", "Pananalapi"],
  "nav.leads": ["Leads / CRM", "Mga Lead / CRM"],
  "nav.projects": ["Projects", "Mga Proyekto"],
  "nav.requisitions": ["Requisitions", "Mga Requisition"],
  "nav.purchasing": ["Purchasing", "Pagbili"],
  "nav.deliveries": ["Deliveries", "Mga Delivery"],
  "nav.inventory": ["Inventory", "Imbentaryo"],
  "nav.instructions": ["Instructions", "Mga Utos"],
  "nav.attendance": ["Attendance", "Attendance"],
  "nav.payroll": ["Payroll", "Sahod"],
  "nav.people": ["People", "Mga Tao"],
  "nav.cash": ["Cash Expense", "Gastos sa Cash"],
  "nav.cashShort": ["Cash", "Cash"],
  "nav.pettyCash": ["Petty Cash", "Petty Cash"],
  "nav.cashAdvance": ["Cash Advance", "Cash Advance"],
  "nav.pettyCashReport": ["Petty Cash Report", "Ulat ng Petty Cash"],
  "nav.notifications": ["Notifications", "Mga Abiso"],
  "nav.settings": ["My settings", "Aking settings"],
  "nav.search": ["Search", "Maghanap"],
  "chrome.platform": ["Operations Platform", "Operations Platform"],
  "chrome.signOut": ["Sign out", "Mag-sign out"],
  "chrome.menu": ["Menu", "Menu"],
  "chrome.openMenu": ["Open menu", "Buksan ang menu"],
  "chrome.closeMenu": ["Close menu", "Isara ang menu"],
  "chrome.refresh": ["Refresh", "I-refresh"],
  "chrome.refreshing": ["Refreshing…", "Nagre-refresh…"],
  "chrome.pullToRefresh": ["Pull down to refresh", "I-pull pababa para mag-refresh"],
  "chrome.releaseToRefresh": ["Release to refresh", "Bitawan para mag-refresh"],
  "chrome.language": ["Language", "Wika"],
  "chrome.quickAdd": ["Quick add", "Mabilis na dagdag"],
  "chrome.close": ["Close", "Isara"],

  // ----- quick actions -----
  "quick.title": ["What do you want to do?", "Ano ang gusto mong gawin?"],
  "quick.requisition": ["New requisition", "Bagong requisition"],
  "quick.progress": ["Post progress", "Mag-post ng progress"],
  "quick.pettyCash": ["File petty cash", "Mag-file ng petty cash"],
  "quick.clock": ["Time in / out", "Time in / out"],
  "quick.delivery": ["Check a delivery", "Mag-check ng delivery"],
  "quick.pickProject": ["Which project?", "Aling proyekto?"],
  "quick.back": ["‹ Back", "‹ Bumalik"],
  "quick.noProjects": ["No active projects.", "Walang aktibong proyekto."],

  // ----- search -----
  "search.placeholder": ["Search projects, requisitions, POs, people…", "Maghanap ng proyekto, requisition, PO, tao…"],
  "search.hint": ["Type at least 2 letters.", "Mag-type ng hindi bababa sa 2 letra."],
  "search.none": ["Nothing found.", "Walang nakita."],
  "search.searching": ["Searching…", "Naghahanap…"],
  "search.projects": ["Projects", "Mga Proyekto"],
  "search.requisitions": ["Requisitions", "Mga Requisition"],
  "search.purchaseOrders": ["Purchase orders", "Mga Purchase Order"],
  "search.people": ["People", "Mga Tao"],

  // ----- feedback toasts -----
  "toast.saved": ["Saved", "Na-save"],
  "toast.updated": ["Updated", "Na-update"],
  "toast.deleted": ["Deleted", "Nabura"],
  "toast.approved": ["Approved", "Naaprubahan"],
  "toast.rejected": ["Rejected", "Tinanggihan"],
  "toast.released": ["Released", "Na-release"],
  "toast.verified": ["Verified", "Na-verify"],
  "toast.sent": ["Sent", "Naipadala"],
  "toast.failed": ["Didn't go through", "Hindi natuloy"],
  "toast.offline": ["Saved on this phone — will send when there's signal", "Na-save sa phone — ipapadala kapag may signal"],

  // ----- share -----
  "share.button": ["Share", "I-share"],
  "share.sharing": ["Preparing…", "Inihahanda…"],
  "share.copied": ["Link copied", "Nakopya ang link"],
  "share.downloaded": ["Downloaded — attach it in Viber, Messenger or email", "Na-download — i-attach sa Viber, Messenger o email"],
  "share.failed": ["Couldn't share that", "Hindi na-share"],

  // ----- location -----
  "map.viewMap": ["View map", "Tingnan ang mapa"],
  "map.hideMap": ["Hide map", "Itago ang mapa"],
  "map.openInMaps": ["Open in Maps", "Buksan sa Maps"],
  "map.noLocation": ["No location recorded", "Walang naitalang lokasyon"],
  "map.location": ["Location", "Lokasyon"],

  // ----- bottom bar & my settings -----
  "settings.title": ["My settings", "Aking settings"],
  "settings.bottomBar": ["Bottom bar on your phone", "Bottom bar sa phone mo"],
  "settings.bottomBarHelp": [
    "Pick 2 to 5 tabs for the bar at the bottom of the phone screen.",
    "Pumili ng 2 hanggang 5 tab para sa bar sa ibaba ng screen ng phone.",
  ],
  "settings.isDefault": ["This is the default for your role.", "Ito ang default para sa role mo."],
  "settings.useDefault": ["Use the default for my role", "Gamitin ang default para sa role ko"],
  "settings.save": ["Save", "I-save"],
  "settings.language": ["Language", "Wika"],
  "settings.vibration": ["Vibrate when something is saved", "Mag-vibrate kapag may na-save"],
  "settings.notifications": ["Phone notifications", "Mga abiso sa phone"],
  "settings.openNotifications": ["Open notification settings", "Buksan ang settings ng abiso"],
  "settings.passkeys": ["Fingerprint / Face ID sign-in", "Fingerprint / Face ID sign-in"],
  "settings.passkeysHelp": [
    "Sign in with your phone's fingerprint or Face ID instead of typing your password.",
    "Mag-sign in gamit ang fingerprint o Face ID ng phone mo sa halip na i-type ang password.",
  ],
  "settings.addPasskey": ["Set up on this phone", "I-set up sa phone na ito"],
  "settings.removePasskey": ["Remove", "Alisin"],
  "settings.noPasskeys": ["No fingerprint / Face ID set up yet.", "Wala pang naka-set up na fingerprint / Face ID."],
  "settings.passkeyUnsupported": ["This browser can't use fingerprint or Face ID.", "Hindi kaya ng browser na ito ang fingerprint o Face ID."],

  // ----- sign in -----
  "login.passkey": ["Sign in with fingerprint / Face ID", "Mag-sign in gamit ang fingerprint / Face ID"],

  // ----- attendance clock -----
  "clock.project": ["Site / project", "Site / proyekto"],
  "clock.office": ["Office / no specific site", "Opisina / walang partikular na site"],
  "clock.timeIn": ["⏱ TIME IN", "⏱ TIME IN"],
  "clock.timeOut": ["⏱ TIME OUT", "⏱ TIME OUT"],
  "clock.recording": ["Recording…", "Nire-record…"],
  "clock.footer": [
    "GPS, device, and exact time are recorded with each tap. Works offline.",
    "Naitatala ang GPS, device, at eksaktong oras sa bawat tap. Gumagana kahit walang signal.",
  ],
  "clock.queuedIn": [
    "Time in saved on this device (no signal) — it will sync automatically with the exact tap time.",
    "Na-save ang time in sa device na ito (walang signal) — awtomatikong isi-sync kasama ang eksaktong oras ng tap.",
  ],
  "clock.queuedOut": [
    "Time out saved on this device (no signal) — it will sync automatically with the exact tap time.",
    "Na-save ang time out sa device na ito (walang signal) — awtomatikong isi-sync kasama ang eksaktong oras ng tap.",
  ],
  "clock.failed": ["Failed", "Hindi natuloy"],
  "clock.locOn": ["📍 Your location is recorded with each tap", "📍 Naitatala ang lokasyon mo sa bawat tap"],
  "clock.locBlocked": [
    "📍 Location is blocked — allow it in your browser settings so your time in/out shows where you were.",
    "📍 Naka-block ang lokasyon — payagan ito sa settings ng browser para makita kung nasaan ka sa time in/out.",
  ],
  "clock.locCaptured": ["📍 Location recorded", "📍 Naitala ang lokasyon"],
  "clock.locMissing": ["No location this time — check that location is on", "Walang lokasyon ngayon — tiyaking naka-on ang location"],

  // ----- shared form pieces -----
  "form.savedToOutbox": ["Saved to outbox", "Na-save sa outbox"],

  // ----- requisition form -----
  "req.title": ["New Material Requisition", "Bagong Material Requisition"],
  "req.chargeTo": ["Charge to", "I-charge sa"],
  "req.ga": ["General & Administrative", "Pangkalahatan at Administratibo"],
  "req.catOffice": ["Office", "Opisina"],
  "req.catWarehouse": ["Warehouse", "Bodega"],
  "req.catEmergency": ["Emergency", "Emergency"],
  "req.projects": ["Projects", "Mga Proyekto"],
  "req.nonCorporate": ["Non-corporate", "Hindi pang-kumpanya"],
  "req.urgency": ["Urgency", "Gaano kaapurado"],
  "req.low": ["Low", "Mababa"],
  "req.normal": ["Normal", "Normal"],
  "req.high": ["High", "Mataas"],
  "req.critical": ["Critical", "Kritikal"],
  "req.neededBy": ["Needed by", "Kailangan bago ang"],
  "req.items": ["Items *", "Mga item *"],
  "req.itemName": ["Material / item name", "Materyales / pangalan ng item"],
  "req.qty": ["Qty", "Dami"],
  "req.unit": ["Unit (pcs, bags…)", "Yunit (pcs, bags…)"],
  "req.spec": ["Specification / brand / size (optional)", "Detalye / brand / laki (opsyonal)"],
  "req.removeItem": ["Remove item", "Alisin ang item"],
  "req.addItem": ["+ Add item", "+ Magdagdag ng item"],
  "req.notes": ["Notes", "Mga tala"],
  "req.notesPlaceholder": ["Purpose, delivery instructions…", "Layunin, tagubilin sa delivery…"],
  "req.submit": ["Submit requisition", "Isumite ang requisition"],
  "req.submitting": ["Submitting…", "Isinusumite…"],
  "req.offline": ["Works offline — if you have no signal, it will sync automatically later.", "Gumagana kahit walang signal — awtomatikong isi-sync mamaya."],
  "req.needItem": ["Add at least one item.", "Magdagdag ng kahit isang item."],
  "req.failed": ["Submission failed", "Hindi naisumite"],
  "req.queued": [
    "No signal — requisition saved on this device and will sync automatically when you're back online.",
    "Walang signal — na-save ang requisition sa device na ito at awtomatikong isi-sync kapag may signal na.",
  ],
  "req.another": ["Submit another", "Magsumite ng isa pa"],

  // ----- delivery form -----
  "del.driver": ["Driver", "Driver"],
  "del.driverPh": ["Name of the driver delivering", "Pangalan ng driver na nag-deliver"],
  "del.receivedBy": ["Received by", "Tinanggap ni"],
  "del.receivedByPh": ["Name of the person who received it", "Pangalan ng tumanggap"],
  "del.ordered": ["Ordered", "Inorder"],
  "del.specOk": ["Spec OK", "Tama ang spec"],
  "del.receivedQty": ["Received qty", "Natanggap na dami"],
  "del.remarks": ["Remarks", "Mga puna"],
  "del.remarksPh": ["short / damaged / wrong spec…", "kulang / sira / maling spec…"],
  "del.photos": ["Photos (delivery, damage, receipts)", "Mga larawan (delivery, sira, resibo)"],
  "del.discrepancy": [
    "⚠ Discrepancies detected — PM and Purchasing will be notified automatically for supplier follow-up.",
    "⚠ May nakitang diperensya — awtomatikong aabisuhan ang PM at Purchasing para sa follow-up sa supplier.",
  ],
  "del.submit": ["Submit delivery form", "Isumite ang delivery form"],
  "del.submitting": ["Submitting…", "Isinusumite…"],
  "del.footer": ["Works offline. GPS + time are recorded for verification.", "Gumagana kahit walang signal. Naitatala ang GPS at oras para sa beripikasyon."],
  "del.failed": ["Submission failed", "Hindi naisumite"],
  "del.queued": [
    "No signal — delivery form saved on this device and will sync automatically.",
    "Walang signal — na-save ang delivery form sa device na ito at awtomatikong isi-sync.",
  ],
} as const satisfies Record<string, readonly [string, string]>;

export type I18nKey = keyof typeof D;
export const I18N_KEYS = Object.keys(D) as I18nKey[];
export type T = (key: I18nKey) => string;

export function makeT(lang: Lang): T {
  return (key) => {
    const entry = D[key] as readonly [string, string] | undefined;
    if (!entry) return key;
    return (lang === "fil" ? entry[1] : entry[0]) || entry[0];
  };
}
