import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "./label"

interface InputProps extends React.ComponentProps<"input"> {
  label?: string;
}

function Input({ className, type, label, id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  
  const inputElement = (
    <input
      id={inputId}
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-10 w-full min-w-0 rounded-lg border bg-transparent px-4 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );

  if (label) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>{label}</Label>
        {inputElement}
      </div>
    );
  }

  return inputElement;
}

export { Input }
