import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type PlanTermsClient = {
	id: string;
	billingMode: "one_time" | "recurring";
	interval: "month" | null;
	currency: string;
	price: number;
	credits: number;
	status: "draft" | "published" | "superseded";
	version: number;
	publishedAt: string | Date | null;
};

export type Plan = {
	id: string;
	name: string;
	description: string | null;
	createdAt: string | Date;
	updatedAt: string | Date;
	integrationId?: string | null;
	integration?: {
		id: string;
		type: "calcom";
		calcomIntegration?: {
			id: string;
			eventTypeId?: number | null;
			eventTypeSlug?: string | null;
			eventTypeName?: string | null;
			eventTypeUrl?: string | null;
		} | null;
	} | null;
	terms: PlanTermsClient | null;
	isDraft: boolean;
	enrollmentCount?: number;
};

export type PlanTermsPayload = {
	billingMode: "one_time" | "recurring";
	currency: "usd" | "eur";
	price: number;
	credits: number;
	interval: "month" | null;
};

async function fetchPlans() {
	const res = await fetch("/api/v1/plans");
	if (!res.ok) throw new Error("Failed to fetch plans");
	return res.json() as Promise<Plan[]>;
}

async function createPlan(data: {
	name: string;
	description?: string;
	terms: PlanTermsPayload;
}) {
	const res = await fetch("/api/v1/plans", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	const json = await res.json();
	if (!res.ok) {
		const field = Object.values(
			(json.fieldErrors ?? {}) as Record<string, string[]>,
		)[0]?.[0];
		throw new Error(
			json.error ||
				field ||
				json.details?.[0]?.message ||
				"Failed to create plan",
		);
	}
	return json as Plan;
}

async function updatePlan({
	id,
	...data
}: {
	id: string;
	name?: string;
	description?: string | null;
	terms?: Partial<PlanTermsPayload>;
}) {
	const res = await fetch(`/api/v1/plans/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	const json = await res.json();
	if (!res.ok) {
		const field = Object.values(
			(json.fieldErrors ?? {}) as Record<string, string[]>,
		)[0]?.[0];
		throw new Error(
			json.error ||
				field ||
				json.details?.[0]?.message ||
				"Failed to update plan",
		);
	}
	return json as Plan;
}

export function usePlans() {
	return useQuery({
		queryKey: ["plans"],
		queryFn: fetchPlans,
	});
}

export function useCreatePlan() {
	const queryClient = useQueryClient();
	const router = useRouter();

	return useMutation({
		mutationFn: createPlan,
		onSuccess: () => {
			toast.success("Draft plan created");
			queryClient.invalidateQueries({ queryKey: ["plans"] });
			router.refresh();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}

export function useUpdatePlan() {
	const queryClient = useQueryClient();
	const router = useRouter();

	return useMutation({
		mutationFn: updatePlan,
		onSuccess: () => {
			toast.success("Plan updated");
			queryClient.invalidateQueries({ queryKey: ["plans"] });
			queryClient.invalidateQueries({ queryKey: ["plan-details"] });
			router.refresh();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}
