import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type Invite = {
	id: string;
	email: string | null;
	status: "pending" | "accepted" | "rejected";
	planId: string | null;
	compCredits: number;
	createdAt: string | Date;
	plan?: { id: string; name: string } | null;
};

async function fetchInvites() {
	const res = await fetch("/api/v1/invites");
	if (!res.ok) throw new Error("Failed to fetch invites");
	return res.json() as Promise<Invite[]>;
}

async function createInvite(data: { email?: string; planId?: string }) {
	const res = await fetch("/api/v1/invites", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	const json = await res.json();
	if (!res.ok)
		throw new Error(
			json.error || json.fieldErrors?.email?.[0] || "Failed to create invite",
		);
	return json as Invite & { token: string };
}

export function useInvites() {
	return useQuery({
		queryKey: ["invites"],
		queryFn: fetchInvites,
	});
}

export function useCreateInvite() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: createInvite,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["invites"] });
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}
