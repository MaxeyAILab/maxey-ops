"use client";

import { useEffect } from "react";
import { resubscribeIfAllowed } from "@/lib/push-client";

/** Keeps a phone that already allowed notifications subscribed for whoever is signed in on it. Renders nothing. */
export function PushAutoSubscribe() {
  useEffect(() => {
    resubscribeIfAllowed().catch(() => undefined);
  }, []);
  return null;
}
