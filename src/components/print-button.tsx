"use client";

import { Button } from "@/components/ui";

export function PrintButton({ label = "Download PDF" }: { label?: string }) {
  return (
    <Button variant="primary" className="no-print" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
