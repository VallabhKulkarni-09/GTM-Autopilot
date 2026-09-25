import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base — Apple HIG tactile button
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px]",
    "text-[15px] font-semibold leading-none",
    "transition-all duration-150 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF] focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:scale-[0.97]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary — Apple Blue filled
        default: [
          "bg-[#007AFF] text-white",
          "shadow-[0_1px_3px_rgba(0,122,255,0.35),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "hover:bg-[#0071E3]",
          "active:bg-[#0066CC] active:shadow-none",
        ].join(" "),
        // Destructive — Apple Red
        destructive: [
          "bg-[#FF3B30] text-white",
          "shadow-[0_1px_3px_rgba(255,59,48,0.35),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "hover:bg-[#E8352B]",
          "active:bg-[#CC2F26]",
        ].join(" "),
        // Outline — glass surface
        outline: [
          "border border-[rgba(0,0,0,0.12)] bg-white/60 backdrop-blur-md text-[rgba(0,0,0,0.85)]",
          "hover:bg-white/80",
          "active:bg-black/5",
        ].join(" "),
        // Secondary — subtle fill
        secondary: [
          "bg-[rgba(0,0,0,0.06)] text-[rgba(0,0,0,0.75)]",
          "hover:bg-[rgba(0,0,0,0.1)]",
          "active:bg-[rgba(0,0,0,0.14)]",
        ].join(" "),
        // Ghost — transparent
        ghost: [
          "text-[rgba(0,0,0,0.75)]",
          "hover:bg-[rgba(0,0,0,0.06)]",
          "active:bg-[rgba(0,0,0,0.1)]",
        ].join(" "),
        link: "text-[#007AFF] underline-offset-4 hover:underline rounded-none active:scale-100",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm:      "h-8 rounded-[8px] px-4 text-[13px]",
        lg:      "h-12 rounded-[12px] px-7 text-[17px]",
        icon:    "h-10 w-10 rounded-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
