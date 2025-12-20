import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface ConsumerStatsCardsProps {
  totalSpent: number
  activeSubscriptionsCount: number
}

export function ConsumerStatsCards({
  totalSpent,
  activeSubscriptionsCount,
}: ConsumerStatsCardsProps) {
  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Total Spent</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            ${(totalSpent / 100).toFixed(2)}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Active Subscriptions</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {activeSubscriptionsCount}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  )
}
