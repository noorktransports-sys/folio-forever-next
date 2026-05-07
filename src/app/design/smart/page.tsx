'use client';

/* ============================================================
 * /design/smart  —  Smart Auto-Layout (BETA)
 *
 * Drop-in TypeScript page for folio-forever-next.
 * Lives alongside the legacy /design builder. Doesn't touch it.
 *
 * Stack assumptions matching HANDOFF.md:
 *   - Next.js 15 App Router, edge runtime
 *   - TypeScript strict
 *   - Tailwind (configured in repo)
 *   - No external icon libs (uses inline SVG)
 *
 * What's WIRED:
 *   - Full UI flow path -> upload -> events -> tag -> pages -> generate -> adjust -> submit
 *   - Hard caps (8 heroes, 30 favorites, 100 photos, 25 spreads)
 *   - Resolution gate on Hero tag (3000px min)
 *   - Layout rules engine (heroes -> full spread, favorites paired, others fill)
 *   - "Use sample wedding" demo path with picsum images
 *
 * What's TODO (commented inline, search for "TODO:"):
 *   - Real upload to /api/upload (R2)
 *   - Save design to /api/designs (KV)
 *   - Submit order to /api/submit-order
 *   - Email pre-fill from localStorage 'folio-customer-v1'
 * ============================================================ */

import React, { useState, useMemo, useEffect, useRef } from 'react';

export const runtime = 'edge';

// ---------- types ----------
type EventKey = 'prep' | 'ceremony' | 'portraits' | 'reception';
type TagKind = 'hero' | 'favorite' | null;

interface Photo {
  id: string;
  src: string;
  thumb: string;
  timestamp: number;
  event: EventKey;
  width: number;
  height: number;
  isBlurry: boolean;
  tag: TagKind;
  hidden: boolean;
}

type Template = 'full' | 'one' | 'two' | 'three';

interface Spread {
  template: Template;
  photos: Photo[];
  event: EventKey | undefined;
}

type Step =
  | 'path'
  | 'upload'
  | 'events'
  | 'tag'
  | 'pages'
  | 'generate'
  | 'adjust'
  | 'submit';

type Path = 'ai' | 'manual' | 'expert';

// ---------- constants ----------
const EVENT_LABELS: Record<EventKey, string> = {
  prep: 'Getting Ready',
  ceremony: 'Ceremony',
  portraits: 'Portraits',
  reception: 'Reception',
};

const HERO_CAP = 8;
const FAV_CAP = 30;
const UPLOAD_CAP = 100;
const PAGES_INCLUDED = 10;
const PAGES_MAX = 25;
const PRICE_PER_EXTRA_PAGE = 35;
const MIN_HERO_RES = 3000;

// ---------- mock data ----------
function generateMockPhotos(): Photo[] {
  const eventOrder: EventKey[] = ['prep', 'ceremony', 'portraits', 'reception'];
  const eventCounts: Record<EventKey, number> = {
    prep: 9,
    ceremony: 11,
    portraits: 8,
    reception: 12,
  };
  const photos: Photo[] = [];
  let id = 1;
  let t = new Date('2024-09-14T08:30:00').getTime();

  for (const event of eventOrder) {
    for (let i = 0; i < eventCounts[event]; i++) {
      const seed = `ff-${event}-${i}-${id}`;
      const lowRes = id % 9 === 0;
      const blurry = id % 13 === 0;
      photos.push({
        id: `p${id}`,
        src: `https://picsum.photos/seed/${seed}/900/600`,
        thumb: `https://picsum.photos/seed/${seed}/300/200`,
        timestamp: t,
        event,
        width: lowRes ? 1200 : 4500,
        height: lowRes ? 800 : 3000,
        isBlurry: blurry,
        tag: null,
        hidden: false,
      });
      t += 1000 * 60 * (4 + Math.floor(Math.random() * 14));
      id++;
    }
  }
  return photos;
}

