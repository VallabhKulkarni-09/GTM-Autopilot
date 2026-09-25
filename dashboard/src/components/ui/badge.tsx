import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Base — Apple-style label
  [
    "inline-flex items-center rounded-full px-2.5 py-[3px]",
    "text-[11px] font-semibold leading-none",
    "transition-colors duration-150",
    "focus:outline-none focus:ring-2 focus:ring-[#007AFF] focus:ring-offset-2",
  ].join(" "),
  {
    variants: {
      variant: {
        // Translucent blue — primary label
        default:
          "bg-[rgba(0,122,255,0.12)] text-[#007AFF] border-transparent",
        // Translucent gray — secondary label
        secondary:
          "bg-[rgba(0,0,0,0.06)] text-[rgba(0,0,0,0.60)] border-transparent",
        // Translucent red — destructive
        destructive:
          "bg-[rgba(255,59,48,0.12)] text-[#FF3B30] border-transparent",
        // Outline — subtle border
        outline:
          "border border-[rgba(0,0,0,0.15)] text-[rgba(0,0,0,0.65)] bg-transparent",
        // Success green
        success:
          "bg-[rgba(52,199,89,0.12)] text-[#34C759] border-transparent",
        // Warning orange
        warning:
          "bg-[rgba(255,149,0,0.12)] text-[#FF9500] border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
