import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { logUnexpectedError } from "@/lib/api-response";
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
	planInput,
	updatePlan,
	updatePlanInput,
} from "@/lib/services/plans";
import { type Principal, ServiceError } from "@/lib/services/principal";

export function createServer(principal: Principal) {
	const server = new McpServer({ name: "litesubs", version: "1.0.0" });
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
		"List your plans. Prices returned in minor units (cents). Paginate with limit/offset.",
		pageInput,
		true,
		(input) => listPlans(principal, input),
	);
	register(
		"get_plan",
		"Get your plan by ID or exact name. Ambiguous names require an ID. Prices returned in cents.",
		z.object({ plan: z.string().min(1) }),
		true,
		({ plan }) => getPlan(principal, plan),
	);
	register(
		"create_plan",
		"Create a one-time credit plan. Input price is major units (10 means $10); returned price is cents. Does not enroll or bill anyone.",
		planInput,
		false,
		(input) => createPlan(principal, input),
	);
	register(
		"update_plan",
		"Update your plan by ID/exact name, including active status. Changes apply to future purchases, not existing credit balances. Input price is major units.",
		z.object({ plan: z.string().min(1), changes: updatePlanInput }),
		false,
		({ plan, changes }) => updatePlan(principal, plan, changes),
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
		"Enroll a student in your plan. Default invoice returns a checkout link (credits only after payment). Explicit comp grants plan credits and requires reason; repeat comps are rejected. If no account exists, returns invited plus a claim link, not a completed enrollment. NO EMAIL IS SENT: the creator must forward the link. Comp credits are granted once on claim.",
		enrollmentInput,
		false,
		(input) => enrollCustomer(principal, input),
	);
	register(
		"grant_credits",
		"Grant positive credits to a specific enrolled customer and plan. reason appears in their ledger. dry_run previews the before/after balance. Optional idempotency_key makes retries safe. No refunds through this API.",
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
