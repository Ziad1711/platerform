import type { Variants } from 'framer-motion'
import { marketingEasing } from '@/lib/marketing/motion'

export const nodeReveal: Variants = {
  hidden: { opacity: 0, scale: 0.85, filter: 'blur(10px)', y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    y: 0,
    transition: { 
      duration: 0.5, 
      ease: [0.22, 1, 0.36, 1], // Custom overshoot-ish easing
    },
  },
}

export const connectionDraw: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: 1, ease: "easeInOut" },
      opacity: { duration: 0.3 },
    },
  },
}

export const nodePulse: Variants = {
  idle: { boxShadow: '0 0 0 rgba(31, 169, 113, 0)' },
  pulse: {
    boxShadow: [
      '0 0 0 rgba(31, 169, 113, 0)',
      '0 0 20px rgba(31, 169, 113, 0.15), 0 0 40px rgba(31, 169, 113, 0.05)',
      '0 0 0 rgba(31, 169, 113, 0)',
    ],
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
  },
}

export const branchConnect: Variants = {
  hidden: { opacity: 0, scaleY: 0, transformOrigin: 'top' },
  visible: {
    opacity: 1,
    scaleY: 1,
    transition: { duration: 0.6, ease: marketingEasing },
  },
}

export const reducedMotionVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
}
