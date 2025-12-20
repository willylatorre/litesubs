
import { getUserSubscriptions } from "@/app/actions/dashboard"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { IconShoppingCart } from "@tabler/icons-react"

export default async function SubscriptionsPage() {
    const subscriptions = await getUserSubscriptions()

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Active Subscriptions</h1>
                    <p className="text-muted-foreground text-sm">Manage your credits and purchase new packs.</p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {subscriptions.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-card text-muted-foreground">
                        <p>You don't have any active subscriptions or credits yet.</p>
                    </div>
                ) : (
                    subscriptions.map((sub) => (
                        <Card key={sub.id} className="flex flex-col">
                            <CardHeader>
                                <CardTitle>{sub.creator?.name || "Unknown Creator"}</CardTitle>
                                <CardDescription>
                                    Current Balance: <span className="font-semibold text-foreground">{sub.credits} Credits</span>
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1">
                                <h4 className="mb-2 text-sm font-medium leading-none">Available Packs</h4>
                                {sub.packs.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No packs available from this creator at the moment.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {sub.packs.map((pack) => (
                                            <div key={pack.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{pack.name}</span>
                                                    <span className="text-muted-foreground">{pack.credits} Credits • ${(pack.price / 100).toFixed(2)}</span>
                                                </div>
                                                <Button asChild size="sm" variant="secondary">
                                                    <Link href={`/buy/${pack.id}`}>
                                                        Buy
                                                    </Link>
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    )
}
