import { db } from '@/app/db'
import { products } from '@/app/db/schema'
import { auth } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { BuyButton } from './buy-button'

export default async function BuyPackPage({ params }: { params: Promise<{ packId: string }> }) {
    const { packId } = await params
    
    // Fetch product
    const product = await db.query.products.findFirst({
        where: eq(products.id, packId),
        with: {
            creator: true
        }
    })

    if (!product || !product.active) {
        return notFound()
    }

    const session = await auth.api.getSession({
        headers: await headers()
    })

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader>
                    <CardTitle className="text-2xl">{product.name}</CardTitle>
                    <CardDescription>
                        Offered by <span className="font-medium text-foreground">{product.creator.name}</span>
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6">
                    <div className="rounded-lg bg-secondary/50 p-4 flex flex-col gap-1 text-center">
                        <span className="text-muted-foreground text-sm uppercase tracking-wider font-semibold">Credits</span>
                        <span className="text-4xl font-bold">{product.credits}</span>
                    </div>
                    
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Price</span>
                            <span className="font-bold text-lg">${(product.price / 100).toFixed(2)}</span>
                        </div>
                        {product.description && (
                             <p className="text-sm text-muted-foreground border-t pt-2">
                                {product.description}
                            </p>
                        )}
                    </div>
                </CardContent>
                <CardFooter>
                    {session ? (
                        <BuyButton productId={product.id} price={product.price} />
                    ) : (
                        <div className="flex flex-col w-full gap-3">
                            <Button className="w-full" size="lg" asChild>
                                <Link href={`/auth/sign-up?callbackURL=/buy/${packId}`}>
                                    Create Account to Buy
                                </Link>
                            </Button>
                             <div className="text-center text-sm text-muted-foreground">
                                Already have an account?{" "}
                                <Link href={`/auth/sign-in?callbackURL=/buy/${packId}`} className="underline hover:text-foreground">
                                    Sign in
                                </Link>
                            </div>
                        </div>
                    )}
                </CardFooter>
            </Card>
        </div>
    )
}
