"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { describeCanvasAction } from "@/app/canvas/actions";

/** Composer on the Canvas tab: describe a canvas and the model builds it. */
export function CanvasDescribe() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);

  async function submit() {
    const description = input.trim();
    if (!description || isBuilding) {
      return;
    }
    setIsBuilding(true);
    const toastId = toast.loading("Building your canvas…");
    try {
      const result = await describeCanvasAction(description);
      if ("error" in result) {
        toast.error("Canvas generation failed", { id: toastId, description: result.error });
        return;
      }
      toast.success("Canvas created", { id: toastId });
      setInput("");
      router.push(`/canvas?c=${result.canvasId}`);
    } catch {
      toast.error("Canvas generation failed", {
        id: toastId,
        description: "Check the model connection in Settings.",
      });
    } finally {
      setIsBuilding(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex w-full max-w-xl items-end gap-2">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe the canvas to make…  e.g. “a study map of how transformers work”"
        rows={2}
        disabled={isBuilding}
        className="max-h-40 min-h-[60px] resize-none"
      />
      <Button
        size="icon"
        onClick={submit}
        disabled={!input.trim() || isBuilding}
        aria-label="Build canvas"
      >
        {isBuilding ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ArrowUp className="size-4" />
        )}
      </Button>
    </div>
  );
}
