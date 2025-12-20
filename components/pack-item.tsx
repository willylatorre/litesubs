import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

interface PackItemProps {
  name: string
  credits: number
  price: number
  action?: React.ReactNode
  className?: string
  onCreditsHover?: (hovering: boolean) => void
  onPriceHover?: (hovering: boolean) => void
}

export function PackItem({ name, credits, price, action, className, onCreditsHover, onPriceHover }: PackItemProps) {
  return (
    <Card className={cn("flex items-center justify-between p-4 shadow-sm transition-all hover:shadow-md font-sans tracking-tight", className)}>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-sm leading-none">{name}</span>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <span 
            className={cn(onCreditsHover && "cursor-help hover:text-foreground transition-colors")}
            onMouseEnter={() => onCreditsHover?.(true)}
            onMouseLeave={() => onCreditsHover?.(false)}
          >
            {credits} Credits
          </span>
          <span>•</span>
          <span
            className={cn(onPriceHover && "cursor-help hover:text-foreground transition-colors")}
            onMouseEnter={() => onPriceHover?.(true)}
            onMouseLeave={() => onPriceHover?.(false)}
          >
            ${(price / 100).toFixed(2)}
          </span>
        </span>
      </div>
      {action}
    </Card>
  )
}
