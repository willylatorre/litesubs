import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type Invite = {
	id: string;
	email: string | null;
	status: "pending" | "accepted" | "rejected";
	planId: string | null;
	compCredits: number;
	/** Present on the list response so a pending invite can be re-shared. */
	token?: string;
	/** Share URL: canonical once a username exists, legacy `/invite/:token` before. */
	url?: string | null;
	expiresAt?: string | Date | null;
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
	if (!res.ok) {
		const error = new Error(
			json.error || json.fieldErrors?.email?.[0] || "Failed to create invite",
		) as Error & { code?: string };
		// Callers branch on this, e.g. to offer the Account page when a public
		// link needs a username first.
		error.code = json.code;
		throw error;
	}
	return json as Invite & { token: string; url: string };
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
