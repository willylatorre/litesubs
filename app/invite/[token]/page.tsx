import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/app/db";
import { invites } from "@/app/db/schema";
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
import { AcceptInviteButton } from "./accept-invite-button";

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

	if (!invite) {
		return notFound();
	}

	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (invite.status === "accepted") {
		if (session?.user?.email && invite.email === session.user.email) {
			return (
				<div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
					<Card className="max-w-md w-full shadow-xl border-0">
						<CardHeader>
							<CardTitle>Invite Accepted</CardTitle>
							<CardDescription>
								You have already accepted this invitation.
							</CardDescription>
						</CardHeader>
						<CardFooter>
							<Button className="w-full" size="lg" asChild>
								<Link href="/dashboard">Go to Dashboard</Link>
							</Button>
						</CardFooter>
					</Card>
				</div>
			);
		}
		
		return (
			<div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
				<Card className="max-w-md w-full shadow-xl border-0">
					<CardHeader>
						<CardTitle>Invite Expired</CardTitle>
						<CardDescription>
							This invitation link has already been claimed.
						</CardDescription>
					</CardHeader>
					<CardFooter>
						<Button className="w-full" size="lg" variant="outline" asChild>
							<Link href="/">Go Home</Link>
						</Button>
					</CardFooter>
				</Card>
			</div>
		);
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
							currency: invite.product!.currency,
						}}
						productId={invite.product!.id}
						creditsSuffix=" credits"
						session={session}
						loginUrl={`/auth/sign-up?callbackURL=/invite/${token}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`}
						action={
							session?.user ? (
								<AcceptInviteButton
									token={token}
									label="Accept & Add to Dashboard"
									className="w-full"
								/>
							) : undefined
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
							{session?.user ? (
								<AcceptInviteButton token={token} className="w-full" />
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