// ---------- layout rules engine ----------
function generateLayout(photos: Photo[], numSpreads: number): Spread[] {
  const visible = photos.filter((p) => !p.hidden);
  const byTime = (a: Photo, b: Photo) => a.timestamp - b.timestamp;
  const heroes = visible.filter((p) => p.tag === 'hero').sort(byTime);
  const favorites = visible.filter((p) => p.tag === 'favorite').sort(byTime);
  const others = visible.filter((p) => p.tag === null).sort(byTime);

  const spreads: Spread[] = [];

  for (const h of heroes) {
    spreads.push({ template: 'full', photos: [h], event: h.event });
  }

  for (let i = 0; i < favorites.length; i += 2) {
    const a = favorites[i];
    const b = favorites[i + 1];
    const pair = b ? [a, b] : [a];
    spreads.push({
      template: pair.length === 2 ? 'two' : 'one',
      photos: pair,
      event: pair[0].event,
    });
  }

  const pool = [...others];
  while (spreads.length < numSpreads && pool.length > 0) {
    const take = Math.min(3, pool.length);
    const picked = pool.splice(0, take);
    spreads.push({
      template: take === 1 ? 'one' : take === 2 ? 'two' : 'three',
      photos: picked,
      event: picked[0]?.event,
    });
  }

  const order: Record<EventKey, number> = {
    prep: 0,
    ceremony: 1,
    portraits: 2,
    reception: 3,
  };
  spreads.sort((a, b) => {
    const ea = a.event ? order[a.event] : 99;
    const eb = b.event ? order[b.event] : 99;
    if (ea !== eb) return ea - eb;
    return (a.photos[0]?.timestamp ?? 0) - (b.photos[0]?.timestamp ?? 0);
  });

  return spreads.slice(0, numSpreads);
}

// ============================================================
//                          PAGE
// ============================================================

export default function SmartDesignerPage() {
  const [step, setStep] = useState<Step>('path');
  const [, setPath] = useState<Path | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pages, setPages] = useState(PAGES_INCLUDED);
  const [spreads, setSpreads] = useState<Spread[]>([]);
  const [activeSpread, setActiveSpread] = useState(0);
  const [eventFilter, setEventFilter] = useState<'all' | EventKey>('all');
  const [warning, setWarning] = useState<string | null>(null);

  const stats = useMemo(() => {
    const visible = photos.filter((p) => !p.hidden);
    return {
      heroes: visible.filter((p) => p.tag === 'hero').length,
      favorites: visible.filter((p) => p.tag === 'favorite').length,
      total: visible.length,
      blurry: visible.filter((p) => p.isBlurry).length,
    };
  }, [photos]);

  useEffect(() => {
    if (!warning) return;
    const t = setTimeout(() => setWarning(null), 3500);
    return () => clearTimeout(t);
  }, [warning]);

  const setTag = (id: string, tag: Exclude<TagKind, null>) => {
    const p = photos.find((x) => x.id === id);
    if (!p) return;
    if (tag === 'hero') {
      if (p.tag !== 'hero' && stats.heroes >= HERO_CAP) {
        setWarning(`Maximum ${HERO_CAP} Heroes. Untag one first.`);
        return;
      }
      if (p.width < MIN_HERO_RES) {
        setWarning(
          `Too small to print at full size (need ${MIN_HERO_RES}px+, has ${p.width}px). Tag as Favorite instead.`
        );
        return;
      }
    }
    if (tag === 'favorite' && p.tag !== 'favorite' && stats.favorites >= FAV_CAP) {
      setWarning(`Maximum ${FAV_CAP} Favorites. Untag one first.`);
      return;
    }
    setPhotos((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, tag: x.tag === tag ? null : tag } : x
      )
    );
  };

  const toggleHide = (id: string) => {
    setPhotos((prev) =>
      prev.map((x) =>
        x.id === id
          ? { ...x, hidden: !x.hidden, tag: x.hidden ? x.tag : null }
          : x
      )
    );
  };

  const handleLoadSamples = () => {
    setPhotos(generateMockPhotos());
    setStep('events');
  };

  const handleFileUpload = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, UPLOAD_CAP);
    if (!arr.length) return;
    // TODO: upload each file to /api/upload (R2). For now, browser-only preview.
    const tasks = arr.map((f, i) => {
      return new Promise<Photo>((resolve) => {
        const url = URL.createObjectURL(f);
        const img = new globalThis.Image();
        img.onload = () => {
          resolve({
            id: `u${Date.now()}-${i}`,
            src: url,
            thumb: url,
            timestamp: f.lastModified,
            event: 'ceremony',
            width: img.naturalWidth,
            height: img.naturalHeight,
            isBlurry: false,
            tag: null,
            hidden: false,
          });
        };
        img.src = url;
      });
    });
    void Promise.all(tasks).then((all) => {
      setPhotos(all);
      setStep('events');
    });
  };

  const handleGenerate = () => {
    setStep('generate');
    setTimeout(() => {
      setSpreads(generateLayout(photos, pages));
      setStep('adjust');
    }, 2200);
  };

  const reshufflePhoto = (spreadIdx: number, photoIdx: number) => {
    setSpreads((prev) => {
      const next = [...prev];
      const used = new Set(next.flatMap((s) => s.photos.map((p) => p.id)));
      const candidate = photos.find((p) => !p.hidden && !used.has(p.id));
      if (!candidate) return prev;
      const cur = next[spreadIdx];
      const newPhotos = [...cur.photos];
      newPhotos[photoIdx] = candidate;
      next[spreadIdx] = { ...cur, photos: newPhotos };
      return next;
    });
  };

  const handleSubmit = () => {
    // TODO: POST to /api/submit-order with { spreads, photos, pages, customer }
    // For now just show confirmation.
    setStep('submit');
  };

  const extraPages = Math.max(0, pages - PAGES_INCLUDED);
  const extraCost = extraPages * PRICE_PER_EXTRA_PAGE;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-stone-50/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="font-serif tracking-[0.3em] text-xs text-stone-700">
            FOLIO &nbsp;&amp;&nbsp; FOREVER
          </a>
          <span className="bg-amber-400 text-stone-900 text-[10px] tracking-widest px-2 py-0.5 font-semibold">
            BETA
          </span>
        </div>
      </header>

      {warning && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-stone-900 text-stone-50 px-5 py-3 rounded shadow-2xl text-sm flex items-center gap-2 max-w-md">
          <Icon name="alert" className="text-amber-400 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-12">
        {step === 'path' && (
          <PathChoice
            onChoose={(p) => {
              setPath(p);
              if (p === 'ai') setStep('upload');
              else if (p === 'manual') window.location.href = '/design';
              else setStep('upload'); // expert path uses same upload then handoff
            }}
          />
        )}
        {step === 'upload' && (
          <UploadStep
            onUseSamples={handleLoadSamples}
            onUpload={handleFileUpload}
            onBack={() => setStep('path')}
          />
        )}
        {step === 'events' && (
          <EventsStep
            photos={photos}
            setPhotos={setPhotos}
            onNext={() => setStep('tag')}
            onBack={() => setStep('upload')}
          />
        )}
        {step === 'tag' && (
          <TagStep
            photos={photos}
            stats={stats}
            eventFilter={eventFilter}
            setEventFilter={setEventFilter}
            setTag={setTag}
            toggleHide={toggleHide}
            onNext={() => setStep('pages')}
            onBack={() => setStep('events')}
          />
        )}
        {step === 'pages' && (
          <PagesStep
            pages={pages}
            setPages={setPages}
            stats={stats}
            extraCost={extraCost}
            onNext={handleGenerate}
            onBack={() => setStep('tag')}
          />
        )}
        {step === 'generate' && <GeneratingStep />}
        {step === 'adjust' && (
          <AdjustStep
            spreads={spreads}
            activeSpread={activeSpread}
            setActiveSpread={setActiveSpread}
            reshuffle={reshufflePhoto}
            onRegenerate={() => {
              setSpreads(generateLayout(photos, pages));
              setActiveSpread(0);
            }}
            onSubmit={handleSubmit}
            onBack={() => setStep('pages')}
          />
        )}
        {step === 'submit' && <SubmitStep spreads={spreads} extraCost={extraCost} />}
      </main>
    </div>
  );
}

