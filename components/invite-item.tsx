"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PackItem } from "@/components/pack-item"
import { Button } from "@/components/ui/button"
import { respondToInvite } from "@/app/actions/invites"
import { toast } from "sonner"

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

    // Map invite product to PackItemProduct
    const product = invite.product ? {
        name: invite.product.name,
        credits: invite.product.credits,
        price: invite.product.price,
        description: invite.product.description,
        badge: "Invite",
        currency: invite.product.currency
    } : {
        name: "Connection Invite",
        credits: 0,
        price: 0,
        description: `Invite from ${invite.creator.name}`,
        badge: "Invite",
        currency: "usd"
    }

    return (
        <div className="relative group animate-in fade-in zoom-in duration-300">
            <PackItem
                product={product}
                creatorName={invite.creator.name}
                creditsSuffix="credits in the pack"
                action={(
                    <div className="flex gap-2 w-full">
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleRespond(false)}
                            disabled={isLoading || isPending}
                            className="flex-1"
                        >
                            Reject
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleRespond(true)}
                            disabled={isLoading || isPending}
                            className="flex-1"
                        >
                            Accept
                        </Button>
                        
                    </div>
                )}
                className="border-primary/20 bg-primary/5 pt-8"
            />
        </div>
    )
}
