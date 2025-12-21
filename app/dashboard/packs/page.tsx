'use client'

import { useProducts } from "@/hooks/use-products"
import { CreatePackDialog } from "./create-pack-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { PackActions } from "./pack-actions"
import { Skeleton } from "@/components/ui/skeleton"

export default function PacksPage() {
    const { data: packs, isLoading, isError } = useProducts()

    if (isError) {
        return <div className="p-6 text-red-500">Failed to load packs.</div>
    }

    return (
         <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
             <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Packs</h1>
                    <p className="text-muted-foreground text-sm">Manage the credit packs you offer to your customers.</p>
                </div>
                <CreatePackDialog />
             </div>
             
             <div className="rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Credits</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[50px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[50px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[20px] ml-auto" /></TableCell>
                                </TableRow>
                            ))
                        ) : packs?.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                    No packs created yet. Click "Create Pack" to get started.
                                </TableCell>
                            </TableRow>
                        ) : (
                            packs?.map((pack) => (
                                <TableRow key={pack.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col">
                                            <span>{pack.name}</span>
                                            {pack.description && (
                                                <span className="text-xs text-muted-foreground">{pack.description}</span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>${(pack.price / 100).toFixed(2)}</TableCell>
                                    <TableCell>{pack.credits}</TableCell>
                                    <TableCell>
                                        <Badge variant={pack.active ? "default" : "secondary"}>
                                            {pack.active ? "Active" : "Disabled"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <PackActions packId={pack.id} />
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
             </div>
         </div>
    )
}
