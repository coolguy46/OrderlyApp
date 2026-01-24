import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "./label"

interface TextareaProps extends React.ComponentProps<"textarea"> {
  label?: string;
}

function Textarea({ className, label, id, ...props }: TextareaProps) {
  const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');
  
  const textareaElement = (
    <textarea
      id={textareaId}
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );

  if (label) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={textareaId}>{label}</Label>
        {textareaElement}
      </div>
    );
  }

  return textareaElement;
}

export { Textarea }
