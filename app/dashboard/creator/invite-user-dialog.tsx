'use client'

import { createInvite } from "@/app/actions/invites"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IconMailPlus } from "@tabler/icons-react"
import { useActionState, useEffect, useState } from "react"
import { toast } from "sonner"

const initialState = {
  error: '',
  success: false,
  message: ''
}

export function InviteUserDialog() {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState(createInvite, initialState)

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message)
      setOpen(false)
    } else if (state?.error) {
        toast.error(state.error)
    }
  }, [state])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <IconMailPlus className="mr-2 size-4" />
          Invite Customer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Invite Customer</DialogTitle>
          <DialogDescription>
            Invite a user via email to connect with your creator profile.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right">
              Email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              className="col-span-3"
              placeholder="user@example.com"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
