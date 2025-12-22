import { db } from '@/app/db'
import { invites } from '@/app/db/schema'
import { auth } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { BuyButton } from '@/components/buy-button'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    
    // Fetch invite with product and creator
    const invite = await db.query.invites.findFirst({
        where: eq(invites.token, token),
        with: {
            creator: true,
            product: true
        }
    })

    if (!invite || invite.status !== 'pending') {
        return notFound()
    }

    const session = await auth.api.getSession({
        headers: await headers()
    })

    const isProductInvite = !!invite.product

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader>
                    <CardTitle className="text-2xl">
                        {isProductInvite ? invite.product!.name : "You've been invited!"}
                    </CardTitle>
                    <CardDescription>
                        {isProductInvite 
                            ? <span>Offered by <span className="font-medium text-foreground">{invite.creator.name}</span></span>
                            : <span><span className="font-medium text-foreground">{invite.creator.name}</span> has invited you to connect.</span>
                        }
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6">
                    {invite.email && (
                         <div className="text-center text-sm text-muted-foreground bg-secondary/30 p-2 rounded-md">
                            Hello <span className="font-medium text-foreground">{invite.email}</span>, {invite.creator.name} is inviting you to {isProductInvite ? "purchase this pack" : "connect"}.
                        </div>
                    )}

                    {isProductInvite ? (
                        <>
                            <div className="rounded-lg bg-secondary/50 p-4 flex flex-col gap-1 text-center">
                                <span className="text-muted-foreground text-sm uppercase tracking-wider font-semibold">Credits</span>
                                <span className="text-4xl font-bold">{invite.product!.credits}</span>
                            </div>
                            
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">Price</span>
                                    <span className="font-bold text-lg">${(invite.product!.price / 100).toFixed(2)}</span>
                                </div>
                                {invite.product!.description && (
                                    <p className="text-sm text-muted-foreground border-t pt-2">
                                        {invite.product!.description}
                                    </p>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="text-center text-muted-foreground py-4">
                            Accept this invitation to connect with {invite.creator.name} and manage your credits.
                        </div>
                    )}
                </CardContent>
                <CardFooter>
                    {session ? (
                         isProductInvite ? (
                             <BuyButton productId={invite.product!.id} price={invite.product!.price} />
                         ) : (
                             <Button className="w-full" size="lg">Accept Invite</Button>
                             // TODO: Implement accept invite action for non-product invites if needed
                         )
                    ) : (
                        <div className="flex flex-col w-full gap-3">
                            <Button className="w-full" size="lg" asChild>
                                <Link href={`/auth/sign-up?callbackURL=/invite/${token}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ''}`}>
                                    Create Account to Accept
                                </Link>
                            </Button>
                             <div className="text-center text-sm text-muted-foreground">
                                Already have an account?{" "}
                                <Link href={`/auth/sign-in?callbackURL=/invite/${token}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ''}`} className="underline hover:text-foreground">
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
