"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PackItem } from "@/components/pack-item"
import { Button } from "@/components/ui/button"
import { respondToInvite } from "@/app/actions/invites"
import { createCheckoutSession } from "@/app/actions/stripe"
import { toast } from "sonner"
import { Check, X } from "lucide-react"

export function InviteItem({ invite }: { invite: any }) {
    const [isLoading, setIsLoading] = useState(false)
    const [isPending, startTransition] = useTransition()
    const router = useRouter()

    const handleRespond = async (accept: boolean) => {
        setIsLoading(true)
        try {
            const result = await respondToInvite(invite.id, accept)
            if (result.error) {
                toast.error(result.error)
            } else {
                toast.success(accept ? "Invite accepted" : "Invite declined")
                router.refresh()
            }
        } catch (error) {
            toast.error("Something went wrong")
        } finally {
            setIsLoading(false)
        }
    }

    const handleBuy = async () => {
         setIsLoading(true)
         
         startTransition(async () => {
             try {
                 // Auto-claim first
                 const claimResult = await respondToInvite(invite.id, true)
                 if (claimResult.error) {
                     toast.error("Failed to claim invite before purchase")
                     setIsLoading(false)
                     return
                 }
                 
                 // Then checkout
                 if (invite.product) {
                     await createCheckoutSession(invite.product.id)
                 } else {
                     toast.error("No product linked to this invite")
                     setIsLoading(false)
                 }
             } catch (error) {
                 toast.error("Failed to initiate purchase")
                 setIsLoading(false)
             }
         })
    }

    // Map invite product to PackItemProduct
    const product = invite.product ? {
        name: invite.product.name,
        credits: invite.product.credits,
        price: invite.product.price,
        description: invite.product.description,
        badge: "Invite"
    } : {
        name: "Connection Invite",
        credits: 0,
        price: 0,
        description: `Invite from ${invite.creator.name}`,
        badge: "Invite"
    }

    const formattedPrice = invite.product ? new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: (invite.product.currency || "usd").toUpperCase(),
	}).format(invite.product.price / 100) : "";

    return (
        <div className="relative group animate-in fade-in zoom-in duration-300">
            {/* Overlay buttons */}
            <div className="absolute -top-3 right-4 z-10 flex gap-2">
                 <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 rounded-full bg-background border-green-500/50 text-green-600 hover:bg-green-50 hover:border-green-600 shadow-sm"
                    onClick={() => handleRespond(true)}
                    disabled={isLoading || isPending}
                    title="Accept Invite"
                >
                    <Check className="h-4 w-4" />
                </Button>
                <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 rounded-full bg-background border-red-200 text-red-400 hover:bg-red-50 hover:text-red-500 hover:border-red-300 shadow-sm"
                    onClick={() => handleRespond(false)}
                    disabled={isLoading || isPending}
                    title="Decline Invite"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <PackItem
                product={product}
                action={
                    invite.product ? (
                        <Button 
                            className="w-full" 
                            size="lg"
                            onClick={handleBuy}
                            disabled={isLoading || isPending}
                        >
                            {isLoading || isPending ? "Processing..." : `Buy & Join (${formattedPrice})`}
                        </Button>
                    ) : (
                        <Button 
                            className="w-full" 
                            onClick={() => handleRespond(true)}
                            disabled={isLoading || isPending}
                        >
                            Accept
                        </Button>
                    )
                }
                className="border-primary/20 bg-primary/5 pt-8"
            />
        </div>
    )
}
