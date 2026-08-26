"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { REPORT_WIDTH } from "./report";

/**
 * Print control for the standalone report page. Hidden from the printed output
 * itself, and skipped entirely when the page is embedded as a preview (the
 * export tab supplies its own button and prints the iframe).
 */
export function ReportToolbar() {
  return (
    <div
      className="report-no-print mx-auto mb-4 flex items-center justify-end"
      style={{ width: REPORT_WIDTH }}
    >
      <Button size="sm" onClick={() => window.print()} className="gap-1.5">
        <Printer className="size-3.5" />
        Save as PDF
      </Button>
    </div>
  );
}
