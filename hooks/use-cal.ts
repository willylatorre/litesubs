import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setPlanCalEventType } from "@/app/actions/plan-integration";

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

export function useCalEventTypes() {
	return useQuery({
		queryKey: ["cal-event-types"],
		queryFn: fetchCalEventTypes,
	});
}

export function useUpdatePlanCalEventType() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			planId,
			eventType,
		}: {
			planId: string;
			eventType: CalEventType | null;
		}) => setPlanCalEventType(planId, eventType),
		onSuccess: () => {
			toast.success("Cal.com event type updated");
			queryClient.invalidateQueries({ queryKey: ["plans"] });
			queryClient.invalidateQueries({ queryKey: ["plan-details"] });
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}
