import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          height: '100%',
          width: '100%',
          background: '#111714',
          color: '#f3efe6',
          padding: '42px',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            position: 'relative',
            borderRadius: 28,
            overflow: 'hidden',
            background:
              'radial-gradient(circle at 72% 28%, rgba(31,169,113,0.24), transparent 22%), radial-gradient(circle at 18% 78%, rgba(198,139,60,0.18), transparent 18%), linear-gradient(135deg, #121916 0%, #111714 50%, #0d1310 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(90deg, rgba(17,23,20,0.92) 0%, rgba(17,23,20,0.64) 42%, rgba(17,23,20,0.2) 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              right: 48,
              top: 48,
              width: 380,
              height: 250,
              borderRadius: 28,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(16px)',
              display: 'flex',
              flexDirection: 'column',
              padding: 24,
              gap: 18,
              boxShadow: '0 24px 80px rgba(0,0,0,0.28)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 16, color: 'rgba(243,239,230,0.72)' }}>Profit net</div>
                <div style={{ fontSize: 40, color: '#2dd18f', fontWeight: 800 }}>28 460 MAD</div>
              </div>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(31,169,113,0.24)',
                  background: 'rgba(31,169,113,0.1)',
                  color: '#b9f0d8',
                  fontSize: 12,
                  letterSpacing: 1.5,
                }}
              >
                LIVE
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130 }}>
              {[34, 52, 48, 72, 64, 86, 78].map((height) => (
                <div
                  key={height}
                  style={{
                    flex: 1,
                    height: `${height}%`,
                    borderRadius: 12,
                    background: 'linear-gradient(180deg, #2dd18f 0%, #178a5a 100%)',
                    boxShadow: '0 10px 30px rgba(31,169,113,0.2)',
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
              }}
            >
              {['Ads', 'Delivery', 'Stores'].map((label) => (
                <div
                  key={label}
                  style={{
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.03)',
                    padding: '10px 12px',
                    fontSize: 13,
                    color: 'rgba(243,239,230,0.72)',
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              left: 48,
              top: 48,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
              maxWidth: 600,
            }}
          >
            <div style={{ color: '#1fa971', fontSize: 24, letterSpacing: 8, textTransform: 'uppercase' }}>jisra</div>
            <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.04 }}>
              Le cockpit qui transforme vos opérations en profit lisible.
            </div>
            <div style={{ fontSize: 28, lineHeight: 1.35, color: 'rgba(243,239,230,0.74)' }}>
              ERP SaaS pour e-commerçants marocains : ventes, pub, livraison, stock et rentabilité réelle.
            </div>
          </div>
        </div>
      </div>
    ),
    size
  )
}