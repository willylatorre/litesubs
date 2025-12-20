'use client'

import { createCheckoutSession } from '@/app/actions/stripe'
import { Button } from '@/components/ui/button'
import { useTransition } from 'react'

export function BuyButton({ productId, price }: { productId: string, price: number }) {
    const [isPending, startTransition] = useTransition()

    return (
        <Button 
            className="w-full" 
            size="lg" 
            onClick={() => startTransition(() => createCheckoutSession(productId))}
            disabled={isPending}
        >
            {isPending ? 'Processing...' : `Proceed to Payment ($${(price / 100).toFixed(2)})`}
        </Button>
    )
}
