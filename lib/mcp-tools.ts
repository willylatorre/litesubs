import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { logUnexpectedError } from "@/lib/api-response";
import { createPlanSchema, updatePlanSchema } from "@/lib/schemas";
import { changeCredits, creditInput } from "@/lib/services/credits";
import {
	getCustomer,
	listCustomers,
	listTransactions,
} from "@/lib/services/customers";
import {
	createInvite,
	enrollCustomer,
	enrollmentInput,
	listInvites,
} from "@/lib/services/enroll";
import {
	createPlan,
	getPlan,
	listPlans,
	pageInput,
	updatePlan,
} from "@/lib/services/plans";
import { type Principal, ServiceError } from "@/lib/services/principal";
import {
	publishInput,
	publishPlan,
	unpublishInput,
	unpublishPlan,
} from "@/lib/services/publish";
import {
	createEndpoint,
	deleteEndpoint,
	listDeliveries,
	listEndpoints,
	retryDelivery,
	sendTestEvent,
	updateEndpoint,
} from "@/lib/services/webhooks";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhook-events";

/**
 * Server-level guidance, sent in the initialize response. Clients surface this
 * to the model once, so it carries the cross-tool rules that a per-tool
 * description cannot: the order of operations and the units trap.
 * Keep the first paragraph self-contained; some clients truncate.
 */
const instructions = `liteSubs manages credit plans. A plan is a service with commercial terms: credits at a price, either one-time or monthly. An enrollment ties one customer to one plan and holds that customer's balance for it. Typical order: create_plan, enroll_customer, then grant_credits if needed.

Rules worth repeating: a new plan starts as a draft with no published terms, and a draft cannot be enrolled or purchased. Publishing requires a payment-ready connected Stripe account; use publish_plan (or the dashboard) and it provisions the Product/Price on the creator's account. Publishing new terms supersedes the previous version while existing customers keep theirs; unpublish_plan stops new sales and needs confirm: true. Plan prices in create_plan/update_plan are major units (10 means $10), while responses return minor units (cents). Published terms are immutable: editing terms replaces the draft only, and already-sold credits do not change. Monthly plans are subscriptions, not top-ups: the customer authorizes the monthly price and each confirmed paid invoice grants a non-rolling allowance. consume_credits requires an idempotency_key built from the business event, not a timestamp, and is unavailable to OAuth connections (it needs an API key). enroll_customer defaults to invoice mode and returns a payment link; credits arrive only after payment, and no email is sent, so forward the link yourself. Comp enrollment requires a reason and cannot be repeated for an existing enrollment. Complimentary or manually added credits on a monthly plan inherit the current paid period and need expires_at when no period is paid; one-time credits do not expire. create_invite produces a claimable link for someone without an account; its email is optional and only makes the invite appear in that person's dashboard, so it does not restrict who may accept. Outgoing webhooks (create_webhook and friends) need an https receiver and return their signing secret once; use send_test_webhook before relying on them. No payout, refund, or billing-charge tools exist.`;

