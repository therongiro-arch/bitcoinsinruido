import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_SUPPLY = 21_000_000;
const HALVING_INTERVAL = 210_000;
const AVG_BLOCK_SECONDS = 600; // 10 minutes
// Anchor used until the live API replies (April 2026 ballpark)
const FALLBACK_HEIGHT = 893_000;

// Exact mined BTC at a given block height (the canonical issuance schedule
// the protocol enforces — every halving cuts the reward in half).
function totalMinedFromHeight(height: number): number {
  let total = 0;
  let reward = 50;
  let remaining = height;
  let phase = 0;
  while (remaining > 0 && phase < 33) {
    const inPhase = Math.min(remaining, HALVING_INTERVAL);
    total += inPhase * reward;
    remaining -= inPhase;
    reward /= 2;
    phase++;
  }
  return total;
}

function currentRewardAtHeight(height: number): number {
  let reward = 50;
  let n = Math.floor(height / HALVING_INTERVAL);
  while (n-- > 0) reward /= 2;
  return reward;
}

interface MiningState {
  height: number;
  mined: number;
  remaining: number;
  reward: number;
  fetchedAt: number;
}

function formatNumber(n: number, decimals = 2): string {
  return n.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Reactively report whether the viewport is narrow so the counter
// can switch to shorter number formats that fit on a phone.
function useIsNarrow(threshold = 480): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${threshold}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [threshold]);
  return narrow;
}

// Smoothly tween between numeric values for the "counter rolling up" feel.
function useTweenedNumber(target: number, ms = 1400): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === val) return;
    fromRef.current = val;
    startRef.current = null;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const k = Math.min(1, elapsed / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = fromRef.current + (target - fromRef.current) * eased;
      setVal(v);
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, ms]);

  return val;
}

export default function MiningCounter() {
  const [state, setState] = useState<MiningState>(() => {
    const h = FALLBACK_HEIGHT;
    const mined = totalMinedFromHeight(h);
    return {
      height: h,
      mined,
      remaining: MAX_SUPPLY - mined,
      reward: currentRewardAtHeight(h),
      fetchedAt: Date.now(),
    };
  });
  const [now, setNow] = useState(() => Date.now());

  // Fetch the real tip block height from mempool.space + refresh every 60 s.
  useEffect(() => {
    let alive = true;
    const fetchHeight = async () => {
      try {
        const r = await fetch('https://mempool.space/api/blocks/tip/height', {
          cache: 'no-store',
        });
        if (!r.ok) return;
        const h = parseInt(await r.text(), 10);
        if (!alive || !Number.isFinite(h)) return;
        const mined = totalMinedFromHeight(h);
        setState({
          height: h,
          mined,
          remaining: MAX_SUPPLY - mined,
          reward: currentRewardAtHeight(h),
          fetchedAt: Date.now(),
        });
      } catch {
        /* keep previous */
      }
    };
    void fetchHeight();
    const id = setInterval(() => void fetchHeight(), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Tick the visible "now" every second so the projected mined value
  // increments smoothly between block refreshes.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Projected mined supply right now, between API refreshes. Each block of
  // average 10 min adds `reward` BTC; in between we interpolate linearly.
  const projectedMined = useMemo(() => {
    const elapsed = (now - state.fetchedAt) / 1000;
    const fractionalBlocks = elapsed / AVG_BLOCK_SECONDS;
    return state.mined + fractionalBlocks * state.reward;
  }, [state, now]);

  const projectedRemaining = Math.max(0, MAX_SUPPLY - projectedMined);
  const minedDisp = useTweenedNumber(projectedMined, 1200);
  const remainingDisp = useTweenedNumber(projectedRemaining, 1200);
  const percent = (projectedMined / MAX_SUPPLY) * 100;
  const narrow = useIsNarrow(480);
  const decimals = narrow ? 0 : 3;

  // 12 servers, each with their own blink seed
  const servers = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        i,
        // 4 LEDs per server, randomized blink delay
        leds: [0.2, 0.7, 1.1, 1.6].map((d) => d + (i % 3) * 0.13),
      })),
    [],
  );

  return (
    <div className="bsr-mining-card">
      <div className="bsr-mining-head">
        <span className="bsr-mining-eyebrow">
          <span className="bsr-mining-dot" aria-hidden="true" />
          MINADO ON-CHAIN · BLOQUE #{state.height.toLocaleString('es-ES')}
        </span>
        <span className="bsr-mining-reward">
          recompensa actual {state.reward.toFixed(3)} ₿/bloque
        </span>
      </div>

      <div className="bsr-mining-grid">
        <div className="bsr-mining-stat">
          <div className="bsr-mining-label">Minados</div>
          <div className="bsr-mining-value mined">
            {formatNumber(minedDisp, decimals)}
            <span>₿</span>
          </div>
        </div>
        <div className="bsr-mining-stat">
          <div className="bsr-mining-label">Restan por minar</div>
          <div className="bsr-mining-value remaining">
            {formatNumber(remainingDisp, decimals)}
            <span>₿</span>
          </div>
        </div>
      </div>

      <div className="bsr-mining-progress">
        <div
          className="bsr-mining-progress-bar"
          style={{ width: `${percent.toFixed(3)}%` }}
        />
        <span className="bsr-mining-percent">
          {percent.toFixed(3)}% del límite de 21M
        </span>
      </div>

      <div className="bsr-mining-rack" aria-hidden="true">
        <svg viewBox="0 0 400 100" preserveAspectRatio="xMidYMid meet">
          {/* rack frame */}
          <rect x="0" y="0" width="400" height="100" rx="6" className="bsr-rack-bg" />
          {servers.map((s) => {
            const x = 8 + s.i * 32;
            return (
              <g key={s.i} transform={`translate(${x}, 8)`}>
                {/* server chassis */}
                <rect width="28" height="84" rx="3" className="bsr-rack-server" />
                {/* slots / vents */}
                <line x1="4" y1="14" x2="24" y2="14" className="bsr-rack-line" />
                <line x1="4" y1="20" x2="24" y2="20" className="bsr-rack-line" />
                {/* mining hash readout (tiny line ticker) */}
                <rect x="4" y="32" width="20" height="2" className="bsr-rack-readout" />
                <rect
                  x="4"
                  y="32"
                  width="6"
                  height="2"
                  className="bsr-rack-readout-fill"
                  style={{ animationDelay: `${s.i * 0.27}s` }}
                />
                {/* LEDs */}
                {s.leds.map((d, k) => (
                  <circle
                    key={k}
                    cx={6 + k * 5}
                    cy={70}
                    r={1.4}
                    className="bsr-rack-led"
                    style={{ animationDelay: `${d}s` }}
                  />
                ))}
              </g>
            );
          })}
          {/* base */}
          <rect x="0" y="94" width="400" height="2" className="bsr-rack-base" />
        </svg>
      </div>
    </div>
  );
}
