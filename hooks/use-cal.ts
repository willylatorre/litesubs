import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type CalEventType = {
	id: number;
	slug: string;
	name: string;
	url: string;
};

export type CalEventTypeResponse = {
	connected: boolean;
	eventTypes: CalEventType[];
};

async function fetchCalEventTypes() {
	const res = await fetch("/api/integrations/cal/event-types");
	if (!res.ok) {
		throw new Error("Failed to fetch Cal.com event types");
	}
	return (await res.json()) as CalEventTypeResponse;
}

async function updateProductCalEventType({
	productId,
	eventType,
}: {
	productId: string;
	eventType: CalEventType | null;
}) {
	const res = await fetch(`/api/products/${productId}/cal-event-type`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			calEventTypeId: eventType?.id ?? null,
			calEventTypeSlug: eventType?.slug ?? null,
			calEventTypeName: eventType?.name ?? null,
			calEventTypeUrl: eventType?.url || null,
		}),
	});

	const json = await res.json();
	if (!res.ok) {
		throw new Error(json.error || "Failed to update Cal.com event type");
	}

	return json;
}

export function useCalEventTypes() {
	return useQuery({
		queryKey: ["cal-event-types"],
		queryFn: fetchCalEventTypes,
	});
}

export function useUpdateProductCalEventType() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: updateProductCalEventType,
		onSuccess: () => {
			toast.success("Cal.com event type updated");
			queryClient.invalidateQueries({ queryKey: ["products"] });
			queryClient.invalidateQueries({ queryKey: ["pack-details"] });
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});
}
