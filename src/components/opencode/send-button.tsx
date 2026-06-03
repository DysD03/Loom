"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SquareTerminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildOpencodeTaskAction } from "@/app/opencode/actions";

export function SendToOpencodeButton({
  sourceId,
  kind,
  disabled,
}: {
  sourceId: string;
  kind: "conversation" | "research" | "canvas";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);

  async function handle() {
    if (sending) return;
    setSending(true);
    const toastId = toast.loading("Preparing task for OpenCode…");
    try {
      const result = await buildOpencodeTaskAction(sourceId, kind);
      if ("error" in result) {
        toast.error("Send to OpenCode", { id: toastId, description: result.error });
        return;
      }
      sessionStorage.setItem("opencode-seed", result.task);
      toast.success("Sent to OpenCode — open a workspace to run it", { id: toastId });
      router.push("/opencode");
    } catch {
      toast.error("Send to OpenCode failed", { id: toastId });
    } finally {
      setSending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handle} disabled={disabled || sending}>
      <SquareTerminal className="size-4" />
      {sending ? "Sending…" : "Send to OpenCode"}
    </Button>
  );
}
