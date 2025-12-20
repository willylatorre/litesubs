'use client'

import { respondToInvite } from "@/app/actions/invites"
import { Button } from "@/components/ui/button"
import { IconCheck, IconX } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

export function PendingInviteActions({ inviteId }: { inviteId: string }) {
  const [loading, setLoading] = useState(false)

  const handleResponse = async (accept: boolean) => {
    setLoading(true)
    try {
      const result = await respondToInvite(inviteId, accept)
      if (result.success) {
        toast.success(accept ? "Invite accepted!" : "Invite rejected.")
      } else {
        toast.error(result.error || "Failed to respond.")
      }
    } catch (error) {
      toast.error("An error occurred.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Button 
        size="sm" 
        variant="outline" 
        onClick={() => handleResponse(false)} 
        disabled={loading}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <IconX className="size-4 mr-1" />
        Reject
      </Button>
      <Button 
        size="sm" 
        onClick={() => handleResponse(true)} 
        disabled={loading}
      >
        <IconCheck className="size-4 mr-1" />
        Accept
      </Button>
    </div>
  )
}
