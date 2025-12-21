import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export type Product = {
    id: string
    name: string
    description: string
    price: number
    credits: number
    active: boolean
    createdAt: Date
    updatedAt: Date
}

async function fetchProducts() {
    const res = await fetch("/api/products")
    if (!res.ok) throw new Error("Failed to fetch products")
    return res.json() as Promise<Product[]>
}

async function createProduct(data: { name: string; description?: string; price: number; credits: number }) {
    const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    })
    const json = await res.json()
    if (!res.ok) {
        throw new Error(json.error || json.fieldErrors?.name?.[0] || "Failed to create product")
    }
    return json
}

async function updateProductStatus({ id, active }: { id: string; active: boolean }) {
    const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || "Failed to update status")
    return json
}

export function useProducts() {
    return useQuery({
        queryKey: ["products"],
        queryFn: fetchProducts,
    })
}

export function useCreateProduct() {
    const queryClient = useQueryClient()
    const router = useRouter()

    return useMutation({
        mutationFn: createProduct,
        onSuccess: () => {
            toast.success("Pack created successfully")
            queryClient.invalidateQueries({ queryKey: ["products"] })
            router.refresh()
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })
}

export function useUpdateProductStatus() {
    const queryClient = useQueryClient()
    const router = useRouter()

    return useMutation({
        mutationFn: updateProductStatus,
        onSuccess: () => {
            toast.success("Product status updated")
            queryClient.invalidateQueries({ queryKey: ["products"] })
            router.refresh()
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })
}
