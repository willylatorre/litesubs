'use client'

import { updateCustomerCredits } from '@/app/actions/customers'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { IconAdjustments } from '@tabler/icons-react'

export function ManageCreditsDialog({ userId, customerName, currentCredits }: { userId: string, customerName: string, currentCredits: number }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      const val = parseInt(amount)
      if (isNaN(val) || val === 0) {
          toast.error("Please enter a valid non-zero amount")
          return
      }

      startTransition(async () => {
          const res = await updateCustomerCredits(userId, val, description)
          if (res.success) {
              toast.success("Credits updated")
              setOpen(false)
              setAmount('')
              setDescription('')
          } else {
              toast.error(res.error as string)
          }
      })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IconAdjustments className="mr-2 h-4 w-4" />
          Adjust
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Manage Credits</DialogTitle>
            <DialogDescription>
              Adjust credits for {customerName}. Current balance: {currentCredits}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (Positive to add, Negative to remove)</Label>
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 50 or -20"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Reason</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Refund, Bonus"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
