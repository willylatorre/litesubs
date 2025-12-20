import { getConsumerStats, getUserSubscriptions } from "@/app/actions/dashboard"
import { ConsumerStatsCards } from "@/components/consumer-stats-cards"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { IconArrowRight, IconShoppingCart } from "@tabler/icons-react"

export default async function Page() {
  const [stats, subscriptions] = await Promise.all([
    getConsumerStats(),
    getUserSubscriptions(),
  ])

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="flex items-center justify-between px-4 lg:px-6">
             <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        </div>

        <ConsumerStatsCards 
          totalSpent={stats.totalSpent} 
          activeSubscriptionsCount={stats.activeSubscriptionsCount}
        />
        
        <div className="grid gap-4 px-4 lg:px-6">
           {/* Active Subscriptions Section (Consumers) */}
           <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
               <div className="grid gap-1">
                <CardTitle>Active Subscriptions</CardTitle>
                <CardDescription>Your credits and available packs from creators.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="hidden sm:flex">
                <Link href="/dashboard/subscriptions">
                  View All <IconArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4">
              {subscriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">You don't have any active subscriptions.</p>
              ) : (
                 <div className="grid gap-4">
                  {subscriptions.slice(0, 3).map((sub) => (
                    <div key={sub.id} className="rounded-md border p-4">
                      <div className="flex items-center justify-between mb-2">
                          <span className="font-medium leading-none">
                            {sub.creator?.name || "Unknown Creator"}
                          </span>
                          <span className="text-sm font-semibold text-foreground">
                            {sub.credits} Credits
                          </span>
                      </div>
                      
                      {/* Quick Buy Options */}
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs text-muted-foreground mb-2">Quick Top-up:</p>
                        {sub.packs.length > 0 ? (
                           <div className="flex flex-wrap gap-2">
                             {sub.packs.slice(0, 2).map(pack => (
                               <Button key={pack.id} asChild variant="secondary" size="xs" className="h-7 text-xs">
                                 <Link href={`/buy/${pack.id}`}>
                                   <IconShoppingCart className="mr-1 size-3" />
                                   {pack.name} (${(pack.price/100).toFixed(0)})
                                 </Link>
                               </Button>
                             ))}
                             {sub.packs.length > 2 && (
                                <Button asChild variant="ghost" size="xs" className="h-7 text-xs">
                                  <Link href="/dashboard/subscriptions">+{sub.packs.length - 2} more</Link>
                                </Button>
                             )}
                           </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">No packs available.</p>
                        )}
                      </div>
                    </div>
                  ))}
                 </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}