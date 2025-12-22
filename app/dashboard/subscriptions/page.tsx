import { IconAlertCircle, IconShoppingCart } from "@tabler/icons-react";
import Link from "next/link";
import { getUserSubscriptions } from "@/app/actions/dashboard";
import { getUserPendingInvites } from "@/app/actions/invites";
import { BuyButton } from "@/components/buy-button";
import { PackItem } from "@/components/pack-item";
import { PendingInviteActions } from "@/components/pending-invite-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export default async function SubscriptionsPage() {
	const [subscriptions, pendingInvites] = await Promise.all([
		getUserSubscriptions(),
		getUserPendingInvites(),
	]);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">
						Active Subscriptions
					</h1>
					<p className="text-muted-foreground text-sm">
						Manage your credits and purchase new packs.
					</p>
				</div>
			</div>

			{/* Pending Invites Section */}
			{pendingInvites.length > 0 && (
				<Card className="border-primary/20 bg-primary/5">
					<CardHeader>
						<CardTitle className="text-lg">Pending Invites</CardTitle>
						<CardDescription>
							You have been invited to connect with these creators.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4">
						{pendingInvites.map((invite) => (
							<div
								key={invite.id}
								className="flex items-center justify-between rounded-md border bg-card p-4"
							>
								<div className="flex flex-col">
									<span className="font-medium text-base">
										{invite.creator.name}
									</span>
									{invite.product ? (
										<span className="text-sm text-foreground">
											Invited you to purchase{" "}
											<span className="font-semibold">
												{invite.product.name}
											</span>
										</span>
									) : (
										<span className="text-sm text-muted-foreground">
											Invited you to connect
										</span>
									)}
									<span className="text-xs text-muted-foreground">
										Sent on {new Date(invite.createdAt).toLocaleDateString()}
									</span>
								</div>
								<PendingInviteActions inviteId={invite.id} />
							</div>
						))}
					</CardContent>
				</Card>
			)}

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
									Current Balance:{" "}
									<span className="font-semibold text-foreground">
										{sub.credits} Credits
									</span>
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 space-y-4">
								{sub.credits < 2 && (
									<Alert
										variant="default"
										className="bg-primary/5 border-primary/20"
									>
										<IconAlertCircle className="size-4" />
										<AlertTitle>Low Credits</AlertTitle>
										<AlertDescription>
											You have less than 2 credits left. Please buy a pack below
											to add more credits.
										</AlertDescription>
									</Alert>
								)}
								<div>
									<h4 className="mb-2 text-sm font-medium leading-none">
										Available Packs
									</h4>
									{sub.packs.length === 0 ? (
										<p className="text-sm text-muted-foreground">
											No packs available from this creator at the moment.
										</p>
									) : (
										<div className="space-y-2">
											{sub.packs.map((pack) => (
												<PackItem
													key={pack.id}
													product={{
														name: pack.name,
														credits: pack.credits,
														price: pack.price,
														description: pack.description,
													}}
													action={
														<BuyButton productId={pack.id} price={pack.price} />
													}
												/>
											))}
										</div>
									)}
								</div>
							</CardContent>
						</Card>
					))
				)}
			</div>
		</div>
	);
}
