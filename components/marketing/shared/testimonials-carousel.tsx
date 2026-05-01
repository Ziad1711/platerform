'use client'

import useEmblaCarousel from 'embla-carousel-react'
import { motion } from 'framer-motion'

type Testimonial = {
  quote: string
  author: string
  role: string
}

type TestimonialsCarouselProps = {
  items: Testimonial[]
}

export function TestimonialsCarousel({ items }: TestimonialsCarouselProps) {
  const [emblaRef] = useEmblaCarousel({ loop: true, align: 'start' })

  return (
    <div className="overflow-hidden" ref={emblaRef}>
      <div className="flex gap-5">
        {items.map((item) => (
          <motion.div
            key={item.quote}
            whileHover={{ y: -4 }}
            className="min-w-0 flex-[0_0_88%] rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl sm:flex-[0_0_46%] lg:flex-[0_0_32%]"
          >
            <p className="text-base leading-8 text-jisra-cream/78">“{item.quote}”</p>
            <div className="mt-6 border-t border-white/10 pt-4">
              <p className="text-sm font-semibold text-jisra-cream">{item.author}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-jisra-cream/42">{item.role}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}