// ============================================================
//                       SUB-COMPONENTS
// ============================================================

interface PathChoiceProps {
  onChoose: (p: Path) => void;
}
function PathChoice({ onChoose }: PathChoiceProps) {
  const options: {
    key: Path;
    icon: IconName;
    label: string;
    desc: string;
    time: string;
    price: string;
    featured?: boolean;
  }[] = [
    {
      key: 'ai',
      icon: 'wand',
      label: 'Smart Auto-Layout',
      desc: 'Tag your favorites. We arrange the album for you. Adjust before ordering.',
      time: '15–20 minutes',
      price: 'Included',
      featured: true,
    },
    {
      key: 'manual',
      icon: 'pen',
      label: "I'll design it myself",
      desc: 'Drag and drop into 12 curated layouts. Full creative control.',
      time: '1–2 hours',
      price: 'Included',
    },
    {
      key: 'expert',
      icon: 'user',
      label: 'Our team designs it',
      desc: 'You upload, we design. Proof in 3 business days. One revision included.',
      time: 'Hands-off',
      price: '+$150',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto pt-8">
      <p className="text-[11px] tracking-[0.3em] text-stone-500 uppercase mb-3">Step One</p>
      <h1 className="font-serif text-5xl md:text-6xl leading-[1.05] mb-6">
        How would you like  <em className="italic text-stone-700">your monument</em> designed?
      </h1>
      <p className="text-stone-600 mb-12 max-w-xl">
        Three paths. Same archival-quality, 3D tactile, hand-bound result. Switch between them anytime.
      </p>
      <div className="grid gap-4">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onChoose(o.key)}
            className={`group relative text-left p-6 md:p-8 border transition-all ${
              o.featured
                ? 'border-stone-900 bg-stone-900 text-stone-50 hover:bg-stone-800'
                : 'border-stone-300 bg-white hover:border-stone-900'
            }`}
          >
            {o.featured && (
              <span className="absolute -top-2 left-6 bg-amber-400 text-stone-900 text-[10px] tracking-widest px-2 py-0.5 font-semibold">
                RECOMMENDED
              </span>
            )}
            <div className="flex items-start gap-5">
              <div className={`p-3 rounded-full ${o.featured ? 'bg-stone-50/10' : 'bg-stone-100'}`}>
                <Icon name={o.icon} size={22} />
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <h3 className="font-serif text-2xl">{o.label}</h3>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={o.featured ? 'text-stone-300' : 'text-stone-500'}>{o.time}</span>
                    <span className="font-semibold">{o.price}</span>
                  </div>
                </div>
                <p className={`mt-2 text-sm ${o.featured ? 'text-stone-300' : 'text-stone-600'}`}>{o.desc}</p>
              </div>
              <Icon name="arrowRight" className="opacity-0 group-hover:opacity-100 transition-opacity mt-2" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface UploadStepProps {
  onUseSamples: () => void;
  onUpload: (files: FileList | null) => void;
  onBack: () => void;
}
function UploadStep({ onUseSamples, onUpload, onBack }: UploadStepProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="max-w-3xl mx-auto pt-8">
      <BackBtn onClick={onBack} />
      <p className="text-[11px] tracking-[0.3em] text-stone-500 uppercase mb-3">Step Two</p>
      <h1 className="font-serif text-5xl leading-tight mb-6">
        Pick your favorites <em className="italic text-stone-700">first.</em>
      </h1>
      <div className="bg-amber-50 border-l-4 border-amber-700 p-5 mb-10 text-sm text-stone-800">
        <p className="font-semibold mb-2">Before you upload — a few rules:</p>
        <ul className="space-y-1.5 text-stone-700">
          <li>• Maximum <strong>{UPLOAD_CAP} photos</strong>. Cull from your photographer's gallery first.</li>
          <li>• 30–40 photos is recommended for a {PAGES_INCLUDED}-spread album.</li>
          <li>• Skip blurry, eyes-closed, and near-duplicate shots — we won't fix them.</li>
          <li>• Hero photos (full-spread) need to be at least {MIN_HERO_RES.toLocaleString()}px on the long edge.</li>
        </ul>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <button
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-stone-300 hover:border-stone-900 hover:bg-stone-100 transition-all p-10 text-center"
        >
          <Icon name="upload" size={28} className="mx-auto mb-4 text-stone-700" />
          <div className="font-serif text-xl mb-1">Upload your photos</div>
          <div className="text-sm text-stone-500">JPG or PNG · up to {UPLOAD_CAP} files</div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
        </button>
        <button
          onClick={onUseSamples}
          className="border border-stone-300 hover:border-stone-900 hover:bg-stone-100 transition-all p-10 text-center bg-white"
        >
          <Icon name="sparkles" size={28} className="mx-auto mb-4 text-stone-700" />
          <div className="font-serif text-xl mb-1">Use sample wedding</div>
          <div className="text-sm text-stone-500">40 demo photos · for testing the flow</div>
        </button>
      </div>
    </div>
  );
}

interface EventsStepProps {
  photos: Photo[];
  setPhotos: React.Dispatch<React.SetStateAction<Photo[]>>;
  onNext: () => void;
  onBack: () => void;
}
function EventsStep({ photos, setPhotos, onNext, onBack }: EventsStepProps) {
  const groups = useMemo(() => {
    const g: Record<EventKey, Photo[]> = { prep: [], ceremony: [], portraits: [], reception: [] };
    for (const p of photos) g[p.event].push(p);
    return g;
  }, [photos]);

  const moveTo = (id: string, event: EventKey) =>
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, event } : p)));

  return (
    <div className="pt-8">
      <BackBtn onClick={onBack} />
      <p className="text-[11px] tracking-[0.3em] text-stone-500 uppercase mb-3">Step Three</p>
      <h1 className="font-serif text-5xl leading-tight mb-3">
        Group by  <em className="italic text-stone-700">moment.</em>
      </h1>
      <p className="text-stone-600 mb-10 max-w-2xl">
        We've sorted your photos by timestamp into the four chapters of your day. Click any photo to recategorize it.
      </p>
      <div className="grid md:grid-cols-2 gap-6 mb-12">
        {(Object.keys(EVENT_LABELS) as EventKey[]).map((key) => (
          <div key={key} className="bg-white border border-stone-200 p-5">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="font-serif text-xl">{EVENT_LABELS[key]}</h3>
              <span className="text-xs text-stone-500">{groups[key].length} photos</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {groups[key].slice(0, 12).map((p) => (
                <PhotoCategoryCell key={p.id} photo={p} moveTo={moveTo} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <NextBtn onClick={onNext} label="Continue to tagging" />
    </div>
  );
}

interface PhotoCategoryCellProps {
  photo: Photo;
  moveTo: (id: string, event: EventKey) => void;
}
function PhotoCategoryCell({ photo, moveTo }: PhotoCategoryCellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative aspect-square">
      <img
        src={photo.thumb}
        alt=""
        className="w-full h-full object-cover cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="absolute inset-0 bg-stone-900/95 text-stone-50 flex flex-col items-stretch justify-center text-[10px] gap-0.5 p-1">
          {(Object.keys(EVENT_LABELS) as EventKey[]).map((k) => (
            <button
              key={k}
              onClick={(e) => {
                e.stopPropagation();
                moveTo(photo.id, k);
                setOpen(false);
              }}
              className={`px-1 py-0.5 ${
                photo.event === k ? 'bg-amber-400 text-stone-900' : 'hover:bg-stone-700'
              }`}
            >
              {EVENT_LABELS[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TagStepProps {
  photos: Photo[];
  stats: { heroes: number; favorites: number; total: number; blurry: number };
  eventFilter: 'all' | EventKey;
  setEventFilter: (e: 'all' | EventKey) => void;
  setTag: (id: string, tag: Exclude<TagKind, null>) => void;
  toggleHide: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}
function TagStep({
  photos,
  stats,
  eventFilter,
  setEventFilter,
  setTag,
  toggleHide,
  onNext,
  onBack,
}: TagStepProps) {
  const visible = photos.filter(
    (p) => !p.hidden && (eventFilter === 'all' || p.event === eventFilter)
  );
  const canContinue = stats.heroes + stats.favorites > 0;

  return (
    <div className="pt-8">
      <BackBtn onClick={onBack} />
      <p className="text-[11px] tracking-[0.3em] text-stone-500 uppercase mb-3">Step Four</p>
      <h1 className="font-serif text-5xl leading-tight mb-3">
        Mark your <em className="italic text-stone-700">heroes.</em>
      </h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Heroes get the full 20×30 spread. Favorites get featured slots. Everything else fills in around them.
      </p>

      <div className="sticky top-[57px] z-20 bg-stone-50/95 backdrop-blur border-y border-stone-200 -mx-6 px-6 py-3 mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <CounterPill icon="crown" label="Heroes" count={stats.heroes} cap={HERO_CAP} />
          <CounterPill icon="bookmark" label="Favorites" count={stats.favorites} cap={FAV_CAP} />
          <span className="text-stone-500 hidden md:inline">{stats.total} photos total</span>
        </div>
        <div className="flex gap-1.5 text-xs flex-wrap">
          <FilterBtn active={eventFilter === 'all'} onClick={() => setEventFilter('all')}>
            All
          </FilterBtn>
          {(Object.keys(EVENT_LABELS) as EventKey[]).map((k) => (
            <FilterBtn key={k} active={eventFilter === k} onClick={() => setEventFilter(k)}>
              {EVENT_LABELS[k]}
            </FilterBtn>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3 mb-12">
        {visible.map((p) => (
          <PhotoTagCell key={p.id} photo={p} setTag={setTag} toggleHide={toggleHide} />
        ))}
      </div>

      <NextBtn
        onClick={onNext}
        disabled={!canContinue}
        label={canContinue ? 'Choose album size' : 'Tag at least one photo'}
      />
    </div>
  );
}

interface PhotoTagCellProps {
  photo: Photo;
  setTag: (id: string, tag: Exclude<TagKind, null>) => void;
  toggleHide: (id: string) => void;
}
function PhotoTagCell({ photo, setTag, toggleHide }: PhotoTagCellProps) {
  const isHero = photo.tag === 'hero';
  const isFav = photo.tag === 'favorite';
  const isLowRes = photo.width < MIN_HERO_RES;

  return (
    <div className="relative group">
      <div className="aspect-[3/2] overflow-hidden bg-stone-200 relative">
        <img src={photo.thumb} alt="" className="w-full h-full object-cover" />
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
          {isHero && (
            <span className="bg-amber-400 text-stone-900 text-[10px] font-bold px-1.5 py-0.5 tracking-wider flex items-center gap-1">
              <Icon name="crown" size={10} /> HERO
            </span>
          )}
          {isFav && (
            <span className="bg-stone-900 text-stone-50 text-[10px] font-bold px-1.5 py-0.5 tracking-wider flex items-center gap-1">
              <Icon name="bookmark" size={10} /> FAV
            </span>
          )}
          {photo.isBlurry && (
            <span className="bg-red-100 text-red-800 text-[10px] font-bold px-1.5 py-0.5 tracking-wider flex items-center gap-1">
              <Icon name="alert" size={10} /> SOFT
            </span>
          )}
          {isLowRes && (
            <span className="bg-orange-100 text-orange-800 text-[10px] font-bold px-1.5 py-0.5 tracking-wider">
              LOW-RES
            </span>
          )}
        </div>
        <div className="absolute inset-0 bg-stone-900/0 group-hover:bg-stone-900/60 transition-all flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
          <button
            title="Hero"
            onClick={() => setTag(photo.id, 'hero')}
            className={`p-2 rounded-full transition-all ${
              isHero
                ? 'bg-amber-400 text-stone-900'
                : 'bg-stone-50 text-stone-900 hover:bg-amber-400'
            }`}
          >
            <Icon name="crown" size={14} />
          </button>
          <button
            title="Favorite"
            onClick={() => setTag(photo.id, 'favorite')}
            className={`p-2 rounded-full transition-all ${
              isFav
                ? 'bg-stone-900 text-stone-50'
                : 'bg-stone-50 text-stone-900 hover:bg-stone-900 hover:text-stone-50'
            }`}
          >
            <Icon name="bookmark" size={14} />
          </button>
          <button
            title="Hide"
            onClick={() => toggleHide(photo.id)}
            className="p-2 rounded-full bg-stone-50 text-stone-900 hover:bg-red-200"
          >
            <Icon name="eyeOff" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface CounterPillProps {
  icon: IconName;
  label: string;
  count: number;
  cap: number;
}
function CounterPill({ icon, label, count, cap }: CounterPillProps) {
  const isMax = count >= cap;
  const bg = isMax ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-700';
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 ${bg} text-xs font-medium`}>
      <Icon name={icon} size={13} />
      {label}: <span className="font-bold">{count}</span>/{cap}
    </span>
  );
}

interface FilterBtnProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}
function FilterBtn({ active, onClick, children }: FilterBtnProps) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 transition-colors ${
        active
          ? 'bg-stone-900 text-stone-50'
          : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
      }`}
    >
      {children}
    </button>
  );
}

interface PagesStepProps {
  pages: number;
  setPages: (n: number) => void;
  stats: { heroes: number; favorites: number; total: number; blurry: number };
  extraCost: number;
  onNext: () => void;
  onBack: () => void;
}
function PagesStep({ pages, setPages, stats, extraCost, onNext, onBack }: PagesStepProps) {
  const fits = pages * 4;
  const tight = stats.heroes + stats.favorites > pages * 2;

  return (
    <div className="max-w-3xl mx-auto pt-8">
      <BackBtn onClick={onBack} />
      <p className="text-[11px] tracking-[0.3em] text-stone-500 uppercase mb-3">Step Five</p>
      <h1 className="font-serif text-5xl leading-tight mb-6">
        How <em className="italic text-stone-700">tall</em> should your monument stand?
      </h1>
      <p className="text-stone-600 mb-12 max-w-2xl">
        {PAGES_INCLUDED} spreads come included. Add up to {PAGES_MAX - PAGES_INCLUDED} more if your story needs them.
      </p>

      <div className="bg-white border border-stone-200 p-8 mb-8">
        <div className="flex items-baseline justify-between mb-2">
          <span className="font-serif text-7xl">{pages}</span>
          <span className="text-sm text-stone-500">spreads</span>
        </div>
        <input
          type="range"
          min={PAGES_INCLUDED}
          max={PAGES_MAX}
          value={pages}
          onChange={(e) => setPages(Number(e.target.value))}
          className="w-full mt-4 accent-stone-900"
        />
        <div className="flex justify-between text-xs text-stone-500 mt-1">
          <span>{PAGES_INCLUDED} included</span>
          <span>{PAGES_MAX} maximum</span>
        </div>
        <div className="mt-8 pt-6 border-t border-stone-200 grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-wider mb-1">Your photos</div>
            <div className="font-serif text-2xl">{stats.total}</div>
            <div className="text-stone-500 text-xs">{stats.heroes} hero · {stats.favorites} fav</div>
          </div>
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-wider mb-1">Approx capacity</div>
            <div className="font-serif text-2xl">{fits} photos</div>
            <div className={`text-xs ${tight ? 'text-orange-600' : 'text-stone-500'}`}>
              {tight ? 'Tight — add pages?' : 'Comfortable'}
            </div>
          </div>
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-wider mb-1">Extra pages</div>
            <div className="font-serif text-2xl">+${extraCost}</div>
            <div className="text-stone-500 text-xs">${PRICE_PER_EXTRA_PAGE}/spread over {PAGES_INCLUDED}</div>
          </div>
        </div>
      </div>

      <NextBtn onClick={onNext} label="Generate my album" iconName="sparkles" />
    </div>
  );
}

function GeneratingStep() {
  const phases = [
    'Reading your timeline…',
    'Placing heroes on full spreads…',
    'Pairing favorites…',
    'Filling chapters…',
    'Polishing the layout…',
  ];
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % phases.length), 500);
    return () => clearInterval(t);
  }, [phases.length]);

  return (
    <div className="max-w-xl mx-auto pt-32 text-center">
      <div className="mx-auto mb-6 w-9 h-9 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
      <p className="text-[11px] tracking-[0.3em] text-stone-500 uppercase mb-2">Designing</p>
      <h2 className="font-serif text-4xl mb-6">Composing your monument…</h2>
      <p className="text-stone-600 animate-pulse">{phases[phase]}</p>
    </div>
  );
}

interface AdjustStepProps {
  spreads: Spread[];
  activeSpread: number;
  setActiveSpread: (n: number) => void;
  reshuffle: (spreadIdx: number, photoIdx: number) => void;
  onRegenerate: () => void;
  onSubmit: () => void;
  onBack: () => void;
}
function AdjustStep({
  spreads,
  activeSpread,
  setActiveSpread,
  reshuffle,
  onRegenerate,
  onSubmit,
  onBack,
}: AdjustStepProps) {
  const spread = spreads[activeSpread];

  return (
    <div className="pt-8">
      <BackBtn onClick={onBack} />
      <p className="text-[11px] tracking-[0.3em] text-stone-500 uppercase mb-3">Step Six</p>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1 className="font-serif text-5xl leading-tight">
          Your <em className="italic text-stone-700">monument.</em>
        </h1>
        <button
          onClick={onRegenerate}
          className="text-sm text-stone-700 hover:text-stone-900 flex items-center gap-2 underline-offset-4 hover:underline"
        >
          <Icon name="refresh" size={14} /> Regenerate layout
        </button>
      </div>
      <p className="text-stone-600 mb-8">
        Click any photo on the spread to swap it. Use the strip below to navigate.
      </p>

      <div className="bg-stone-100 border border-stone-200 p-8 mb-6">
        <div className="text-xs tracking-widest text-stone-500 mb-3 flex justify-between">
          <span>SPREAD {activeSpread + 1} OF {spreads.length}</span>
          <span>{spread?.event ? EVENT_LABELS[spread.event] : ''}</span>
        </div>
        <div className="aspect-[2/1] bg-white shadow-2xl">
          <SpreadRenderer spread={spread} onSwap={(idx) => reshuffle(activeSpread, idx)} />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-3 mb-12">
        {spreads.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveSpread(i)}
            className={`shrink-0 w-32 aspect-[2/1] border-2 transition-all ${
              i === activeSpread ? 'border-stone-900' : 'border-stone-200 opacity-60 hover:opacity-100'
            }`}
          >
            <SpreadRenderer spread={s} mini />
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <div className="bg-amber-50 border border-amber-200 p-5">
          <div className="flex items-start gap-3">
            <Icon name="user" size={20} className="text-amber-700 mt-0.5" />
            <div>
              <h3 className="font-serif text-lg mb-1">Want it perfected?</h3>
              <p className="text-sm text-stone-700 mb-3">
                Our designers will refine your layout — your tags are saved, so it's just $99 (regular $150).
              </p>
              <button className="text-sm font-semibold text-amber-900 hover:underline">
                Hand off to our team →
              </button>
            </div>
          </div>
        </div>
        <button
          onClick={onSubmit}
          className="bg-stone-900 text-stone-50 p-5 hover:bg-stone-800 transition-all flex items-center justify-between gap-3 text-left"
        >
          <div>
            <div className="text-[10px] tracking-widest opacity-70 mb-1">FINALIZE</div>
            <div className="font-serif text-2xl">Place my order</div>
          </div>
          <Icon name="arrowRight" size={20} />
        </button>
      </div>
    </div>
  );
}

interface SpreadRendererProps {
  spread: Spread | undefined;
  onSwap?: (photoIdx: number) => void;
  mini?: boolean;
}
function SpreadRenderer({ spread, onSwap, mini }: SpreadRendererProps) {
  if (!spread) return null;
  const { template, photos } = spread;
  const cls = mini ? 'cursor-pointer' : 'cursor-pointer hover:opacity-90 transition-opacity';

  if (template === 'full') {
    return (
      <img
        src={photos[0]?.src}
        alt=""
        className={`w-full h-full object-cover ${cls}`}
        onClick={() => onSwap?.(0)}
      />
    );
  }
  if (template === 'one') {
    return (
      <div className="w-full h-full grid grid-cols-2">
        <div className={mini ? '' : 'p-4 flex items-center justify-center'}>
          <img
            src={photos[0]?.src}
            alt=""
            className={`w-full h-full object-cover ${cls}`}
            onClick={() => onSwap?.(0)}
          />
        </div>
        <div className="bg-stone-50" />
      </div>
    );
  }
  if (template === 'two') {
    return (
      <div className={`w-full h-full grid grid-cols-2 ${mini ? 'gap-0.5' : 'gap-1'}`}>
        {photos.map((p, i) => (
          <img
            key={p.id}
            src={p.src}
            alt=""
            className={`w-full h-full object-cover ${cls}`}
            onClick={() => onSwap?.(i)}
          />
        ))}
      </div>
    );
  }
  return (
    <div className={`w-full h-full grid grid-cols-3 ${mini ? 'gap-0.5' : 'gap-1'}`}>
      {photos.map((p, i) => (
        <img
          key={p.id}
          src={p.src}
          alt=""
          className={`w-full h-full object-cover ${cls}`}
          onClick={() => onSwap?.(i)}
        />
      ))}
    </div>
  );
}

interface SubmitStepProps {
  spreads: Spread[];
  extraCost: number;
}
function SubmitStep({ spreads, extraCost }: SubmitStepProps) {
  return (
    <div className="max-w-2xl mx-auto pt-16 text-center">
      <div className="inline-flex p-4 bg-stone-900 text-stone-50 rounded-full mb-8">
        <Icon name="check" size={28} />
      </div>
      <p className="text-[11px] tracking-[0.3em] text-stone-500 uppercase mb-3">Order Received</p>
      <h1 className="font-serif text-5xl leading-tight mb-6">
        Your <em className="italic text-stone-700">monument</em><br />is being made.
      </h1>
      <p className="text-stone-600 mb-10 max-w-md mx-auto">
        Confirmation and invoice on the way to your inbox. Hand-bound and shipped within 12–16 days.
      </p>
      <div className="bg-white border border-stone-200 p-6 inline-block text-left text-sm">
        <div className="grid grid-cols-2 gap-x-12 gap-y-2">
          <span className="text-stone-500">Album size</span><span>17 × 24" closed</span>
          <span className="text-stone-500">Spreads</span><span>{spreads.length}</span>
          <span className="text-stone-500">Extra pages</span><span>${extraCost}</span>
          <span className="text-stone-500">Delivery</span><span>12–16 days</span>
        </div>
      </div>
    </div>
  );
}

// ---------- shared buttons ----------
interface NextBtnProps {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  iconName?: IconName;
}
function NextBtn({ onClick, label, disabled, iconName = 'arrowRight' }: NextBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group inline-flex items-center gap-3 px-8 py-4 transition-all ${
        disabled
          ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
          : 'bg-stone-900 text-stone-50 hover:bg-stone-800'
      }`}
    >
      <span className="font-serif text-lg">{label}</span>
      <Icon name={iconName} size={18} className="group-hover:translate-x-0.5 transition-transform" />
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-sm text-stone-500 hover:text-stone-900 mb-6 flex items-center gap-2"
    >
      <Icon name="arrowLeft" size={14} /> Back
    </button>
  );
}

// ============================================================
//                      INLINE SVG ICONS
//   (no lucide-react, no external deps)
// ============================================================
type IconName =
  | 'wand'
  | 'pen'
  | 'user'
  | 'upload'
  | 'sparkles'
  | 'crown'
  | 'bookmark'
  | 'eyeOff'
  | 'alert'
  | 'arrowRight'
  | 'arrowLeft'
  | 'refresh'
  | 'check';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}
function Icon({ name, size = 18, className = '' }: IconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };
  switch (name) {
    case 'wand':
      return (
        <svg {...props}>
          <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" />
        </svg>
      );
    case 'pen':
      return (
        <svg {...props}>
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
    case 'user':
      return (
        <svg {...props}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...props}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg {...props}>
          <path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3z" />
        </svg>
      );
    case 'crown':
      return (
        <svg {...props}>
          <path d="M2 6l4 12h12l4-12-6 4-4-8-4 8-6-4z" />
        </svg>
      );
    case 'bookmark':
      return (
        <svg {...props}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'eyeOff':
      return (
        <svg {...props}>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...props}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
        </svg>
      );
    case 'arrowRight':
      return (
        <svg {...props}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      );
    case 'arrowLeft':
      return (
        <svg {...props}>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...props}>
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
  }
}
