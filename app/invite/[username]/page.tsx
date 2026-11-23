import { eq } from "drizzle-orm";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/app/db";
import { invites } from "@/app/db/schema";
import { AnimatedLogo } from "@/components/animated-logo";
import { PlanCard } from "@/components/plan-card";
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
import { invitePath } from "@/lib/public-links";
import { AcceptInviteButton } from "./accept-invite-button";

// 1. Data Access Layer & Caching
export const getInvite = cache(async (token: string) => {
	return db.query.invites.findFirst({
		where: eq(invites.token, token),
		with: {
			creator: true,
			plan: {
				with: {
					versions: { orderBy: (version, { desc }) => [desc(version.version)] },
				},
			},
		},
	});
});

export async function generateMetadata({
	params,
}: {
	params: Promise<{ username: string }>;
}): Promise<Metadata> {
	// One-segment legacy URLs carry the token in this segment.
	const { username: token } = await params;
	const invite = await getInvite(token);

	if (!invite) {
		return {
			title: "Invite Not Found | liteSubs",
			description: "This invite link is invalid or has expired.",
		};
	}

	const published = invite.plan?.versions.find(
		(version) => version.status === "published",
	);
	if (invite.plan && published) {
		return {
			title: `${invite.plan.name} by ${invite.creator.name} | liteSubs`,
			description: `Get ${published.credits} credits for ${published.price / 100} ${published.currency.toUpperCase()}.`,
		};
	}

	return {
		title: `Invite from ${invite.creator.name} | liteSubs`,
		description: `${invite.creator.name} has invited you to connect on liteSubs.`,
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
	path,
	session,
}: {
	creatorName: string;
	token: string;
	path: string;
	session: Awaited<ReturnType<typeof auth.api.getSession>>;
}) {
	const loginUrl = `/auth/sign-in?callbackURL=${encodeURIComponent(path)}`;
	const signUpUrl = `/auth/sign-up?callbackURL=${encodeURIComponent(path)}`;

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
	canonicalized = false,
}: {
	params: Promise<{ username: string }>;
	/** Internal: the username parent already validated the canonical path. */
	canonicalized?: boolean;
}) {
	// One-segment legacy URLs carry the token in this segment.
	const { username: token } = await params;

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
	if (!canonicalized && invite.creator.username) {
		redirect(invitePath(invite.creator.username, token));
	}
	const path = invite.creator.username
		? invitePath(invite.creator.username, token)
		: `/invite/${token}`;

	// Logic for "Accepted" or "Expired" states
	if (invite.status === "accepted") {
		if (session?.user?.email && invite.email === session.user.email) {
			return <InviteAcceptedState />;
		}
		return <InviteExpiredState />;
	}

	// Only published terms are offered. A draft cannot be resurrected by an
	// invite that was generated earlier.
	const published = invite.plan?.versions.find(
		(version) =>
			version.status === "published" &&
			(!invite.planVersionId || version.id === invite.planVersionId),
	);
	const isProductInvite = Boolean(invite.plan && published);
	const complimentary = invite.compCredits > 0;

	// The invite email is personal data: only reveal it to the signed-in user it
	// was addressed to, never to anyone holding the link.
	const canSeeInviteEmail = Boolean(
		invite.email && session?.user?.email === invite.email,
	);

	// The address on an invite is a convenience, not a permission: it puts the
	// invite in the dashboard of whoever registered with it. Holding the link is
	// what authorizes acceptance, so any signed-in account may accept it.

	return (
		<div className="min-h-screen flex flex-col items-center justify-center p-6 gap-8 bg-muted/30">
			{/* Header Section */}
			<div className="flex flex-col items-center gap-4 text-center max-w-xl">
				<AnimatedLogo />
				<p className="text-base md:text-lg text-muted-foreground">
					Simple credit plans instead of heavy subscriptions. Creators sell
					one-time packs or monthly allowances through their own Stripe account.
				</p>
			</div>

			{/* Invite Message & Card */}
			<div className="w-full max-w-md flex flex-col gap-6">
				<div className="text-center space-y-2">
					<p className="text-lg text-foreground">
						<span className="font-semibold">{invite.creator.name}</span> has
						invited you to{" "}
						{complimentary
							? "receive complimentary credits"
							: isProductInvite
								? "buy their plan"
								: "connect"}
						.
					</p>
					{canSeeInviteEmail && invite.email && (
						<p className="text-sm text-muted-foreground">
							Invitation for <span className="font-medium">{invite.email}</span>
						</p>
					)}
				</div>

				{isProductInvite && invite.plan && published ? (
					<PlanCard
						product={{
							name: invite.plan.name,
							credits: complimentary ? invite.compCredits : published.credits,
							price: complimentary ? 0 : published.price,
							description: invite.plan.description,
							badge: complimentary
								? `Complimentary · ${invite.creator.name}`
								: `Offered by ${invite.creator.name}`,
							currency: published.currency,
							billingMode: complimentary ? undefined : published.billingMode,
							interval: complimentary ? null : published.interval,
						}}
						productId={invite.plan.id}
						creditsSuffix={complimentary ? " credits on claim" : " credits"}
						session={session}
						loginUrl={`/auth/sign-up?callbackURL=${encodeURIComponent(path)}`}
						action={
							<div className="flex flex-col gap-2">
								{complimentary && invite.compExpiresAt && (
									<p className="text-xs text-muted-foreground text-center">
										Granted once. Usable until{" "}
										{new Date(invite.compExpiresAt).toLocaleDateString()}.
									</p>
								)}
								{session?.user ? (
									<AcceptInviteButton
										token={token}
										label={
											complimentary
												? "Claim complimentary credits"
												: "Accept & Add to Dashboard"
										}
										className="w-full"
									/>
								) : undefined}
							</div>
						}
					/>
				) : (
					<GenericInviteCard
						creatorName={invite.creator.name}
						token={token}
						path={path}
						session={session}
					/>
				)}

				<div className="flex items-center justify-center gap-2 text-muted-foreground/60">
					<Lock className="size-3" />
					<span className="text-xs font-medium">
						Payments are processed securely through Stripe on the creator's own
						account. We do not store or process your card details.
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
