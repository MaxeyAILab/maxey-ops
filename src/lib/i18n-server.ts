import { cookies } from "next/headers";
import { LANG_COOKIE, isLang, makeT, type Lang } from "@/lib/i18n";

/** The language of the person making this request (their cookie), English when not set. */
export function getLang(): Lang {
  const v = cookies().get(LANG_COOKIE)?.value;
  return isLang(v) ? v : "en";
}

export const getT = () => makeT(getLang());
