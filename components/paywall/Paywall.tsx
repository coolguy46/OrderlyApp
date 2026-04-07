'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Crown,
  CheckCircle2,
  Zap,
  Brain,
  Calendar,
  Target,
  GraduationCap,
  Timer,
  Bell,
  Sparkles,
  X,
  Star,
  Shield,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';

const FREE_FEATURES = [
  'Up to 50 tasks',
  'Basic study timer',
  'Goal tracking (3 goals)',
  'Calendar view',
  'Basic analytics',
];

const PRO_FEATURES = [
  'Unlimited tasks & goals',
  'AI Smart Scheduler',
  'Exam Prep (Flashcards & MCQs)',
  'File upload for study materials',
  'Resume / Portfolio tracker',
  'Desktop notifications',
  'SAT/ACT Prep tracker',
  'Advanced analytics',
  'Priority support',
  'Early access to new features',
];

const PLANS = [
  {
    id: 'monthly',
    label: 'Monthly',
    price: '$4.99',
    period: '/month',
    total: '$4.99/mo',
    badge: null,
    popular: false,
  },
  {
    id: 'yearly',
    label: 'Yearly',
    price: '$2.99',
    period: '/month',
    total: 'Billed $35.88/year',
    badge: 'Save 40%',
    popular: true,
  },
  {
    id: 'lifetime',
    label: 'Lifetime',
    price: '$29',
    period: ' one-time',
    total: 'Pay once, use forever',
    badge: 'Best Value',
    popular: false,
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

export function Paywall() {
  const [selectedPlan, setSelectedPlan] = useState('yearly');
  const [loading, setLoading] = useState(false);

  const handleUpgrade = () => {
    setLoading(true);
    // Simulate payment flow (replace with actual Stripe/payment integration)
    setTimeout(() => {
      setLoading(false);
      toast.success('🎉 Thank you! Payment integration coming soon.', {
        description: 'We\'ll notify you when Pro is available.',
      });
    }, 1500);
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="max-w-5xl mx-auto space-y-10 py-4"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/20 border border-amber-500/30 rounded-full text-amber-400 text-sm font-medium">
          <Crown className="w-4 h-4" />
          Orderly Pro
        </div>
        <h1 className="text-4xl font-bold font-display">Unlock Your Full Potential</h1>
        <p className="text-muted-foreground text-lg max-w-lg mx-auto">
          Supercharge your studies with AI scheduling, unlimited goals, and powerful exam prep tools.
        </p>
      </motion.div>

      {/* Plans */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {PLANS.map((plan) => (
          <motion.button
            key={plan.id}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setSelectedPlan(plan.id)}
            className={cn(
              'relative p-6 rounded-2xl border-2 text-left transition-all',
              selectedPlan === plan.id
                ? 'border-indigo-500 bg-indigo-500/10 shadow-lg shadow-indigo-500/20'
                : 'border-border hover:border-indigo-500/50 bg-card'
            )}
          >
            {plan.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className={cn(
                  'px-3 py-1 rounded-full text-xs font-bold',
                  plan.popular ? 'bg-indigo-500 text-white' : 'bg-amber-500 text-white'
                )}>
                  {plan.badge}
                </span>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{plan.label}</span>
                {selectedPlan === plan.id && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <CheckCircle2 className="w-5 h-5 text-indigo-400" />
                  </motion.div>
                )}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="text-muted-foreground text-sm">{plan.period}</span>
              </div>
              <p className="text-xs text-muted-foreground">{plan.total}</p>
            </div>
          </motion.button>
        ))}
      </motion.div>

      {/* CTA */}
      <motion.div variants={itemVariants} className="flex flex-col items-center gap-4">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleUpgrade}
          disabled={loading}
          className="flex items-center gap-3 px-10 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-lg rounded-2xl shadow-lg shadow-indigo-500/30 disabled:opacity-70 transition-all"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <Zap className="w-5 h-5" />
              </motion.div>
              Processing…
            </span>
          ) : (
            <>
              <Crown className="w-5 h-5" />
              Upgrade to Pro — {PLANS.find(p => p.id === selectedPlan)?.price}{PLANS.find(p => p.id === selectedPlan)?.period}
            </>
          )}
        </motion.button>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Shield className="w-3 h-3" /> 30-day money-back guarantee · Cancel anytime
        </p>
      </motion.div>

      {/* Feature comparison */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Free */}
        <div className="p-6 rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-2 mb-5">
            <div className="p-2 bg-muted rounded-xl"><Sparkles className="w-4 h-4 text-muted-foreground" /></div>
            <div>
              <h3 className="font-bold">Free Plan</h3>
              <p className="text-xs text-muted-foreground">Forever free</p>
            </div>
          </div>
          <div className="space-y-3">
            {FREE_FEATURES.map(f => (
              <div key={f} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pro */}
        <div className="p-6 rounded-2xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
          <div className="flex items-center gap-2 mb-5">
            <div className="p-2 bg-indigo-500/20 rounded-xl"><Crown className="w-4 h-4 text-amber-400" /></div>
            <div>
              <h3 className="font-bold flex items-center gap-1">Orderly Pro <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" /></h3>
              <p className="text-xs text-indigo-400">Everything in Free, plus:</p>
            </div>
          </div>
          <div className="space-y-3">
            {PRO_FEATURES.map(f => (
              <div key={f} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                <span className="text-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Feature highlights */}
      <motion.div variants={itemVariants}>
        <h2 className="text-xl font-bold text-center mb-6">Everything You Need to Succeed</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { icon: Brain, title: 'AI Scheduler', desc: 'Smart task scheduling based on your workload and exam dates', color: 'indigo' },
            { icon: GraduationCap, title: 'Exam Prep', desc: 'Flashcards, MCQ quizzes, and file uploads for every subject', color: 'purple' },
            { icon: Target, title: 'Unlimited Goals', desc: 'Track unlimited academic and personal goals with auto-tracking', color: 'blue' },
            { icon: Bell, title: 'Notifications', desc: 'Desktop reminders for tasks, exams, and study sessions', color: 'amber' },
            { icon: Calendar, title: 'AI Calendar', desc: 'Intelligent scheduling that adapts to your study patterns', color: 'green' },
            { icon: Clock, title: 'Timer Analytics', desc: 'Deep insights into your study habits and productivity', color: 'rose' },
          ].map(f => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="p-4 rounded-2xl border border-border bg-card hover:bg-muted/30 transition-colors">
                <div className={`p-2.5 rounded-xl bg-${f.color}-500/10 w-fit mb-3`}>
                  <Icon className={`w-5 h-5 text-${f.color}-400`} />
                </div>
                <h4 className="font-semibold text-sm">{f.title}</h4>
                <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Testimonials */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { name: 'Alex K.', major: 'Pre-Med', text: 'The exam prep flashcards saved my finals week. 10/10!' },
          { name: 'Sarah M.', major: 'Computer Science', text: 'AI scheduler helped me balance 5 courses and a job.' },
          { name: 'Jordan L.', major: 'Business', text: 'Finally hit my GPA goals with the goal auto-tracker.' },
        ].map(t => (
          <div key={t.name} className="p-5 rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-1 mb-3">
              {[...Array(5)].map((_, i) => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}
            </div>
            <p className="text-sm text-muted-foreground italic">"{t.text}"</p>
            <div className="mt-3">
              <p className="text-sm font-semibold">{t.name}</p>
              <p className="text-xs text-muted-foreground">{t.major}</p>
            </div>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
