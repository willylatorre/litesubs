import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export type Invite = {
    id: string
    email?: string | null
    status: 'pending' | 'accepted' | 'rejected'
    createdAt: Date
    productId?: string
}

async function fetchInvites() {
    const res = await fetch("/api/invites")
    if (!res.ok) throw new Error("Failed to fetch invites")
    return res.json() as Promise<Invite[]>
}

async function createInvite(data: { email?: string; productId?: string }) {
    const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    })
    const json = await res.json()
    if (!res.ok) {
        throw new Error(json.error || "Failed to create invite")
    }
    return json
}

export function useInvites() {
    return useQuery({
        queryKey: ["invites"],
        queryFn: fetchInvites,
    })
}

export function useCreateInvite() {
    const queryClient = useQueryClient()
    const router = useRouter()

    return useMutation({
        mutationFn: createInvite,
        onSuccess: () => {
            toast.success("Invite sent!")
            queryClient.invalidateQueries({ queryKey: ["invites"] })
            router.refresh()
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })
}
