import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { claimInvite } from "@/app/actions/invites";
import { db } from "@/app/db";
import { invites } from "@/app/db/schema";
import { BuyButton } from "@/components/buy-button";
import { PackItem } from "@/components/pack-item";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";

export default async function InvitePage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;

	// Fetch invite with product and creator
	const invite = await db.query.invites.findFirst({
		where: eq(invites.token, token),
		with: {
			creator: true,
			product: true,
		},
	});

	if (!invite || invite.status !== "pending") {
		return notFound();
	}

	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (session?.user) {
		const result = await claimInvite(token);
		if (result.success) {
			redirect("/dashboard/subscriptions");
		}
		// If error (e.g. invite for another user), we stay here and show the page (which will likely show the mismatch info if I added it, or just the preview)
	}

	const isProductInvite = !!invite.product;

	return (
		<div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
			<div className="w-full max-w-md flex flex-col gap-6">
				{invite.email && (
					<div className="text-center text-sm text-muted-foreground bg-secondary/30 p-4 rounded-xl border border-secondary shadow-sm">
						Hello{" "}
						<span className="font-medium text-foreground">{invite.email}</span>,{" "}
						<span className="font-medium text-foreground">
							{invite.creator.name}
						</span>{" "}
						is inviting you to{" "}
						{isProductInvite ? "purchase this pack" : "connect"}.
					</div>
				)}

				{isProductInvite ? (
					<PackItem
						product={{
							name: invite.product!.name,
							credits: invite.product!.credits,
							price: invite.product!.price,
							description: invite.product!.description,
							badge: `Offered by ${invite.creator.name}`,
						}}
						creditsSuffix=" credits"
						session={session}
						loginUrl={`/auth/sign-up?callbackURL=/invite/${token}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`}
						action={
							<BuyButton
								productId={invite.product!.id}
								price={invite.product!.price}
								currency={invite.product!.currency}
							/>
						}
					/>
				) : (
					<Card className="shadow-xl border-0">
						<CardHeader>
							<CardTitle>You've been invited!</CardTitle>
							<CardDescription>
								<span className="font-medium text-foreground">
									{invite.creator.name}
								</span>{" "}
								has invited you to connect.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">
								Accept this invitation to connect with {invite.creator.name} and
								manage your credits.
							</p>
						</CardContent>
						<CardFooter>
							{session ? (
								<Button className="w-full" size="lg">
									Accept Invite
								</Button>
							) : (
								<div className="flex flex-col w-full gap-3">
									<Button className="w-full" size="lg" asChild>
										<Link
											href={`/auth/sign-up?callbackURL=/invite/${token}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`}
										>
											Create Account to Accept
										</Link>
									</Button>
									<div className="text-center text-sm text-muted-foreground">
										Already have an account?{" "}
										<Link
											href={`/auth/sign-in?callbackURL=/invite/${token}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`}
											className="underline hover:text-foreground"
										>
											Sign in
										</Link>
									</div>
								</div>
							)}
						</CardFooter>
					</Card>
				)}
			</div>
		</div>
	);
}
