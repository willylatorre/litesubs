import { getCreatorStats } from "@/app/actions/dashboard"
import { SectionCards } from "@/components/section-cards"
import { CreatePackDialog } from "../packs/create-pack-dialog"
import { InviteUserDialog } from "./invite-user-dialog"
import { RecentInvites } from "./recent-invites"
import { LivePacks } from "./live-packs"

export default async function CreatorDashboardPage() {
  const stats = await getCreatorStats()

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="flex items-center justify-between px-4 lg:px-6">
             <h1 className="text-2xl font-bold tracking-tight">Creator Dashboard</h1>
             <div className="flex gap-2">
                 <InviteUserDialog />
                 <CreatePackDialog />
             </div>
        </div>

        <SectionCards 
          totalRevenue={stats.totalRevenue} 
          activeProducts={stats.activeProducts} 
          totalCustomers={stats.totalCustomers} 
        />
        
        <div className="grid gap-4 px-4 lg:px-6 lg:grid-cols-2">
          {/* Live Packs Section */}
          <LivePacks />

           {/* Recent Invites Section */}
           <RecentInvites />
        </div>
      </div>
    </div>
  )
}
