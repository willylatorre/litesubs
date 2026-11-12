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
import { enrollCustomer, enrollmentInput } from "@/lib/services/enroll";
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

/**
 * Server-level guidance, sent in the initialize response. Clients surface this
 * to the model once, so it carries the cross-tool rules that a per-tool
 * description cannot: the order of operations and the units trap.
 * Keep the first paragraph self-contained; some clients truncate.
 */
const instructions = `Litesubs manages credit plans. A plan is a service with commercial terms: credits at a price, either one-time or monthly. An enrollment ties one customer to one plan and holds that customer's balance for it. Typical order: create_plan, enroll_customer, then grant_credits if needed.

Rules worth repeating: a new plan starts as a draft with no published terms, and a draft cannot be enrolled or purchased. Publishing requires a payment-ready connected Stripe account; use publish_plan (or the dashboard) and it provisions the Product/Price on the creator's account. Publishing new terms supersedes the previous version while existing customers keep theirs; unpublish_plan stops new sales and needs confirm: true. Plan prices in create_plan/update_plan are major units (10 means $10), while responses return minor units (cents). Published terms are immutable: editing terms replaces the draft only, and already-sold credits do not change. consume_credits requires an idempotency_key built from the business event, not a timestamp, and is unavailable to OAuth connections (it needs an API key). enroll_customer defaults to invoice mode and returns a payment link; credits arrive only after payment, and no email is sent, so forward the link yourself. Comp enrollment requires a reason and cannot be repeated for an existing enrollment. No payout, refund, or billing-charge tools exist.`;

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
	if (principal.kind === "apiKey") {
		register(
			"consume_credits",
			"Deduct credits for a service. Requires a stable idempotency_key unique per logical event; reuse it on retries. A different payload with the same key is rejected. reason appears in the customer ledger. dry_run previews without writing. No refunds through this API.",
			creditInput.extend({ idempotency_key: z.string().min(1).max(200) }),
			false,
			(input) => changeCredits(principal, input, "usage"),
		);
		return server;
	}
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
		"List only customers enrolled with you, with per-plan credit balances. Paginate with limit/offset.",
		pageInput,
		true,
		(input) => listCustomers(principal, input),
	);
	register(
		"get_customer",
		"Get your enrolled customer by ID, email, or exact name. Ambiguous names return candidates; never guess.",
		z.object({ customer: z.string().min(1) }),
		true,
		({ customer }) => getCustomer(principal, customer),
	);
	register(
		"enroll_customer",
		"Enroll a customer in a published plan. Default invoice returns a checkout link (credits only after payment). Explicit comp grants the published terms' credits and requires reason; repeat comps are rejected. If no account exists, returns invited plus a claim link, not a completed enrollment. NO EMAIL IS SENT: the creator must forward the link.",
		enrollmentInput,
		false,
		(input) => enrollCustomer(principal, input),
	);
	register(
		"grant_credits",
		"Grant positive credits to a specific enrolled customer and published plan. reason appears in their ledger. dry_run previews the before/after balance. Optional idempotency_key makes retries safe. No refunds through this API.",
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
	return server;
}
