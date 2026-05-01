"use client";

import React from "react";
import { motion } from "framer-motion";

/**
 * WorkflowPaths Component
 * Renders animated SVG paths with Bézier curves and traveling particles
 * to connect nodes in the S-shaped workflow diagram.
 */
const WorkflowPaths: React.FC = () => {
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  // Path definitions based on balanced S-layout (1400x600 grid)
  const paths = [
    { 
      id: "path-1", 
      d: "M 200 150 L 500 150", // Store -> Core
      delay: 0.1
    },
    { 
      id: "path-2", 
      d: "M 500 150 L 800 150", // Core -> Alerte
      delay: 0.4
    },
    { 
      id: "path-3", 
      d: "M 800 150 L 1100 150", // Alerte -> Validation
      delay: 0.7
    },
    { 
      id: "path-4", 
      d: "M 1100 150 L 1100 350", // Validation -> Stock
      delay: 1.0
    },
    { 
      id: "path-5", 
      d: "M 1100 350 L 1320 350", // Stock -> Expédition
      delay: 1.3
    },
    { 
      id: "path-6", 
      d: "M 1320 350 C 1320 450 1200 450 900 450", // Expédition -> Livré
      delay: 1.6
    },
    { 
      id: "path-7", 
      d: "M 900 450 L 200 450", // Livré -> Analytics
      delay: 1.9
    },
    {
      id: "path-8",
      d: "M 500 150 L 500 350", // Core -> Meta Ads
      delay: 0.5
    },
    {
      id: "path-9",
      d: "M 500 350 C 500 450 400 450 200 450", // Meta Ads -> Analytics
      delay: 1.2
    }
  ];

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
      viewBox="0 0 1400 600"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10b981" /> {/* emerald-500 */}
          <stop offset="100%" stopColor="#06b6d4" /> {/* cyan-500 */}
        </linearGradient>

        <filter id="particleGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        <filter id="pathGlow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {paths.map((path, idx) => {
        // Deterministic durations for SSR, random for Client
        const dur1 = isMounted ? `${3 + Math.random() * 2}s` : "4s";
        const dur2 = isMounted ? `${4 + Math.random() * 2}s` : "5s";
        const dur3 = isMounted ? `${5 + Math.random() * 2}s` : "6s";

        return (
          <React.Fragment key={path.id}>
            {/* Background path line */}
            <path
              d={path.d}
              stroke="white"
              strokeOpacity="0.05"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Main animated gradient path */}
            <motion.path
              id={path.id}
              d={path.d}
              stroke="url(#flowGradient)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 0.4 }}
              viewport={{ once: true }}
              transition={{ 
                duration: 1.5, 
                delay: path.delay, 
                ease: "easeInOut" 
              }}
              filter="url(#pathGlow)"
            />

            {/* Particle 1 */}
            <circle r="3" fill="#10b981" filter="url(#particleGlow)">
              <animateMotion
                dur={dur1}
                repeatCount="indefinite"
                begin={`${path.delay}s`}
              >
                <mpath href={`#${path.id}`} />
              </animateMotion>
            </circle>

            {/* Particle 2 */}
            <circle r="2" fill="#06b6d4" filter="url(#particleGlow)" opacity="0.8">
              <animateMotion
                dur={dur2}
                repeatCount="indefinite"
                begin={`${path.delay + 0.8}s`}
              >
                <mpath href={`#${path.id}`} />
              </animateMotion>
            </circle>

            {/* Particle 3 (Trailing) */}
            <circle r="1.5" fill="#ffffff" filter="url(#particleGlow)" opacity="0.6">
              <animateMotion
                dur={dur3}
                repeatCount="indefinite"
                begin={`${path.delay + 1.5}s`}
              >
                <mpath href={`#${path.id}`} />
              </animateMotion>
            </circle>
          </React.Fragment>
        );
      })}
    </svg>
  );
};


export default WorkflowPaths;
