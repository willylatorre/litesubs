import { getCreatorStats } from "@/app/actions/dashboard"
import { getCreatorInvites } from "@/app/actions/invites"
import { getCreatorProducts } from "@/app/actions/products"
import { SectionCards } from "@/components/section-cards"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { IconArrowRight } from "@tabler/icons-react"
import { CreatePackDialog } from "../packs/create-pack-dialog"
import { InviteUserDialog } from "./invite-user-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PackItem } from "@/components/pack-item"

export default async function CreatorDashboardPage() {
  const [stats, products, invites] = await Promise.all([
    getCreatorStats(),
    getCreatorProducts(),
    getCreatorInvites(),
  ])

  const livePacks = products.filter((p) => p.active)

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
          <Card className="flex flex-col">
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
                    <PackItem
                      key={pack.id}
                      product={{
                        name: pack.name,
                        credits: pack.credits,
                        price: pack.price,
                        description: pack.description,
                        badge: "Active"
                      }}
                      action={
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/dashboard/packs`}>Manage</Link>
                        </Button>
                      }
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

           {/* Recent Invites Section */}
           <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="grid gap-1">
                <CardTitle>Recent Invites</CardTitle>
                <CardDescription>Invitations sent to potential customers.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4">
               <Table>
                   <TableHeader>
                       <TableRow>
                           <TableHead>Email</TableHead>
                           <TableHead>Status</TableHead>
                           <TableHead className="text-right">Date</TableHead>
                       </TableRow>
                   </TableHeader>
                   <TableBody>
                       {invites.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={3} className="text-center text-muted-foreground">
                                    No invites sent yet.
                                </TableCell>
                            </TableRow>
                       ) : (
                           invites.slice(0, 5).map((invite) => (
                               <TableRow key={invite.id}>
                                   <TableCell className="font-medium">{invite.email}</TableCell>
                                   <TableCell>
                                       <Badge variant={invite.status === 'accepted' ? 'default' : invite.status === 'rejected' ? 'destructive' : 'secondary'}>
                                           {invite.status}
                                       </Badge>
                                   </TableCell>
                                   <TableCell className="text-right text-muted-foreground text-sm">
                                       {new Date(invite.createdAt).toLocaleDateString()}
                                   </TableCell>
                               </TableRow>
                           ))
                       )}
                   </TableBody>
               </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
