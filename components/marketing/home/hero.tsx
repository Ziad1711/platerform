'use client'

import { useEffect, useRef, useState } from 'react'
import { Calculator, Check, Maximize, Minimize, Pause, Play, Receipt, ShoppingCart, Sparkles, Truck, Volume2, VolumeX } from 'lucide-react'
import { motion } from 'framer-motion'
import { heroHighlights, logoMarquee, logoMarqueeNotice } from '@/lib/marketing/site'
import { Container } from '@/components/marketing/shared/container'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { MarqueeLogos } from '@/components/marketing/shared/marquee-logos'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { Spotlight } from '@/components/marketing/shared/spotlight'
import { fadeUp, heroVisualFloat } from '@/lib/marketing/motion'

const highlightIcons = [ShoppingCart, Receipt, Truck, Calculator]

export function HomeHero() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [isMuted, setIsMuted] = useState(true)
  const [isPaused, setIsPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const scheduleHide = (delay = 2500) => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), delay)
  }

  const revealControls = (autoHide = true) => {
    setControlsVisible(true)
    if (autoHide) scheduleHide()
  }

  useEffect(() => () => clearHideTimer(), [])

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const seekTo = (clientX: number) => {
    const video = videoRef.current
    const bar = barRef.current
    if (!video || !bar || !video.duration) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    video.currentTime = ratio * video.duration
    setProgress(ratio * 100)
  }

  const seekBy = (deltaSeconds: number) => {
    const video = videoRef.current
    if (!video || !video.duration) return
    const next = Math.min(video.duration, Math.max(0, video.currentTime + deltaSeconds))
    video.currentTime = next
    setProgress((next / video.duration) * 100)
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    const wrapper = wrapperRef.current
    if (wrapper?.requestFullscreen) {
      void wrapper.requestFullscreen()
      return
    }
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    video?.webkitEnterFullscreen?.()
  }

  const formatTime = (value: number) => {
    const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  return (
    <section className="relative overflow-hidden pb-0 pt-0 text-jisra-cream">
      <Spotlight />

      <Container className="relative z-10">
        <MotionSection withStagger className="grid items-center gap-6 pb-12 pt-8 max-sm:pt-5 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14 lg:py-20">
          <div className="max-lg:contents lg:space-y-8">
            <motion.div
              variants={fadeUp}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-jisra-cream/74 max-lg:order-1 max-lg:self-start max-sm:gap-1.5 max-sm:self-center max-sm:px-3 max-sm:py-1 max-sm:text-[9px] max-sm:tracking-[0.12em]"
            >
              <Sparkles className="h-5 w-5 shrink-0 text-jisra-green-light max-sm:h-3.5 max-sm:w-3.5 sm:h-3.5 sm:w-3.5" />
              <span className="max-sm:text-center">conçu pour les marchands marocains qui scalent</span>
            </motion.div>

            <motion.div variants={fadeUp} className="space-y-5 max-lg:order-2 max-sm:text-center">
              <h1 className="max-w-4xl text-balance text-[33px] font-extrabold leading-[1.06] tracking-[-0.04em] sm:text-[clamp(1.75rem,4.5vw,3.5rem)] sm:leading-[1.1]">
                Vos commandes, vos coûts et votre <span className="text-gradient-brand">profit</span> au même endroit.
              </h1>
              <p className="mx-auto max-w-2xl text-[13.5px] leading-[19px] text-jisra-cream/50 sm:text-lg sm:leading-8 sm:text-jisra-cream">
                Jisra centralise et automatise votre e-commerce grâce à l’intelligence artificielle, avec un suivi de vos performances en temps réel.
              </p>
            </motion.div>

            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3 max-lg:order-4 max-sm:justify-center">
              <MarketingLink href="/signup" className="max-sm:px-3 max-sm:text-[12px]">Commencer gratuitement</MarketingLink>
              <MarketingLink
                href="mailto:contact@jisra.io?subject=Demande%20de%20contact%20jisra"
                variant="ghost"
                className="max-sm:px-3 max-sm:text-[12px]"
              >
                Contactez-nous
              </MarketingLink>
            </motion.div>

            <motion.div variants={fadeUp} className="flex flex-col gap-2 max-lg:order-5 max-sm:items-center">
              {['Aucune carte bancaire requise', "Pas de limite de temps sur l'offre gratuite"].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-jisra-green/30 bg-jisra-green/10 max-sm:h-5 max-sm:w-5">
                    <Check className="h-2.5 w-2.5 text-jisra-green-light max-sm:h-3 max-sm:w-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span className="text-xs text-jisra-cream/60 max-sm:text-[13px] sm:text-sm">{item}</span>
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div variants={heroVisualFloat} initial="initial" animate="animate" className="relative will-change-transform max-lg:order-3">
            <div className="marketing-panel marketing-noise overflow-hidden p-3 sm:p-4">
              <div
                ref={wrapperRef}
                className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#0b100e]"
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') {
                    clearHideTimer()
                    setControlsVisible(true)
                  }
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse') {
                    clearHideTimer()
                    setControlsVisible(false)
                  }
                }}
                onFocus={() => {
                  clearHideTimer()
                  setControlsVisible(true)
                }}
                onBlur={() => {
                  clearHideTimer()
                  setControlsVisible(false)
                }}
              >
                <video
                  ref={videoRef}
                  className="aspect-[16/10] h-auto w-full rounded-[24px] object-cover"
                  poster="/marketing/hero-main.webp"
                  autoPlay
                  muted={isMuted}
                  loop
                  playsInline
                  preload="metadata"
                  aria-label="Aperçu animé du cockpit jisra montrant commandes, profit, publicité et livraison"
                  onClick={() => revealControls()}
                  onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                  onTimeUpdate={(event) => {
                    const video = event.currentTarget
                    if (!video.duration) return
                    setProgress((video.currentTime / video.duration) * 100)
                  }}
                  onPlay={() => setIsPaused(false)}
                  onPause={() => setIsPaused(true)}
                >
                  <source src="/marketing/hero-main.mp4" type="video/mp4" />
                </video>

                <div
                  className={`absolute inset-x-0 bottom-0 z-10 flex items-center gap-2.5 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-2.5 pt-10 transition-opacity duration-300 sm:gap-3 sm:px-4 sm:pb-3 ${
                    controlsVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      togglePlay()
                      scheduleHide()
                    }}
                    aria-label={isPaused ? 'Lire la vidéo' : 'Mettre la vidéo en pause'}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-jisra-cream backdrop-blur transition hover:bg-white/20"
                  >
                    {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </button>

                  <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-jisra-cream/70 sm:inline">
                    {formatTime((progress / 100) * duration)} / {formatTime(duration)}
                  </span>

                  <div
                    ref={barRef}
                    role="slider"
                    tabIndex={0}
                    aria-label="Progression de la vidéo"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress)}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      clearHideTimer()
                      setScrubbing(true)
                      seekTo(event.clientX)
                    }}
                    onPointerMove={(event) => {
                      if (scrubbing) seekTo(event.clientX)
                    }}
                    onPointerUp={() => {
                      setScrubbing(false)
                      scheduleHide()
                    }}
                    onPointerCancel={() => {
                      setScrubbing(false)
                      scheduleHide()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight') {
                        event.preventDefault()
                        seekBy(5)
                      }
                      if (event.key === 'ArrowLeft') {
                        event.preventDefault()
                        seekBy(-5)
                      }
                    }}
                    className="relative h-1.5 flex-1 cursor-pointer touch-none rounded-full bg-white/25"
                  >
                    <div className="absolute inset-y-0 left-0 rounded-full bg-jisra-green" style={{ width: `${progress}%` }} />
                    <span
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-jisra-cream shadow-[0_0_8px_rgba(0,0,0,0.45)]"
                      style={{ left: `${progress}%` }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsMuted((value) => !value)
                      scheduleHide()
                    }}
                    aria-label={isMuted ? 'Activer le son' : 'Couper le son'}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-jisra-cream backdrop-blur transition hover:bg-white/20"
                  >
                    {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      toggleFullscreen()
                      scheduleHide()
                    }}
                    aria-label={isFullscreen ? 'Quitter le plein écran' : 'Passer en plein écran'}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-jisra-cream backdrop-blur transition hover:bg-white/20"
                  >
                    {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div variants={fadeUp} className="grid gap-3 sm:grid-cols-2 max-lg:order-6 lg:col-span-2 lg:grid-cols-4">
            {heroHighlights.map((item, index) => {
              const Icon = highlightIcons[index]
              return (
                <div
                  key={item.title}
                  className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-jisra-green-light" aria-hidden="true" />
                    <p className="text-sm font-semibold text-jisra-cream">{item.title}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-jisra-cream/58">{item.description}</p>
                </div>
              )
            })}
          </motion.div>
        </MotionSection>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="space-y-3"
        >
          <p className="text-center text-sm leading-6 text-jisra-cream/62">{logoMarqueeNotice}</p>
          <MarqueeLogos items={logoMarquee} />
        </motion.div>
      </Container>
    </section>
  )
}