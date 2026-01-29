import { eq } from "drizzle-orm";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/app/db";
import { invites } from "@/app/db/schema";
import { AnimatedLogo } from '@/components/animated-logo'
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

// 1. Data Access Layer & Caching
const getInvite = cache(async (token: string) => {
	return db.query.invites.findFirst({
		where: eq(invites.token, token),
		with: {
			creator: true,
			product: true,
		},
	});
});

export async function generateMetadata({
	params,
}: {
	params: Promise<{ token: string }>;
}): Promise<Metadata> {
	const { token } = await params;
	const invite = await getInvite(token);

	if (!invite) {
		return {
			title: "Invite Not Found | LiteSubs",
			description: "This invite link is invalid or has expired.",
		};
	}

	if (invite.product) {
		return {
			title: `${invite.product.name} by ${invite.creator.name} | LiteSubs`,
			description: `Get ${invite.product.credits} credits for ${
				invite.product.price / 100
			} ${invite.product.currency.toUpperCase()}.`,
		};
	}

	return {
		title: `Invite from ${invite.creator.name} | LiteSubs`,
		description: `${invite.creator.name} has invited you to connect on LiteSubs.`,
	};
}

// 2. Extracted Components for Modularity

function InviteAcceptedState() {
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

function InviteExpiredState() {
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

function GenericInviteCard({
	creatorName,
	token,
	email,
	session,
}: {
	creatorName: string;
	token: string;
	email: string | null;
	session: any;
}) {
	const loginUrl = `/auth/sign-in?callbackURL=/invite/${token}${
		email ? `&email=${encodeURIComponent(email)}` : ""
	}`;
	const signUpUrl = `/auth/sign-up?callbackURL=/invite/${token}${
		email ? `&email=${encodeURIComponent(email)}` : ""
	}`;

	return (
		<Card className="shadow-xl border-0">
			<CardHeader>
				<CardTitle>You've been invited!</CardTitle>
				<CardDescription>
					<span className="font-medium text-foreground">{creatorName}</span> has
					invited you to connect.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-sm text-muted-foreground">
					Accept this invitation to connect with {creatorName} and manage your
					credits.
				</p>
			</CardContent>
			<CardFooter>
				{session?.user ? (
					<AcceptInviteButton token={token} className="w-full" />
				) : (
					<div className="flex flex-col w-full gap-3">
						<Button className="w-full" size="lg" asChild>
							<Link href={signUpUrl}>Create Account to Accept</Link>
						</Button>
						<div className="text-center text-sm text-muted-foreground">
							Already have an account?{" "}
							<Link href={loginUrl} className="underline hover:text-foreground">
								Sign in
							</Link>
						</div>
					</div>
				)}
			</CardFooter>
		</Card>
	);
}

// 3. Main Component with Parallel Fetching
export default async function InvitePage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;

	// Parallel fetching: Invite data and User Session
	const [invite, session] = await Promise.all([
		getInvite(token),
		auth.api.getSession({
			headers: await headers(),
		}),
	]);

	if (!invite) {
		return notFound();
	}

	// Logic for "Accepted" or "Expired" states
	if (invite.status === "accepted") {
		// If logged in and the invite belongs to this user, show "Already Accepted"
		if (session?.user?.email && invite.email === session.user.email) {
			return <InviteAcceptedState />;
		}
		// Otherwise, it's expired/claimed by someone else
		return <InviteExpiredState />;
	}

	const isProductInvite = !!invite.product;

	return (
		<div className="min-h-screen flex flex-col items-center justify-center p-6 gap-8 bg-muted/30">
			{/* Header Section */}
			<div className="flex flex-col items-center gap-4 text-center max-w-xl">

				<AnimatedLogo />
				<p className="text-base md:text-lg text-muted-foreground">
				Simple credit plans instead of heavy subscriptions. Sell one-time credit bundles or set up auto-refill credits, both in one simple system.
				</p>
			</div>

			{/* Invite Message & Card */}
			<div className="w-full max-w-md flex flex-col gap-6">
				<div className="text-center space-y-2">
					<p className="text-lg text-foreground">
						<span className="font-semibold">{invite.creator.name}</span> has
						invited you to {isProductInvite ? "buy their plan" : "connect"}.
					</p>
					{invite.email && (
						<p className="text-sm text-muted-foreground">
							Invitation for <span className="font-medium">{invite.email}</span>
						</p>
					)}
				</div>

				{isProductInvite && invite.product ? (
					<PackItem
						product={{
							name: invite.product.name,
							credits: invite.product.credits,
							price: invite.product.price,
							description: invite.product.description,
							badge: `Offered by ${invite.creator.name}`,
							currency: invite.product.currency,
							eventTypeName:
								invite.product.integration?.calcomIntegration?.eventTypeName,
						}}
						productId={invite.product.id}
						creditsSuffix=" credits"
						session={session}
						loginUrl={`/auth/sign-up?callbackURL=/invite/${token}${
							invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""
						}`}
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
					<GenericInviteCard
						creatorName={invite.creator.name}
						token={token}
						email={invite.email}
						session={session}
					/>
				)}

				<div className="flex items-center justify-center gap-2 text-muted-foreground/60">
					<Lock className="size-3" />
					<span className="text-xs font-medium">
					All payments are securely processed through Stripe, a trusted and PCI-DSS compliant payment provider. We do not store or process your credit card information. Your payment details are encrypted and handled directly by Stripe.
					</span>
				</div>
			</div>

			{/* Footer */}
			<footer className="mt-8 text-center text-sm text-muted-foreground">
				<Link href="https://litesubs.com" className="hover:underline">
					litesubs.com
				</Link>
			</footer>
		</div>
	);
}
