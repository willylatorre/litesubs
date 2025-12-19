import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { authClient } from '../lib/auth-client'
import { Button } from '../components/ui/button'
import { CreditCard, CheckCircle2, Lock } from 'lucide-react'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [session, setSession] = useState(null)

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data } = await authClient.getSession()
        setSession(data)
      } catch (error) {
        console.error('Error checking session:', error)
      } finally {
        setIsLoading(false)
      }
    }

    checkSession()
  }, [])

  const handleGetStarted = async () => {
    if (session?.user) {
      await navigate({ to: '/dashboard' })
    } else {
      await navigate({ to: '/login' })
    }
  }

  const creditPacks = [
    {
      credits: 1,
      description: 'Perfect for trying out',
      popular: false,
    },
    {
      credits: 5,
      description: 'Great for small creators',
      popular: true,
    },
    {
      credits: 10,
      description: 'Best for growing teams',
      popular: false,
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Hero Section */}
      <section className="relative py-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10"></div>
        <div className="relative max-w-5xl mx-auto">
          <h1 className="text-6xl md:text-7xl font-black text-white mb-6 [letter-spacing:-0.02em]">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              LiteSubs
            </span>
          </h1>
          <p className="text-2xl md:text-3xl text-gray-300 mb-4 font-light">
            Simple credit packs for creators
          </p>
          <p className="text-lg text-gray-400 max-w-3xl mx-auto mb-12">
            Get instant access to credit packs powered by Stripe. Secure, fast, and completely transparent pricing.
          </p>
        </div>
      </section>

      {/* Credit Packs Section */}
      <section className="py-16 px-6 max-w-6xl mx-auto">
        <h2 className="text-4xl font-bold text-white text-center mb-12">
          Simple Pricing
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {creditPacks.map((pack) => (
            <div
              key={pack.credits}
              className={`relative rounded-xl p-8 transition-all duration-300 ${
                pack.popular
                  ? 'bg-gradient-to-br from-purple-900/50 to-blue-900/50 border-2 border-purple-500 shadow-xl shadow-purple-500/20 md:scale-105'
                  : 'bg-slate-800/50 backdrop-blur-sm border border-slate-700 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10'
              }`}
            >
              {pack.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                  Most Popular
                </div>
              )}
              <div className="flex items-center justify-center mb-6">
                <CreditCard className="w-12 h-12 text-purple-400" />
              </div>
              <h3 className="text-4xl font-bold text-white text-center mb-2">
                {pack.credits}
              </h3>
              <p className="text-gray-300 text-center mb-6 text-sm">
                {pack.description}
              </p>
              <div className="flex items-center justify-center gap-2 text-green-400 text-sm mb-8">
                <CheckCircle2 className="w-4 h-4" />
                <span>Instant delivery</span>
              </div>
              <div className="h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent mb-8"></div>
              <p className="text-gray-400 text-center text-sm">
                Pay what you need
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-6 max-w-6xl mx-auto">
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-8 md:p-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-400" />
                Completely Free
              </h3>
              <p className="text-gray-300 leading-relaxed">
                There are no hidden fees, monthly subscriptions, or surprise charges. You only pay for the credits you purchase.
              </p>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
                <Lock className="w-6 h-6 text-blue-400" />
                Powered by Stripe Connect
              </h3>
              <p className="text-gray-300 leading-relaxed">
                Your payments are processed through Stripe Connect with bank-level security. Your data is always protected and encrypted.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-gray-400 mb-8">
            Ready to get started? Choose a credit pack and start using LiteSubs today.
          </p>
          <Button
            onClick={handleGetStarted}
            disabled={isLoading}
            className="px-10 py-6 text-lg font-semibold bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-lg shadow-lg shadow-purple-500/30 transition-all duration-200 disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Get Started Now'}
          </Button>
          <p className="text-gray-500 text-sm mt-4">
            {session?.user ? 'Go to your dashboard' : 'Create an account or sign in'}
          </p>
        </div>
      </section>
    </div>
  )
}
