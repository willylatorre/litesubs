import { getCreatorStats } from "@/app/actions/dashboard"
import { getCreatorProducts } from "@/app/actions/products"
import { SectionCards } from "@/components/section-cards"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { IconArrowRight, IconCirclePlusFilled } from "@tabler/icons-react"
import { CreatePackDialog } from "../packs/create-pack-dialog"

export default async function CreatorDashboardPage() {
  const [stats, products] = await Promise.all([
    getCreatorStats(),
    getCreatorProducts(),
  ])

  const livePacks = products.filter((p) => p.active)

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="flex items-center justify-between px-4 lg:px-6">
             <h1 className="text-2xl font-bold tracking-tight">Creator Dashboard</h1>
             <CreatePackDialog />
        </div>

        <SectionCards 
          totalRevenue={stats.totalRevenue} 
          activeProducts={stats.activeProducts} 
          totalCustomers={stats.totalCustomers} 
        />
        
        <div className="grid gap-4 px-4 lg:px-6">
          {/* Live Packs Section */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="grid gap-1">
                <CardTitle>Your Live Packs</CardTitle>
                <CardDescription>Packs currently available for purchase.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="hidden sm:flex">
                <Link href="/dashboard/packs">
                  View All <IconArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4">
              {livePacks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active packs.</p>
              ) : (
                <div className="grid gap-4">
                  {livePacks.slice(0, 5).map((pack) => (
                    <div key={pack.id} className="flex items-center justify-between space-x-4 rounded-md border p-4">
                      <div className="flex flex-col space-y-1">
                        <span className="font-medium leading-none">{pack.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {pack.credits} Credits • ${(pack.price / 100).toFixed(2)}
                        </span>
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/dashboard/packs`}>Manage</Link>
                      </Button>
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
