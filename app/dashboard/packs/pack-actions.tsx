'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconDotsVertical, IconCopy, IconExternalLink, IconMailPlus } from '@tabler/icons-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { InviteUserDialog } from '../creator/invite-user-dialog'
import { useState } from 'react'

export function PackActions({ packId }: { packId: string }) {
    const [inviteOpen, setInviteOpen] = useState(false)

    return (
        <>
            <InviteUserDialog 
                open={inviteOpen} 
                onOpenChange={setInviteOpen} 
                defaultPackId={packId} 
            />
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Open menu</span>
                        <IconDotsVertical className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
                        <IconMailPlus className="mr-2 h-4 w-4" />
                        Generate Invite Link
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}
