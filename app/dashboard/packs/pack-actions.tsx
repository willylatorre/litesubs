'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconDotsVertical, IconCopy, IconExternalLink } from '@tabler/icons-react'
import { toast } from 'sonner'
import Link from 'next/link'

export function PackActions({ packId }: { packId: string }) {
    const copyLink = () => {
        const url = `${window.location.origin}/buy/${packId}`
        navigator.clipboard.writeText(url)
        toast.success("Link copied to clipboard")
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <span className="sr-only">Open menu</span>
                    <IconDotsVertical className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={copyLink}>
                    <IconCopy className="mr-2 h-4 w-4" />
                    Copy Link
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href={`/buy/${packId}`} target="_blank">
                        <IconExternalLink className="mr-2 h-4 w-4" />
                        View Public Page
                    </Link>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
