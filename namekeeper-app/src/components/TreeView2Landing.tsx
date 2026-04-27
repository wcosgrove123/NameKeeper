'use client';

import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Person, GedcomData } from '@/lib/types';
import { searchPersons } from '@/lib/person-search';
import SettingsMenu from './SettingsMenu';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SurnameEntry {
  name: string;
  count: number;
  /** normalised 0‥1 by max count */
  weight: number;
}

interface TreeView2LandingProps {
  data: GedcomData;
  onSelectPerson: (personId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildSurnameList(data: GedcomData): SurnameEntry[] {
  const counts = new Map<string, number>();
  for (const p of data.persons.values()) {
    const s = p.surname?.trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const max = Math.max(...counts.values(), 1);
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count, weight: count / max }))
    .sort((a, b) => b.count - a.count);
}

/** Create a canvas texture with the given text */
function makeTextTexture(text: string, fontSize: number, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `700 ${fontSize}px "Inter", "Geist", system-ui, sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + 16;
  const h = Math.ceil(fontSize * 1.3) + 8;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/* ------------------------------------------------------------------ */
/*  3-D floating surname sprite                                        */
/* ------------------------------------------------------------------ */

function SurnameSprite({
  entry,
  position,
  drift,
  phase,
}: {
  entry: SurnameEntry;
  position: [number, number, number];
  drift: [number, number, number];
  phase: [number, number, number];
}) {
  const ref = useRef<THREE.Sprite>(null);
  const startPos = useRef(new THREE.Vector3(...position));

  // Size proportional to weight — larger surnames = bigger text
  const fontSize = 28 + entry.weight * 72; // 28–100 px
  // Depth-based opacity: closer sprites (higher z) feel more present
  const depthBoost = (position[2] + 4) / 8; // 0..1 across z range
  const baseOpacity = 0.1 + entry.weight * 0.5 + depthBoost * 0.18;

  const texture = useMemo(
    () => makeTextTexture(entry.name, fontSize, '#78716c'),
    [entry.name, fontSize],
  );

  const scale = useMemo((): [number, number, number] => {
    const aspect = texture.image.width / texture.image.height;
    // Depth-based scale: closer = larger, gives real parallax feel
    const depthScale = 1 + depthBoost * 0.25;
    const h = (0.6 + entry.weight * 1.8) * depthScale;
    return [h * aspect, h, 1];
  }, [texture, entry.weight, depthBoost]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.position.set(
      startPos.current.x + Math.sin(t * drift[0] + phase[0]) * 0.4,
      startPos.current.y + Math.cos(t * drift[1] + phase[1]) * 0.3,
      startPos.current.z + Math.sin(t * drift[2] + phase[2]) * 0.35,
    );
  });

  return (
    <sprite ref={ref} position={position} scale={scale}>
      <spriteMaterial map={texture} transparent opacity={baseOpacity} depthWrite={false} />
    </sprite>
  );
}

/* ------------------------------------------------------------------ */
/*  Smoke particles                                                    */
/* ------------------------------------------------------------------ */

const SMOKE_COUNT = 60;

function SmokeParticles() {
  const ref = useRef<THREE.Points>(null);

  const { positions, velocities, opacities } = useMemo(() => {
    const pos = new Float32Array(SMOKE_COUNT * 3);
    const vel = new Float32Array(SMOKE_COUNT * 3);
    const opa = new Float32Array(SMOKE_COUNT);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 20;  // x — wide
      pos[i * 3 + 1] = (Math.random() - 0.5) * 14;  // y — wide
      pos[i * 3 + 2] = (Math.random() - 0.5) * 3;   // z — thin
      vel[i * 3]     = (Math.random() - 0.5) * 0.003;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.002;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.001;
      opa[i] = Math.random() * 0.25 + 0.05;
    }
    return { positions: pos, velocities: vel, opacities: opa };
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  useFrame(() => {
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      arr[i * 3]     += velocities[i * 3];
      arr[i * 3 + 1] += velocities[i * 3 + 1];
      arr[i * 3 + 2] += velocities[i * 3 + 2];
      // wrap around
      if (Math.abs(arr[i * 3])     > 12) velocities[i * 3]     *= -1;
      if (Math.abs(arr[i * 3 + 1]) > 8)  velocities[i * 3 + 1] *= -1;
      if (Math.abs(arr[i * 3 + 2]) > 2)  velocities[i * 3 + 2] *= -1;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={1.2}
        color="#d6d3d1"
        transparent
        opacity={0.18}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/*  3-D Scene                                                          */
/* ------------------------------------------------------------------ */

function CameraRig() {
  const { camera, mouse } = useThree();
  useFrame(() => {
    // Subtle parallax — camera drifts toward mouse, giving depth illusion
    camera.position.x += (mouse.x * 1.2 - camera.position.x) * 0.04;
    camera.position.y += (mouse.y * 0.8 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function Scene({ surnames }: { surnames: SurnameEntry[] }) {
  // Get actual visible world-space dimensions from camera
  const { viewport } = useThree();
  const SPREAD_X = viewport.width / 2 * 0.92;   // 92% of visible half-width
  const SPREAD_Y = viewport.height / 2 * 0.88;  // 88% of visible half-height

  // Place up to ~80 surnames in a scattered cloud
  const placed = useMemo(() => {
    const items = surnames.slice(0, 80);
    // Grid-based placement with jitter for even coverage
    const CLEAR_X = SPREAD_X * 0.28;  // elliptical dead zone scales with viewport
    const CLEAR_Y = SPREAD_Y * 0.22;  // hotdog shape

    // Build a grid of cells, shuffle, assign names to cells
    const cols = 10;
    const rows = 8;
    const cellW = (SPREAD_X * 2) / cols;
    const cellH = (SPREAD_Y * 2) / rows;
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push([
          -SPREAD_X + (c + 0.5) * cellW,
          -SPREAD_Y + (r + 0.5) * cellH,
        ]);
      }
    }
    // Shuffle cells deterministically-ish using Fisher-Yates with seeded-like random
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    return items.map((entry, i) => {
      const cell = cells[i % cells.length];
      // Jitter within cell (70% of cell size for natural feel)
      let x = cell[0] + (Math.random() - 0.5) * cellW * 0.7;
      let y = cell[1] + (Math.random() - 0.5) * cellH * 0.7;
      // Push out of elliptical dead zone
      const dx = x / CLEAR_X;
      const dy = y / CLEAR_Y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        const scale = (1.05 + Math.random() * 0.3) / Math.max(dist, 0.01);
        x *= scale;
        y *= scale;
      }
      const z = (Math.random() - 0.5) * 7; // deep z-axis for parallax
      // Wide frequency range + random phase so no two names move in sync
      const drift: [number, number, number] = [
        0.08 + Math.random() * 0.5,
        0.06 + Math.random() * 0.45,
        0.04 + Math.random() * 0.3,
      ];
      const phase: [number, number, number] = [
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ];
      return { entry, position: [x, y, z] as [number, number, number], drift, phase };
    });
  }, [surnames]);

  return (
    <>
      <ambientLight intensity={1} />
      <CameraRig />
      <SmokeParticles />
      {placed.map((item, i) => (
        <SurnameSprite key={item.entry.name} {...item} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Search bar overlay (HTML on top of canvas)                         */
/* ------------------------------------------------------------------ */

function SearchOverlay({
  data,
  onSelectPerson,
}: {
  data: GedcomData;
  onSelectPerson: (personId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return searchPersons(data, query, 12);
  }, [query, data]);

  // Group by surname
  const grouped = useMemo(() => {
    const groups = new Map<string, Person[]>();
    for (const person of results) {
      const key = person.surname || 'Unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(person);
    }
    return groups;
  }, [results]);

  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      {/* Top-right navigation. The hardcoded 16/20px offsets were fine on
          desktop but ate the iPhone notch — pad with safe-area instead. */}
      <nav
        className="absolute pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-xl"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
          right: 'calc(env(safe-area-inset-right, 0px) + 1rem)',
          background: 'rgba(255, 255, 255, 0.5)',
          backdropFilter: 'blur(16px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.3)',
          border: '1px solid rgba(255,255,255,0.6)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        {[
          { href: '/', label: 'Name Keeper', shortLabel: 'Names' },
          { href: '/relationship', label: 'Relationship', shortLabel: 'Relate' },
        ].map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="px-2 sm:px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 hover:bg-white/50 rounded-lg transition-colors"
          >
            <span className="sm:hidden">{item.shortLabel}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        ))}
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <SettingsMenu variant="glass" />
      </nav>

      {/* Glassmorphic backdrop panel */}
      <div
        className="pointer-events-auto relative flex flex-col items-center"
        style={{ width: 'min(640px, 90vw)' }}
      >
        {/* Logo / title */}
        <h1
          className="text-4xl font-bold tracking-tight mb-2 select-none"
          style={{ color: '#1e293b' }}
        >
          NameKeeper
        </h1>
        <p className="text-sm text-slate-400 mb-6 select-none">
          {data.persons.size.toLocaleString()} people &middot; search to explore
        </p>

        {/* Search bar with glassmorphic card + shadow */}
        <div
          className="w-full rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.55)',
            backdropFilter: 'blur(24px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
            boxShadow: focused
              ? '0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)'
              : '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
            border: '1px solid rgba(255,255,255,0.6)',
            transition: 'box-shadow 0.3s ease',
          }}
        >
          {/* Input row */}
          <div className="flex items-center px-5 py-4 gap-3">
            {/* Search icon */}
            <svg
              className="w-5 h-5 text-slate-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 103.5 10.5a7.5 7.5 0 0013.15 6.15z"
              />
            </svg>

            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="Search for a person..."
              className="flex-1 bg-transparent outline-none text-lg text-slate-800 placeholder:text-slate-300"
              autoFocus
              aria-label="Search for a person in the family tree"
            />

            {query && (
              <button
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Clear search"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Results dropdown */}
          {grouped.size > 0 && (
            <div
              className="border-t max-h-72 overflow-y-auto"
              style={{ borderColor: 'rgba(148,163,184,0.2)' }}
            >
              {Array.from(grouped.entries()).map(([surname, people]) => (
                <div key={surname}>
                  <div className="px-5 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider"
                    style={{ background: 'rgba(241,245,249,0.5)' }}
                  >
                    {surname} ({people.length})
                  </div>
                  {people.map(p => (
                    <button
                      key={p.id}
                      onMouseDown={e => { e.preventDefault(); onSelectPerson(p.id); }}
                      className="w-full text-left px-5 py-2.5 text-sm hover:bg-white/40 flex items-center gap-3 transition-colors cursor-pointer"
                    >
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                        style={{
                          background: p.sex === 'M' ? 'rgba(59,130,246,0.12)' : 'rgba(236,72,153,0.12)',
                          color: p.sex === 'M' ? '#3b82f6' : '#ec4899',
                        }}
                      >
                        {p.givenName?.[0] ?? '?'}
                      </span>
                      <span className="flex-1 truncate text-slate-700">
                        {p.givenName} <span className="font-medium">{p.surname}</span>
                      </span>
                      <span className="text-xs text-slate-400 shrink-0">
                        {p.birthDate?.match(/(\d{4})/)?.[1] || ''}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hint */}
        <p className="text-xs text-slate-300 mt-4 select-none">
          Type a name to center the tree on that person
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function TreeView2Landing({ data, onSelectPerson }: TreeView2LandingProps) {
  const surnames = useMemo(() => buildSurnameList(data), [data]);

  return (
    <div className="fixed inset-0 z-40" style={{ background: '#faf7f0' }}>
      {/* Three.js canvas — full screen behind everything */}
      <div className="absolute inset-0">
        <Canvas
          camera={{ position: [0, 0, 14], fov: 55 }}
          dpr={[1, 1.5]}
          style={{ background: 'transparent' }}
          gl={{ alpha: true, antialias: true }}
        >
          <Scene surnames={surnames} />
        </Canvas>
      </div>

      {/* Radial fade — softens the cloud behind the search card */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 540px 360px at center, rgba(250,247,240,0.92) 0%, rgba(250,247,240,0.55) 45%, rgba(250,247,240,0) 75%)',
        }}
      />

      {/* Glassmorphic search overlay */}
      <SearchOverlay data={data} onSelectPerson={onSelectPerson} />
    </div>
  );
}
