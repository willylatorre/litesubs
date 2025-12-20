'use client'

import { createProduct, type ProductActionState } from '@/app/actions/products'
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
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'

const initialState: ProductActionState = {
  error: '',
  fieldErrors: {},
  success: false,
}

export function CreatePackDialog() {
  const [open, setOpen] = useState(false)
  const [state, action, isPending] = useActionState(createProduct, initialState)

  useEffect(() => {
    if (state?.success) {
      setOpen(false)
      toast.success('Pack created successfully')
    } else if (state?.error) {
      toast.error(state.error as string)
    }
  }, [state])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Pack
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Create Pack</DialogTitle>
            <DialogDescription>
              Create a new credit pack for your customers.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Starter Pack"
                required
              />
              {state?.fieldErrors?.name && (
                <p className="text-sm text-red-500">
                  {state.fieldErrors.name[0]}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Optional description..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="price">Price ($)</Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="10.00"
                  required
                />
                {state?.fieldErrors?.price && (
                  <p className="text-sm text-red-500">
                    {state.fieldErrors.price[0]}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="credits">Credits</Label>
                <Input
                  id="credits"
                  name="credits"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="100"
                  required
                />
                {state?.fieldErrors?.credits && (
                  <p className="text-sm text-red-500">
                    {state.fieldErrors.credits[0]}
                  </p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Pack
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
