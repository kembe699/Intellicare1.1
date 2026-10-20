import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-base font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      // Red (`destructive`) is reserved for delete/void actions — see
      // ConfirmDialog's `tone` prop for the dialog-level counterpart.
      variant: {
        default:     "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        outline:     "border border-border bg-card text-card-foreground hover:bg-muted/60 hover:text-foreground",
        secondary:   "bg-muted text-foreground hover:bg-muted/80",
        ghost:       "hover:bg-muted hover:text-foreground",
        link:        "text-primary underline-offset-4 hover:underline p-0 h-auto",
        "ghost-white": "border border-white/40 text-white hover:bg-white/10",
        "solid-white": "bg-white text-primary hover:bg-white/90",
      },
      size: {
        default: "h-11 px-4",
        sm:      "h-10 px-3 text-sm",
        lg:      "h-12 px-6",
        icon:    "h-11 w-11",
        "icon-sm": "h-10 w-10",
        xs:      "h-7 px-2.5 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Disables the button and swaps its content for a spinner + label (e.g. "Saving…"). */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
