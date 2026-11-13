/**
 * Shared shape for the customer dashboard. Kept free of server imports so both
 * the server component and the client refresh path can map rows identically.
 */
import type { SubscriptionCancellationCause } from "@/lib/subscription-state";

export type PlanTermsView = {
	billingMode: "one_time" | "recurring";
	interval: "month" | null;
	currency: string;
	price: number;
	credits: number;
};

export type EnrollmentView = {
	id: string;
	credits: number;
	subscription: {
		id: string;
		status: "pending" | "incomplete" | "active" | "past_due" | "canceled";
		paidThroughAt: Date | null;
		cancelAtPeriodEnd: boolean;
		cancelAt: Date | null;
		cancellationCause: SubscriptionCancellationCause | null;
		canManageBilling: boolean;
		overdue: boolean;
		terms: PlanTermsView;
	} | null;
	plan: {
		id: string;
		name: string;
		description: string | null;
		terms: PlanTermsView | null;
		calEventTypeName?: string | null;
	};
	creator: { name: string } | null;
};

export type InviteView = {
	id: string;
	plan: {
		name: string;
		description: string | null;
		terms: PlanTermsView | null;
		calEventTypeName?: string | null;
	} | null;
	creator: { name: string };
	/** A complimentary invite grants credits on claim; it is not a purchase. */
	compCredits: number;
	compExpiresAt: Date | null;
	expiresAt: Date;
};

export type DashboardView = {
	stats: { money: MoneyView[]; enrollmentCount: number };
	enrollments: EnrollmentView[];
	pendingInvites: InviteView[];
};

/** Money is always grouped by currency; never a single blended total. */
export type MoneyView = {
	currency: string;
	gross: number;
	refunded: number;
	net: number;
};

export type PlanVersionRow = {
	billingMode: "one_time" | "recurring";
	interval: "month" | null;
	currency: string;
	price: number;
	credits: number;
	status: "draft" | "published" | "superseded";
};

/** The terms a customer actually bought, never the creator's current draft. */
export function publishedTerms<T extends PlanVersionRow>(
	versions: T[] | undefined,
): PlanTermsView | null {
	const published = versions?.find((version) => version.status === "published");
	if (!published) return null;
	return {
		billingMode: published.billingMode,
		interval: published.interval,
		currency: published.currency,
		price: published.price,
		credits: published.credits,
	};
}

type RawPlan = {
	id: string;
	name: string;
	description: string | null;
	versions?: PlanVersionRow[];
	integration?: {
		calcomIntegration?: { eventTypeName?: string | null } | null;
	} | null;
};

export function toDashboardView(raw: {
	stats: { money: MoneyView[]; enrollmentCount: number };
	enrollments: {
		id: string;
		credits: number;
		plan: RawPlan;
		creator: { name: string } | null;
	}[];
	pendingInvites: {
		id: string;
		plan: RawPlan | null;
		creator: { name: string };
		compCredits: number;
		compExpiresAt: Date | null;
		expiresAt: Date;
	}[];
	subscriptions: {
		planId: string;
		id: string;
		status: "pending" | "incomplete" | "active" | "past_due" | "canceled";
		paidThroughAt: Date | null;
		cancelAtPeriodEnd: boolean;
		cancelAt: Date | null;
		cancellationCause: SubscriptionCancellationCause | null;
		canManageBilling: boolean;
		overdue: boolean;
		planVersion: PlanTermsView;
	}[];
}): DashboardView {
	return {
		stats: {
			money: raw.stats.money,
			enrollmentCount: raw.stats.enrollmentCount,
		},
		enrollments: raw.enrollments.map((enrollment) => ({
			id: enrollment.id,
			credits: enrollment.credits,
			subscription: (() => {
				const subscription = raw.subscriptions.find(
					(item) => item.planId === enrollment.plan.id,
				);
				return subscription
					? {
							id: subscription.id,
							status: subscription.status,
							paidThroughAt: subscription.paidThroughAt,
							cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
							cancelAt: subscription.cancelAt,
							cancellationCause: subscription.cancellationCause,
							canManageBilling: subscription.canManageBilling,
							overdue: subscription.overdue,
							terms: subscription.planVersion,
						}
					: null;
			})(),
			plan: {
				id: enrollment.plan.id,
				name: enrollment.plan.name,
				description: enrollment.plan.description,
				terms: publishedTerms(enrollment.plan.versions),
				calEventTypeName:
					enrollment.plan.integration?.calcomIntegration?.eventTypeName,
			},
			creator: enrollment.creator ? { name: enrollment.creator.name } : null,
		})),
		pendingInvites: raw.pendingInvites.map((invite) => ({
			id: invite.id,
			plan: invite.plan
				? {
						name: invite.plan.name,
						description: invite.plan.description,
						terms: publishedTerms(invite.plan.versions),
						calEventTypeName:
							invite.plan.integration?.calcomIntegration?.eventTypeName,
					}
				: null,
			creator: { name: invite.creator.name },
			compCredits: invite.compCredits,
			compExpiresAt: invite.compExpiresAt,
			expiresAt: invite.expiresAt,
		})),
	};
}
