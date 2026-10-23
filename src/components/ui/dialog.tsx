import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

/**
 * True inside any modal. Lists rendered in a dialog (line items, previews)
 * read it to drop the page-list toolbar and paging — a modal is not the
 * place for date ranges, CSV/PDF and a search box.
 */
export const InDialogContext = React.createContext(false);

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Same dark-teal tint as AlertDialogOverlay (#14363C == the `heading`
      // token), rather than a different grey/blur treatment for this one.
      "fixed inset-0 z-50 bg-heading/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// Modal action buttons are one notch smaller than page buttons (40px, 14px
// text, at least 96px wide) so every dialog's footer reads the same,
// whatever size each call site happened to pass.
export const DIALOG_BUTTONS = "[&_button]:h-10 [&_button]:px-4 [&_button]:text-sm [&_button]:min-w-24";
// Many dialogs end their body with their own right-aligned button row instead
// of a DialogFooter; give those buttons the same 40px/14px size.
const BODY_ACTION_ROW = "[&_div[class*=justify-end]:last-child>button]:h-10 [&_div[class*=justify-end]:last-child>button]:px-4 [&_div[class*=justify-end]:last-child>button]:text-sm";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const selfPadded = /(^|\s)p-0(\s|$)/.test(className ?? "");
  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-0 border border-border bg-card shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-xl overflow-hidden",
        // One spacing rule for every dialog body, whatever the page put on it:
        // 20px left/right, 16px below the header and above the footer, 16px
        // between stacked body blocks, 20px at the edge when there's no
        // header/footer. Previously only the edge case had padding, so most
        // forms sat flush against the header and footer rules.
        BODY_ACTION_ROW,
        !selfPadded &&
          "[&>*:not([data-dialog-chrome])]:px-5 [&>*:not([data-dialog-chrome]):first-child]:pt-5 [&>*:not([data-dialog-chrome]):last-child]:pb-5 [&>[data-dialog-chrome]+*:not([data-dialog-chrome])]:pt-4 [&>*:not([data-dialog-chrome]):has(+[data-dialog-chrome])]:pb-4 [&>*:not([data-dialog-chrome])+*:not([data-dialog-chrome])]:mt-4",
        className,
      )}
      {...props}
    >
      <InDialogContext.Provider value={true}>{children}</InDialogContext.Provider>
      <DialogPrimitive.Close data-dialog-chrome="" className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div data-dialog-chrome="" className={cn(
    "flex flex-col gap-1 pl-5 pr-12 py-4 border-b border-border",
    className
  )} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div data-dialog-chrome="" className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:items-center gap-2 px-5 py-3 border-t border-border bg-muted/30", DIALOG_BUTTONS, className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold leading-snug text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