export function createServer(principal: Principal) {
	const server = new McpServer(
		{ name: "litesubs", version: "1.0.0" },
		{ instructions },
	);
	function register<S extends z.ZodRawShape>(
		name: string,
		description: string,
		schema: z.ZodObject<S>,
		readOnly: boolean,
		execute: (input: z.output<z.ZodObject<S>>) => Promise<unknown>,
	) {
		server.registerTool(
			name,
			{
				description,
				inputSchema: schema,
				annotations: {
					readOnlyHint: readOnly,
					destructiveHint: !readOnly,
					openWorldHint: name === "enroll_customer",
				},
			},
			async (input) => {
				try {
					const data = await execute(schema.parse(input));
					return { content: [{ type: "text", text: JSON.stringify(data) }] };
				} catch (error) {
					const details =
						error instanceof ServiceError
							? {
									code: error.code,
									message: error.message,
									details: error.details,
								}
							: error instanceof z.ZodError
								? {
										code: "INVALID_INPUT",
										message: "Invalid input",
										details: error.flatten(),
									}
								: { code: "INTERNAL_ERROR", message: "Operation failed" };
					if (
						!(error instanceof ServiceError) &&
						!(error instanceof z.ZodError)
					)
						logUnexpectedError(`MCP tool failed: ${name}`, error);
					return {
						isError: true,
						content: [{ type: "text", text: JSON.stringify(details) }],
					};
				}
			},
		);
	}
	// `consume_credits` is offered to any credential that holds the scope, not
	// only to machine keys. OAuth is still refused it at the service layer,
	// because the credential that spends money should be one a teacher can name
	// and revoke on its own.
	if (principal.scopes.includes("credits:consume")) {
		register(
			"consume_credits",
			"Deduct credits for a service. Requires a stable idempotency_key unique per logical event; reuse it on retries. A different payload with the same key is rejected. reason appears in the customer ledger. dry_run previews without writing. No refunds through this API.",
			creditInput.extend({ idempotency_key: z.string().min(1).max(200) }),
			false,
			(input) => changeCredits(principal, input, "usage"),
		);
	}

	// Without a creator scope there is nothing else to expose; the service layer
	// would refuse every remaining tool anyway.
	const creatorScopes = principal.scopes.filter(
		(scope) => scope !== "credits:consume",
	);
	if (creatorScopes.length === 0) return server;
	register(
		"list_plans",
		"List your plans with their draft or published terms. Prices are in minor units (cents). Drafts cannot be purchased. Paginate with limit/offset.",
		pageInput,
		true,
		(input) => listPlans(principal, input),
	);
	register(
		"get_plan",
		"Get your plan by ID or exact name, including its current terms and whether it is still a draft. Ambiguous names require an ID.",
		z.object({ plan: z.string().min(1) }),
		true,
		({ plan }) => getPlan(principal, plan),
	);
	register(
		"create_plan",
		"Create a plan draft with its commercial terms. price is in major units (10 means $10); responses return cents. billingMode one_time or recurring; recurring requires interval month. Does not contact Stripe, enroll, or bill anyone.",
		createPlanSchema,
		false,
		(input) => createPlan(principal, input),
	);
	register(
		"update_plan",
		"Edit the service name/description or replace the draft commercial terms. Published terms are immutable and already-sold customers keep theirs. Input price is in major units.",
		z.object({ plan: z.string().min(1), changes: updatePlanSchema }),
		false,
		({ plan, changes }) => updatePlan(principal, plan, changes),
	);
	register(
		"publish_plan",
		"Publish the draft as the plan's sellable offer. Requires a payment-ready connected Stripe account; the Product/Price are created on the creator's account. Publishing new terms supersedes the previous version, which existing customers keep. Safe to retry: a repeat call returns already_published instead of creating a second offer.",
		publishInput,
		false,
		(input) => publishPlan(principal, input),
	);
	register(
		"unpublish_plan",
		"Stop new sales for a published plan. Existing customers, purchases, and subscriptions are unaffected; the terms remain readable. Requires confirm: true because it ends the offer. Re-publishing later creates a new version.",
		unpublishInput,
		false,
		(input) => unpublishPlan(principal, input),
	);
	register(
		"list_customers",
		"List only customers enrolled with you, with per-plan usable credit balances and monthly subscription status/paid-through data where applicable. `money` is confirmed receipts grouped by currency (gross, refunded, net); manual grants are never money. Paginate with limit/offset.",
		pageInput,
		true,
		(input) => listCustomers(principal, input),
	);
	register(
		"get_customer",
		"Get your enrolled customer by ID, email, or exact name, with usable per-plan credits and monthly subscription overdue/paid-through state. `money` is confirmed receipts from this customer grouped by currency (gross, refunded, net), never a blend of currencies. Ambiguous names return candidates; never guess.",
		z.object({ customer: z.string().min(1) }),
		true,
		({ customer }) => getCustomer(principal, customer),
	);
	register(
		"enroll_customer",
		"Enroll a customer in a published plan. Default invoice returns a Checkout link (one-time payment or monthly subscription; credits are granted only after the signed Stripe fulfillment event). Explicit comp requires a reason and grants the plan version's current credits once. On a recurring plan the comp inherits the current paid period; with no paid period, expires_at is required. If no account exists, returns invited plus a claim link, not a completed enrollment. NO EMAIL IS SENT: the creator must forward the link.",
		enrollmentInput,
		false,
		(input) => enrollCustomer(principal, input),
	);
	register(
		"grant_credits",
		"Grant positive credits to a specific enrolled customer and published plan. reason appears in their ledger. One-time credits do not expire; recurring credits inherit the current paid period and need expires_at when no period is paid. dry_run previews the before/after balance. Optional idempotency_key makes retries safe. No refunds through this API.",
		creditInput,
		false,
		(input) => changeCredits(principal, input, "manual_adjustment"),
	);
	register(
		"list_transactions",
		"Read your credit/payment ledger. Optional customer/plan filters use exact names, emails or IDs. Paginate with limit/offset.",
		pageInput.extend({
			customer: z.string().optional(),
			plan: z.string().optional(),
		}),
		true,
		(input) => listTransactions(principal, input),
	);

	// Invites: REST and MCP expose the same two operations. An invite is how a
	// customer who has no account yet gets a claimable link, so an assistant that
	// cannot invite can only work with people who already signed up.
	register(
		"list_invites",
		"List the invites you have issued, newest first, with the plan each offers and whether it is still pending. Paginate with limit/offset. Invite links are personal: do not post them publicly.",
		pageInput,
		true,
		(input) => listInvites(principal, input),
	);
	register(
		"create_invite",
		"Create a claimable invite link for a customer. planId offers that plan's published terms; omit it for a plain 'connect with me' invite. email is optional and only makes the invite appear in that person's dashboard — it does not restrict who may accept the link. Returns the URL; NO EMAIL IS SENT, so forward it yourself. Asking twice for the same email and plan returns the existing link instead of a second one.",
		z.object({
			email: z.email().optional(),
			planId: z.string().optional(),
		}),
		false,
		(input) => createInvite(principal, input),
	);

	// Outgoing webhooks: the only way a creator learns about credit changes
	// without polling, so an assistant needs them to build anything reactive.
	register(
		"list_webhooks",
		"List your outgoing webhook endpoints. Signing secrets are never returned here; the secret is shown once when the endpoint is created.",
		z.object({}),
		true,
		() => listEndpoints(principal),
	);
	register(
		"create_webhook",
		"Register an HTTPS endpoint to receive signed events. events is one or both of purchase.completed and credits.changed; max 2. Returns the signing secret ONCE, so store it immediately — it cannot be read again. The URL must be public https (loopback may use http).",
		z.object({
			name: z.string().trim().min(1).max(120),
			url: z.string().trim().max(2000),
			events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(2),
		}),
		false,
		(input) => createEndpoint(principal, input),
	);
	register(
		"update_webhook",
		"Rename, re-point, re-subscribe, or enable/disable an endpoint. Supply only the fields to change. Setting a new URL does not rotate the signing secret.",
		z.object({
			endpointId: z.string().min(1),
			name: z.string().trim().min(1).max(120).optional(),
			url: z.string().trim().max(2000).optional(),
			events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(2).optional(),
			active: z.boolean().optional(),
		}),
		false,
		({ endpointId, ...changes }) =>
			updateEndpoint(principal, endpointId, changes),
	);
	register(
		"delete_webhook",
		"Delete an endpoint and its delivery history. Requires confirm: true because the endpoint stops receiving events immediately and cannot be restored.",
		z.object({ endpointId: z.string().min(1), confirm: z.literal(true) }),
		false,
		({ endpointId }) => deleteEndpoint(principal, endpointId),
	);
	register(
		"list_webhook_deliveries",
		"Read delivery history for your endpoints, newest first, including failures with their HTTP status so a broken receiver can be diagnosed. Paginate with limit/offset.",
		pageInput,
		true,
		(input) => listDeliveries(principal, input),
	);
	register(
		"retry_webhook_delivery",
		"Re-send one recorded delivery. Safe to retry: the receiver is expected to deduplicate on the event id in the payload.",
		z.object({ deliveryId: z.string().min(1) }),
		false,
		({ deliveryId }) => retryDelivery(principal, deliveryId),
	);
	register(
		"send_test_webhook",
		"Send a sample credits.changed event to one endpoint so the receiver's signature verification and parsing can be proven before real events depend on it.",
		z.object({ endpointId: z.string().min(1) }),
		false,
		({ endpointId }) => sendTestEvent(principal, endpointId),
	);
	return server;
}
