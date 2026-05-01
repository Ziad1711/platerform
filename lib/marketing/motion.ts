import type { Variants } from 'framer-motion'

export const marketingEasing = [0.22, 1, 0.36, 1] as const
export const marketingExitEasing = [0.4, 0, 1, 1] as const

export const viewportOnce = {
  once: true,
  margin: '-100px',
} as const

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: marketingEasing },
  },
}

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.6, ease: marketingEasing },
  },
}

export const staggerContainer = (staggerChildren = 0.08, delayChildren = 0) =>
  ({
    hidden: {},
    visible: {
      transition: {
        staggerChildren,
        delayChildren,
      },
    },
  }) satisfies Variants

export const scaleBlurIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, filter: 'blur(12px)' },
  visible: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.8, ease: marketingEasing },
  },
}

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: marketingEasing },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.25, ease: marketingExitEasing },
  },
}

export const heroVisualFloat = {
  initial: { opacity: 0, scale: 0.92, rotateX: 12, rotateY: -10, y: 24 },
  animate: {
    opacity: 1,
    scale: 1,
    rotateX: 0,
    rotateY: 0,
    y: 0,
    transition: {
      duration: 1,
      ease: marketingEasing,
    },
  },
}