/**
 * Folio & Forever — Album Builder (Next.js port)
 *
 * Loaded as a plain <script> via Next.js <Script> on the /design route.
 * This file deliberately stays vanilla JS so the existing builder logic
 * keeps working without rewriting state into React. A future refactor
 * pass will lift this into proper React state — for now we ship parity.
 *
 * All top-level function declarations become globals (window.choosePath,
 * window.handleUpload, …) and are called from React onClick handlers in
 * `src/app/design/page.tsx`.
 *
 * Network endpoints are Next.js routes (created in Tasks #5 & #6):
 *   POST /api/upload   → accepts multipart file, returns { id, url }
 *   POST /api/designs  → accepts JSON design payload, returns { preview_url }
 *   GET  /api/designs/:token → loads a saved design
 *
 * Until those routes exist the upload path falls back to FileReader
 * data URLs so the builder can still be exercised against the preview
 * deploy.
 */

  let currentSpread = 0, totalSpreads = 10, zoomLevel = 0.8;
  let uploadedPhotos = {}, spreadData = [], selectedLayout = 'lf_2a', draggedPhotoId = null;
  // Tracks placeholder thumbs whose upload is still in flight.
  const pendingUploads = new Set();

  // ── BINDING / STYLE ─────────────────────────────────────────
  // 'layflat'  → no center gutter, photos can span the spine cleanly.
  // 'hardcover'→ press-printed photo book; visible 50% gutter, layouts
  //              must respect it (no slot crosses the center line).
  // Default is 'layflat' so existing serialized designs that predate this
  // field render with the cleaner option.
  let currentBinding = 'layflat';
  // Lock flips to true the moment the user drops or uploads a photo into
  // any slot. After that, switching binding requires explicit confirmation
  // via promptBindingChange() because slot geometry changes.
  let bindingLocked = false;
  // Photo-count filter for the layout rail. null = "Any". When set to
  // 1..6, the rail shows only layouts whose photoCount matches.
  let currentPhotoCountFilter = null;

  // ── SIZE CONFIG ─────────────────────────────────────────────
  const sizes = {
    spread_17x24: {
      key: 'spread_17x24',
      label: '17″ × 24″ Open Spread',
      unitLabel: 'Spread',
      width: 720,
      height: 510,
      isSpread: true
    },
    page_20x30: {
      key: 'page_20x30',
      label: '20″ × 30″ Single Page',
      unitLabel: 'Page',
      width: 720,
      height: 480,
      isSpread: false
    }
  };
  let currentSize = 'spread_17x24';

  // ── LAYOUT LIBRARY ──────────────────────────────────────────
  // Every layout is tagged with photoCount + binding so the right-rail
  // can filter to exactly what the customer needs.
  //
  //   binding: 'layflat'  → free to span the spine
  //   binding: 'hardcover'→ all slot edges must align with the 50% gutter
  //
  // slotAreas (optional) lets a slot span multiple grid cells via
  // grid-row-start/col-start/row-end/col-end. When omitted, slots flow
  // through grid cells in document order (CSS default).
  const layouts = [
    // ── LAYFLAT (no gutter) ──────────────────────────────────
    { id: 'lf_1a', name: 'Full Spread',    cols: '1fr',           rows: '1fr',           slots: 1, photoCount: 1, binding: 'layflat' },

    { id: 'lf_2a', name: 'Side by Side',   cols: '1fr 1fr',       rows: '1fr',           slots: 2, photoCount: 2, binding: 'layflat' },
    { id: 'lf_2b', name: 'Feature Left',   cols: '2fr 1fr',       rows: '1fr',           slots: 2, photoCount: 2, binding: 'layflat' },
    { id: 'lf_2c', name: 'Feature Right',  cols: '1fr 2fr',       rows: '1fr',           slots: 2, photoCount: 2, binding: 'layflat' },

    { id: 'lf_3a', name: 'Triptych',       cols: '1fr 1fr 1fr',   rows: '1fr',           slots: 3, photoCount: 3, binding: 'layflat' },
    { id: 'lf_3b', name: 'Top Feature',    cols: '1fr 1fr',       rows: '2fr 1fr',       slots: 3, photoCount: 3, binding: 'layflat',
      slotAreas: ['1 / 1 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'] },
    { id: 'lf_3c', name: 'Bottom Feature', cols: '1fr 1fr',       rows: '1fr 2fr',       slots: 3, photoCount: 3, binding: 'layflat',
      slotAreas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 3'] },

    { id: 'lf_4a', name: 'Quad Grid',      cols: '1fr 1fr',       rows: '1fr 1fr',       slots: 4, photoCount: 4, binding: 'layflat' },
    { id: 'lf_4b', name: 'Wide Strip',     cols: 'repeat(4, 1fr)', rows: '1fr',          slots: 4, photoCount: 4, binding: 'layflat' },
    { id: 'lf_4c', name: 'Feature + 3',    cols: '2fr 1fr',       rows: 'repeat(3, 1fr)', slots: 4, photoCount: 4, binding: 'layflat',
      slotAreas: ['1 / 1 / 4 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3', '3 / 2 / 4 / 3'] },

    { id: 'lf_5a', name: 'Feature + Quad', cols: '2fr 1fr 1fr',   rows: '1fr 1fr',       slots: 5, photoCount: 5, binding: 'layflat',
      slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '1 / 3 / 2 / 4', '2 / 2 / 3 / 3', '2 / 3 / 3 / 4'] },
    { id: 'lf_5b', name: 'Five Panel',     cols: '1fr 1fr 1fr',   rows: '1fr 1fr',       slots: 5, photoCount: 5, binding: 'layflat',
      slotAreas: ['1 / 1 / 2 / 3', '1 / 3 / 2 / 4', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3', '2 / 3 / 3 / 4'] },

    { id: 'lf_6a', name: 'Six Grid',       cols: '1fr 1fr 1fr',   rows: '1fr 1fr',       slots: 6, photoCount: 6, binding: 'layflat' },
    { id: 'lf_6b', name: 'Two by Three',   cols: '1fr 1fr',       rows: 'repeat(3, 1fr)', slots: 6, photoCount: 6, binding: 'layflat' },

    // ── HARDCOVER (gutter respected — every slot edge falls on 50%) ──
    { id: 'hc_1a', name: 'Left Page',      cols: '1fr 1fr',       rows: '1fr',           slots: 1, photoCount: 1, binding: 'hardcover',
      slotAreas: ['1 / 1 / 2 / 2'] },
    { id: 'hc_1b', name: 'Right Page',     cols: '1fr 1fr',       rows: '1fr',           slots: 1, photoCount: 1, binding: 'hardcover',
      slotAreas: ['1 / 2 / 2 / 3'] },

    { id: 'hc_2a', name: 'One Per Page',   cols: '1fr 1fr',       rows: '1fr',           slots: 2, photoCount: 2, binding: 'hardcover' },
    { id: 'hc_2b', name: 'Stacked Left',   cols: '1fr 1fr',       rows: '1fr 1fr',       slots: 2, photoCount: 2, binding: 'hardcover',
      slotAreas: ['1 / 1 / 2 / 2', '2 / 1 / 3 / 2'] },
    { id: 'hc_2c', name: 'Stacked Right',  cols: '1fr 1fr',       rows: '1fr 1fr',       slots: 2, photoCount: 2, binding: 'hardcover',
      slotAreas: ['1 / 2 / 2 / 3', '2 / 2 / 3 / 3'] },

    { id: 'hc_3a', name: '1 Left · 2 Right', cols: '1fr 1fr',     rows: '1fr 1fr',       slots: 3, photoCount: 3, binding: 'hardcover',
      slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'] },
    { id: 'hc_3b', name: '2 Left · 1 Right', cols: '1fr 1fr',     rows: '1fr 1fr',       slots: 3, photoCount: 3, binding: 'hardcover',
      slotAreas: ['1 / 1 / 2 / 2', '2 / 1 / 3 / 2', '1 / 2 / 3 / 3'] },

    { id: 'hc_4a', name: '2×2 Grid',       cols: '1fr 1fr',       rows: '1fr 1fr',       slots: 4, photoCount: 4, binding: 'hardcover' },
    { id: 'hc_4b', name: 'Wide Strip',     cols: 'repeat(4, 1fr)', rows: '1fr',          slots: 4, photoCount: 4, binding: 'hardcover' },

    { id: 'hc_6a', name: '3 Per Page',     cols: 'repeat(4, 1fr)', rows: '1fr 1fr',      slots: 6, photoCount: 6, binding: 'hardcover',
      slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3', '1 / 3 / 2 / 4', '2 / 3 / 3 / 4', '1 / 4 / 3 / 5'] }
  ];

  // Quick lookup by id — replaces the old integer-index access pattern.
  function findLayout(id) {
    return layouts.find(l => l.id === id) || layouts[0];
  }

  // Returns layouts that match the current binding plus an optional
  // photoCount filter. Used by renderLayoutPanel and the filter rail.
  function getVisibleLayouts() {
    return layouts.filter(l => {
      if (l.binding !== currentBinding) return false;
      if (currentPhotoCountFilter !== null && l.photoCount !== currentPhotoCountFilter) return false;
      return true;
    });
  }

  for (let i = 0; i < totalSpreads; i++) spreadData.push({ layoutId: 'lf_2a', slots: [null, null], bg: { type: 'solid', color: '#f8f4ee' } });

  // ── PRICING ──────────────────────────────────────────────────
  // All prices in USD. "Included" is the spread count baked into the
  // base price; anything beyond costs `perExtra` per spread. Edit this
  // block to change rates — the runtime reads it on every recompute, so
  // no other code needs to change.
  //
  // Cover materials:
  //   leather → included
  //   photo   → included
  //   acrylic → adds the size-specific surcharge below
  //
  // Note: the 20×30 size is a single-page mode in the builder, but per
  // Jayvee's spec the same lay-flat / hardcover binding choice applies
  // and changes the per-sheet price. If 20×30 lay-flat ever turns out
  // to be a non-product, drop the layflat row from PRICING['20x30'].
  const PRICING = {
    '17x24': {
      layflat:   { base: 275, included: 10, perExtra: 10 },
      hardcover: { base: 240, included: 10, perExtra: 8 }
    },
    '20x30': {
      layflat:   { base: 375, included: 10, perExtra: 15 },
      hardcover: { base: 340, included: 10, perExtra: 12 }
    },
    acrylicCover: {
      '17x24': 40,
      '20x30': 65
    }
  };

  function _sizeShortKey() {
    return currentSize === 'spread_17x24' ? '17x24' : '20x30';
  }

  // Returns a structured breakdown so both the toolbar tag and the modal
  // can render the same numbers.
  function computePrice() {
    const sizeKey = _sizeShortKey();
    const tier = (PRICING[sizeKey] && PRICING[sizeKey][currentBinding]) || PRICING['17x24'].layflat;
    const extras = Math.max(0, totalSpreads - tier.included);
    const extrasCost = extras * tier.perExtra;
    const spreadCost = tier.base + extrasCost;

    // Cover state is owned by the React cover-builder; it mirrors itself
    // onto window.__coverState. Default to leather (free) until set.
    const cover = (window.__coverState && window.__coverState.type) || 'leather';
    const acrylicAdd = cover === 'acrylic' ? (PRICING.acrylicCover[sizeKey] || 0) : 0;

    return {
      sizeKey: sizeKey,
      sizeLabel: sizeKey === '17x24' ? '17×24' : '20×30 Poster',
      binding: currentBinding,
      bindingLabel: currentBinding === 'layflat' ? 'Lay-Flat' : 'Coffee-Table',
      base: tier.base,
      included: tier.included,
      totalSpreads: totalSpreads,
      extras: extras,
      perExtra: tier.perExtra,
      extrasCost: extrasCost,
      spreadCost: spreadCost,
      cover: cover,
      acrylicAdd: acrylicAdd,
      total: spreadCost + acrylicAdd,
      currency: 'USD'
    };
  }

  // Drops the running total into the navbar pill. The full breakdown
  // (with each line item) is rendered into the modal in renderPriceBreakdown.
  function renderPriceTag() {
    const el = document.getElementById('priceTag');
    if (!el) return;
    // Stays hidden until a binding is selected so we don't flash $275
    // on the path-choice page before the customer has decided.
    el.style.display = 'inline-flex';
    const p = computePrice();
    el.textContent = '$' + p.total + ' ' + p.currency;
    // Native tooltip — instant explanation if customer hovers.
    el.title =
      p.bindingLabel + ' ' + p.sizeLabel + ' base: $' + p.base + '\n' +
      (p.extras > 0
        ? '+ ' + p.extras + ' extra spread' + (p.extras === 1 ? '' : 's') + ' × $' + p.perExtra + ' = $' + p.extrasCost + '\n'
        : '') +
      (p.acrylicAdd > 0 ? '+ Acrylic cover: $' + p.acrylicAdd + '\n' : '') +
      'Total: $' + p.total + ' ' + p.currency;
  }

  // Renders the line-item breakdown into the submit modal. Called when
  // the modal opens so we always pick up the latest cover state.
  function renderPriceBreakdown() {
    const el = document.getElementById('priceBreakdown');
    if (!el) return;
    const p = computePrice();
    const lines = [];
    lines.push('<div class="pb-row"><span>' + p.bindingLabel + ' ' + p.sizeLabel + ' (' + p.included + ' spreads)</span><span>$' + p.base + '</span></div>');
    if (p.extras > 0) {
      lines.push('<div class="pb-row"><span>' + p.extras + ' extra spread' + (p.extras === 1 ? '' : 's') + ' × $' + p.perExtra + '</span><span>$' + p.extrasCost + '</span></div>');
    }
    if (p.cover === 'acrylic') {
      lines.push('<div class="pb-row"><span>Acrylic cover</span><span>$' + p.acrylicAdd + '</span></div>');
    } else {
      lines.push('<div class="pb-row pb-row-muted"><span>' + (p.cover === 'leather' ? 'Leather' : 'Photo') + ' cover</span><span>Included</span></div>');
    }
    lines.push('<div class="pb-row pb-total"><span>Total</span><span>$' + p.total + ' ' + p.currency + '</span></div>');
    el.innerHTML = lines.join('');
  }

  function choosePath(type) {
    const intro = document.getElementById('introSection');
    if (intro) intro.style.display = 'none';
    if (type === 'self') {
      // Self-design path: size first, then binding, then builder.
      // pickSize() advances to bindingSection; selectBinding() opens
      // the builder.
      const size = document.getElementById('sizeSection');
      if (size) size.classList.add('active');
    } else {
      const expert = document.getElementById('expertSection');
      if (expert) expert.classList.add('active');
    }
  }

  // Called from the size-picker cards in page.tsx. Sets currentSize,
  // updates the toolbar size-switcher highlight, and advances to the
  // binding picker. We don't call applySizeToCanvas() here because the
  // canvas DOM doesn't exist yet (builder section is still hidden) —
  // selectBinding() handles that once everything is mounted.
  function pickSize(sizeKey) {
    if (!sizes[sizeKey]) return;
    currentSize = sizeKey;
    document.querySelectorAll('.size-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.size === sizeKey);
    });
    const sizeSec = document.getElementById('sizeSection');
    if (sizeSec) sizeSec.classList.remove('active');
    const bindingSec = document.getElementById('bindingSection');
    if (bindingSec) bindingSec.classList.add('active');
  }

  // Called from the binding-picker cards in page.tsx. type is
  // 'layflat' | 'hardcover'. Sets the global, swaps the binding section
  // out, opens the builder, and seeds the layout panel filtered to the
  // chosen binding type.
  function selectBinding(type) {
    if (type !== 'layflat' && type !== 'hardcover') return;
    currentBinding = type;
    bindingLocked = false;

    // Reset every spread's layout to a sensible default for the new
    // binding so we never start with lay-flat-only layouts under a
    // hardcover binding (or vice versa).
    const defaultId = type === 'layflat' ? 'lf_2a' : 'hc_2a';
    selectedLayout = defaultId;
    spreadData.forEach(s => {
      s.layoutId = defaultId;
      s.slots = new Array(findLayout(defaultId).slots).fill(null);
    });

    const binding = document.getElementById('bindingSection');
    if (binding) binding.classList.remove('active');
    const builder = document.getElementById('builderSection');
    if (builder) builder.classList.add('active');
    const submitBtn = document.getElementById('navSubmitBtn');
    if (submitBtn) submitBtn.style.display = 'block';
    const saveBtn = document.getElementById('navSaveBtn');
    if (saveBtn) saveBtn.style.display = 'block';
    const changeBtn = document.getElementById('changeBindingBtn');
    if (changeBtn) changeBtn.style.display = 'inline-flex';
    syncBindingLabel();

    applySizeToCanvas(currentSize);
    renderPhotoCountTabs();
    renderLayoutPanel();
    renderPageStrip();
    renderCanvas();
    updateSpreadInfoLabel();
    renderPriceTag();
  }

  // The "Change binding" button calls this. If photos are already placed
  // we warn loudly — switching can change slot geometry and may force
  // photos to relayout into different positions. Cancellable.
  function promptBindingChange() {
    const placedCount = spreadData.reduce(
      (n, s) => n + s.slots.filter(Boolean).length, 0
    );
    if (placedCount > 0) {
      const ok = confirm(
        'Switching binding will reset all spread layouts and may unplace photos near the spine.\n\n' +
        'Your uploads stay in the photo grid. Continue?'
      );
      if (!ok) return;
    }
    // Send the user back to the binding picker. selectBinding() will
    // re-seed everything once they pick.
    const builder = document.getElementById('builderSection');
    if (builder) builder.classList.remove('active');
    const binding = document.getElementById('bindingSection');
    if (binding) binding.classList.add('active');
  }

  function syncBindingLabel() {
    const label = document.getElementById('currentBindingLabel');
    if (!label) return;
    // Both products are hardcover — the user-facing label distinguishes
    // by binding behaviour, not by cover type.
    label.textContent = currentBinding === 'layflat' ? 'Lay-Flat' : 'Coffee-Table';
  }

  // Marks the binding as locked once the customer commits a photo. The
  // lock is advisory — promptBindingChange() still lets them switch, it
  // just makes them confirm.
  function _lockBindingNow() {
    if (bindingLocked) return;
    bindingLocked = true;
  }

  function setSize(sizeKey) {
    if (!sizes[sizeKey] || sizeKey === currentSize) return;
    currentSize = sizeKey;
    applySizeToCanvas(sizeKey);
    document.querySelectorAll('.size-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.size === sizeKey);
    });
    updateSpreadInfoLabel();
    // Size change flips the per-spread rate AND can flip the acrylic
    // surcharge ($40 → $65), so the price tag has to refresh.
    renderPriceTag();
  }

  function applySizeToCanvas(sizeKey) {
    const s = sizes[sizeKey];
    const canvas = document.getElementById('spreadCanvas');
    if (!canvas) return;
    canvas.style.width = s.width + 'px';
    canvas.style.height = s.height + 'px';
    canvas.dataset.size = sizeKey;
    canvas.classList.toggle('is-spread', s.isSpread);
    canvas.classList.toggle('is-single-page', !s.isSpread);
    // .is-layflat overrides the .is-spread::after gutter line.
    canvas.classList.toggle('is-layflat', currentBinding === 'layflat');
    canvas.classList.toggle('is-hardcover', currentBinding === 'hardcover');
  }

  function updateSpreadInfoLabel() {
    const info = document.getElementById('spreadInfo');
    if (!info) return;
    const unit = sizes[currentSize].unitLabel;
    info.textContent = unit + ' ' + (currentSpread + 1) + ' of ' + totalSpreads;
  }

  // Render the photo-count filter tabs above the layout list. Six options
  // (1–6) plus an "Any" reset. Click flips currentPhotoCountFilter then
  // re-renders the list below.
  function renderPhotoCountTabs() {
    const tabs = document.getElementById('photoCountTabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    const opts = [
      { label: 'Any', val: null },
      { label: '1', val: 1 },
      { label: '2', val: 2 },
      { label: '3', val: 3 },
      { label: '4', val: 4 },
      { label: '5', val: 5 },
      { label: '6', val: 6 }
    ];
    opts.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pc-tab' + (currentPhotoCountFilter === o.val ? ' active' : '');
      b.textContent = o.label;
      b.onclick = () => {
        currentPhotoCountFilter = o.val;
        renderPhotoCountTabs();
        renderLayoutPanel();
      };
      tabs.appendChild(b);
    });
  }

  // Build a small visual preview thumbnail showing where each slot sits.
  // Honors slotAreas for non-rectangular spans so the thumb actually looks
  // like the spread will look.
  function buildLayoutPreviewMarkup(l) {
    const preview = document.createElement('div');
    preview.className = 'layout-preview';
    preview.style.gridTemplateColumns = l.cols;
    preview.style.gridTemplateRows = l.rows;
    if (l.slotAreas && l.slotAreas.length) {
      l.slotAreas.forEach(area => {
        const cell = document.createElement('div');
        cell.className = 'lp-cell';
        cell.style.gridArea = area;
        preview.appendChild(cell);
      });
    } else {
      for (let i = 0; i < l.slots; i++) {
        const cell = document.createElement('div');
        cell.className = 'lp-cell';
        preview.appendChild(cell);
      }
    }
    return preview;
  }

  function renderLayoutPanel() {
    const c = document.getElementById('layoutScroll');
    if (!c) return;
    c.innerHTML = '';
    const visible = getVisibleLayouts();
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'layout-empty';
      empty.textContent = 'No layouts for that count yet — try another.';
      c.appendChild(empty);
      return;
    }
    // Group by photoCount when "Any" is active so the rail still has structure.
    if (currentPhotoCountFilter === null) {
      const groups = [1, 2, 3, 4, 5, 6];
      groups.forEach(n => {
        const inGroup = visible.filter(l => l.photoCount === n);
        if (!inGroup.length) return;
        const title = document.createElement('span');
        title.className = 'layout-section-title';
        title.textContent = n + (n === 1 ? ' Photo' : ' Photos');
        c.appendChild(title);
        inGroup.forEach(l => c.appendChild(buildLayoutThumb(l)));
      });
    } else {
      visible.forEach(l => c.appendChild(buildLayoutThumb(l)));
    }
  }

  function buildLayoutThumb(l) {
    const div = document.createElement('div');
    div.className = 'layout-thumb' + (l.id === selectedLayout ? ' active' : '');
    div.dataset.layoutId = l.id;
    div.onclick = () => applyLayout(l.id);
    div.appendChild(buildLayoutPreviewMarkup(l));
    const name = document.createElement('span');
    name.className = 'layout-name';
    name.textContent = l.name;
    div.appendChild(name);
    return div;
  }

  function applyLayout(layoutId) {
    const l = findLayout(layoutId);
    if (!l) return;
    selectedLayout = l.id;
    const spread = spreadData[currentSpread];
    const old = [...spread.slots];
    spread.layoutId = l.id;
    spread.slots = new Array(l.slots).fill(null);
    // Auto-flow existing photos into the new slots in original order;
    // anything past the new slot count drops back to the photo grid
    // (it stays in uploadedPhotos, just no longer placed).
    for (let i = 0; i < Math.min(old.length, l.slots); i++) spread.slots[i] = old[i];
    renderCanvas();
    document.querySelectorAll('.layout-thumb').forEach(el => {
      el.classList.toggle('active', el.dataset.layoutId === l.id);
    });
  }

  function renderCanvas() {
    const spread = spreadData[currentSpread];
    const l = findLayout(spread.layoutId);
    const slotsDiv = document.getElementById('layoutSlots');
    if (!slotsDiv) return;
    slotsDiv.style.gridTemplateColumns = l.cols;
    slotsDiv.style.gridTemplateRows = l.rows;
    const canvas = document.getElementById('spreadCanvas');
    const existingTexts = canvas ? Array.from(canvas.querySelectorAll('.text-overlay')) : [];
    slotsDiv.innerHTML = '';
    spread.slots.forEach((slotData, idx) => {
      const slot = document.createElement('div');
      slot.className = 'photo-slot';
      slot.dataset.idx = idx;
      // If the layout defines slotAreas, pin each slot to its grid area
      // so non-rectangular spans (feature + small grid, etc.) work.
      if (l.slotAreas && l.slotAreas[idx]) {
        slot.style.gridArea = l.slotAreas[idx];
      }
      slot.ondragover = e => { e.preventDefault(); slot.classList.add('drag-over'); };
      slot.ondragleave = () => slot.classList.remove('drag-over');
      slot.ondrop = e => { e.preventDefault(); slot.classList.remove('drag-over'); dropPhoto(idx); };

      const imgSrc = slotData ? (typeof slotData === 'object' ? slotData.src : slotData) : null;

      if (imgSrc) {
        const imgData = typeof slotData === 'object'
          ? slotData
          : { src: slotData, px: 0, py: 0, scale: 1, rotate: 0, flipX: false, flipY: false, filter: '' };
        if (typeof slotData === 'string') spread.slots[idx] = imgData;
        if (imgData.px === undefined) { imgData.px = 0; imgData.py = 0; }

        const img = document.createElement('img');
        img.src = imgSrc;
        img.draggable = false;
        applyImgTransform(img, imgData);

        const zi = document.createElement('div');
        zi.className = 'zoom-indicator';
        zi.textContent = Math.round((imgData.scale || 1) * 100) + '%';

        const rm = document.createElement('button');
        rm.className = 'slot-remove';
        rm.innerHTML = '×';
        rm.onclick = e => {
          e.stopPropagation();
          saveHistory();
          spread.slots[idx] = null;
          exitEditMode();
          renderCanvas();
        };

        slot.appendChild(img);
        slot.appendChild(zi);
        slot.appendChild(rm);

        slot.onclick = e => {
          if (e.target === rm) return;
          enterEditMode(slot, idx, imgData, img);
        };
      } else {
        slot.innerHTML = '<span class="slot-hint">Drop photo<br>or click to upload</span>';
        slot.onclick = () => triggerSlotUpload(idx);
      }
      slotsDiv.appendChild(slot);
    });

    if (canvas) {
      existingTexts.forEach(t => canvas.appendChild(t));
      applyBackgroundToCanvas(canvas, spread);
      canvas.style.transform = 'scale(' + zoomLevel + ')';
    }
    updateSpreadInfoLabel();
    updatePageStrip();
  }

  // Renders the spread bg from the new bg model.
  //   { type: 'solid', color }                            → flat color
  //   { type: 'photo', photoSrc, fade: 0..1 }             → photo with white-fade overlay
  // Fall back to the legacy `bgColor` field if the new shape isn't set.
  function applyBackgroundToCanvas(canvas, spread) {
    const bg = spread.bg || { type: 'solid', color: spread.bgColor || '#f8f4ee' };
    // Normalize legacy shape on the fly so saves stay clean.
    spread.bg = bg;
    if (bg.type === 'photo' && bg.photoSrc) {
      const fade = Math.max(0, Math.min(1, bg.fade ?? 0.6));
      // Layered: white wash on top of the photo. Higher fade → more white.
      canvas.style.background =
        'linear-gradient(rgba(255,255,255,' + fade + '), rgba(255,255,255,' + fade + ')), ' +
        'url("' + bg.photoSrc + '") center / cover no-repeat';
    } else {
      canvas.style.background = bg.color || '#f8f4ee';
    }
  }

  function applyImgTransform(img, d) {
    const s = d.scale || 1;
    const px = d.px || 0;
    const py = d.py || 0;
    const r = d.rotate || 0;
    const fx = d.flipX ? -1 : 1;
    const fy = d.flipY ? -1 : 1;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.objectPosition = 'center';
    img.style.transformOrigin = 'center center';
    img.style.transform = 'translate(' + px + 'px, ' + py + 'px) scale(' + (s * fx) + ', ' + (s * fy) + ') rotate(' + r + 'deg)';
    img.style.filter = d.filter || '';
    img.style.transition = 'none';
  }

  let editingSlot = null, editingIdx = null, editingImgData = null, editingImg = null;

  function showFloatToolbar() {
    const tb = document.getElementById('photoFloatToolbar');
    if (tb) tb.classList.add('visible');
    syncZoomSlider();
  }
  function hideFloatToolbar() {
    const tb = document.getElementById('photoFloatToolbar');
    if (tb) tb.classList.remove('visible');
  }

  function syncZoomSlider() {
    if (!editingImgData) return;
    const pct = Math.round((editingImgData.scale || 1) * 100);
    const slider = document.getElementById('zoomSlider');
    const label = document.getElementById('ftbZoomVal');
    if (slider) slider.value = pct;
    if (label) label.textContent = pct + '%';
  }

  function ftbZoomSlider(val) {
    if (!editingImgData || !editingImg) return;
    editingImgData.scale = parseInt(val) / 100;
    applyImgTransform(editingImg, editingImgData);
    const lbl = document.getElementById('ftbZoomVal');
    if (lbl) lbl.textContent = val + '%';
    updateZoomIndicator();
  }

  function ftbZoomStep(delta) {
    if (!editingImgData || !editingImg) return;
    saveHistory();
    editingImgData.scale = Math.max(0.3, Math.min(5, (editingImgData.scale || 1) + delta));
    applyImgTransform(editingImg, editingImgData);
    syncZoomSlider();
    updateZoomIndicator();
  }

  function ftbFitFill() {
    if (!editingImgData) return;
    saveHistory();
    editingImgData.scale = 2;
    editingImgData.px = 0;
    editingImgData.py = 0;
    applyImgTransform(editingImg, editingImgData);
    syncZoomSlider();
    updateZoomIndicator();
  }
  function ftbFitOriginal() {
    if (!editingImgData) return;
    saveHistory();
    editingImgData.scale = 1;
    editingImgData.px = 0;
    editingImgData.py = 0;
    applyImgTransform(editingImg, editingImgData);
    syncZoomSlider();
    updateZoomIndicator();
  }
  function ftbFlip(axis) {
    if (!editingImgData) return;
    saveHistory();
    if (axis === 'x') editingImgData.flipX = !editingImgData.flipX;
    else editingImgData.flipY = !editingImgData.flipY;
    applyImgTransform(editingImg, editingImgData);
  }
  function ftbRotate(deg) {
    if (!editingImgData) return;
    saveHistory();
    editingImgData.rotate = ((editingImgData.rotate || 0) + deg + 360) % 360;
    applyImgTransform(editingImg, editingImgData);
  }
  function ftbReset() {
    if (!editingImgData) return;
    saveHistory();
    editingImgData.scale = 1;
    editingImgData.px = 0;
    editingImgData.py = 0;
    editingImgData.rotate = 0;
    editingImgData.flipX = false;
    editingImgData.flipY = false;
    applyImgTransform(editingImg, editingImgData);
    syncZoomSlider();
    updateZoomIndicator();
  }
  function ftbDelete() {
    if (editingIdx === null) return;
    saveHistory();
    spreadData[currentSpread].slots[editingIdx] = null;
    exitEditMode();
    renderCanvas();
  }

  function updateZoomIndicator() {
    if (!editingSlot || !editingImgData) return;
    const zi = editingSlot.querySelector('.zoom-indicator');
    if (zi) zi.textContent = Math.round((editingImgData.scale || 1) * 100) + '%';
  }

  function enterEditMode(slot, idx, imgData, img) {
    exitEditMode();
    slot.classList.add('editing');
    slot.style.cursor = 'grab';
    editingSlot = slot;
    editingIdx = idx;
    editingImgData = imgData;
    editingImg = img;
    showFloatToolbar();
    updateZoomIndicator();

    let isPanning = false, startMouseX, startMouseY, startPx, startPy;

    const onDown = e => {
      if (e.button !== 0) return;
      const tb = document.getElementById('photoFloatToolbar');
      if ((tb && tb.contains(e.target)) || e.target.classList.contains('slot-remove')) return;
      isPanning = true;
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      startPx = imgData.px || 0;
      startPy = imgData.py || 0;
      slot.style.cursor = 'grabbing';
      e.preventDefault();
    };
    const onMove = e => {
      if (!isPanning) return;
      imgData.px = startPx + (e.clientX - startMouseX);
      imgData.py = startPy + (e.clientY - startMouseY);
      applyImgTransform(img, imgData);
    };
    const onUp = () => {
      if (isPanning) { isPanning = false; slot.style.cursor = 'grab'; saveHistory(); }
    };
    const onWheel = e => {
      e.preventDefault();
      e.stopPropagation();
      editingImgData.scale = Math.max(0.3, Math.min(5, (editingImgData.scale || 1) + (e.deltaY > 0 ? -0.04 : 0.04)));
      applyImgTransform(editingImg, editingImgData);
      syncZoomSlider();
      updateZoomIndicator();
    };

    slot.addEventListener('mousedown', onDown);
    slot.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    slot._cleanup = () => {
      slot.removeEventListener('mousedown', onDown);
      slot.removeEventListener('wheel', onWheel);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }

  function exitEditMode() {
    if (editingSlot) {
      editingSlot.classList.remove('editing');
      editingSlot.style.cursor = '';
      if (editingSlot._cleanup) { editingSlot._cleanup(); editingSlot._cleanup = null; }
    }
    editingSlot = null;
    editingIdx = null;
    editingImgData = null;
    editingImg = null;
    hideFloatToolbar();
  }

  document.addEventListener('mousedown', e => {
    if (!editingSlot) return;
    const tb = document.getElementById('photoFloatToolbar');
    if (!editingSlot.contains(e.target) && (!tb || !tb.contains(e.target))) exitEditMode();
  });

  let selectedSlotIdx = null;

  function getImgData(idx) {
    const raw = spreadData[currentSpread].slots[idx];
    if (!raw) return null;
    if (typeof raw === 'string') {
      spreadData[currentSpread].slots[idx] = { src: raw, px: 0, py: 0, scale: 1, rotate: 0, flipX: false, flipY: false, filter: '' };
    }
    return spreadData[currentSpread].slots[idx];
  }

  // ── FILTERS ──
  function toggleFilterStrip() {
    const fs = document.getElementById('filterStrip');
    const bg = document.getElementById('bgPicker');
    if (fs) fs.classList.toggle('open');
    if (bg) bg.classList.remove('open');
  }
  function applyFilter(filterVal, btn) {
    const idx = editingIdx !== null ? editingIdx : selectedSlotIdx;
    if (idx === null) { alert('Click a photo first to select it, then apply a filter.'); return; }
    saveHistory();
    const d = getImgData(idx);
    if (!d) return;
    d.filter = filterVal;
    if (editingSlot) {
      const img = editingSlot.querySelector('img');
      if (img) img.style.filter = filterVal;
    }
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // ── BACKGROUND ──
  // Three modes live in the same panel; switched via tabs.
  //   solid → curated swatches + custom hex
  //   photo → backdrop image (one of the uploads) + white-fade slider
  // Each spread carries its own bg object so navigating spreads restores
  // whatever the customer set there.
  function toggleBgPicker() {
    const bg = document.getElementById('bgPicker');
    const fs = document.getElementById('filterStrip');
    if (bg) bg.classList.toggle('open');
    if (fs) fs.classList.remove('open');
    if (bg && bg.classList.contains('open')) renderBgPanel();
  }

  // Render the bg panel from the active spread's bg state. Called on open
  // and after any sub-control change so tabs/swatches/sliders stay in sync
  // when navigating between spreads.
  function renderBgPanel() {
    const panel = document.getElementById('bgPicker');
    if (!panel) return;
    const spread = spreadData[currentSpread];
    const bg = spread.bg || (spread.bg = { type: 'solid', color: '#f8f4ee' });
    const mode = bg.type;

    panel.innerHTML = '';

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'bg-tabs';
    [['solid', 'Solid'], ['photo', 'Photo Backdrop']].forEach(([key, label]) => {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'bg-tab' + (mode === key ? ' active' : '');
      t.textContent = label;
      t.onclick = () => setBgMode(key);
      tabs.appendChild(t);
    });
    panel.appendChild(tabs);

    if (mode === 'solid') {
      const row = document.createElement('div');
      row.className = 'bg-tab-body';
      const swatches = [
        { color: '#f8f4ee', title: 'Cream' },
        { color: '#ffffff', title: 'White' },
        { color: '#0e0c09', title: 'Black' },
        { color: '#1a1610', title: 'Dark' },
        { color: '#2a2218', title: 'Dark Brown' },
        { color: '#b8965a', title: 'Gold' },
        { color: '#e8d5b0', title: 'Light Cream' },
        { color: '#2c2c2c', title: 'Charcoal' },
        { color: '#4a3728', title: 'Walnut' }
      ];
      swatches.forEach(s => {
        const sw = document.createElement('div');
        sw.className = 'bg-swatch' + ((bg.color || '').toLowerCase() === s.color.toLowerCase() ? ' active' : '');
        sw.style.background = s.color;
        sw.title = s.title;
        sw.onclick = () => setBgColor(s.color);
        row.appendChild(sw);
      });
      // Custom hex slot — small input that accepts #rrggbb.
      const customWrap = document.createElement('label');
      customWrap.className = 'bg-custom';
      customWrap.title = 'Custom hex (e.g. #b8965a)';
      const swCustom = document.createElement('div');
      swCustom.className = 'bg-swatch bg-swatch-custom';
      swCustom.style.background = bg.color && bg.color.startsWith('#') ? bg.color : 'conic-gradient(red, orange, yellow, green, blue, indigo, violet, red)';
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = (bg.color && /^#([0-9a-f]{6})$/i.test(bg.color)) ? bg.color : '#b8965a';
      inp.onchange = e => setBgColor(e.target.value);
      customWrap.appendChild(swCustom);
      customWrap.appendChild(inp);
      row.appendChild(customWrap);
      panel.appendChild(row);
    } else if (mode === 'photo') {
      const body = document.createElement('div');
      body.className = 'bg-tab-body bg-photo-body';
      const photoIds = Object.keys(uploadedPhotos);
      if (!photoIds.length) {
        const hint = document.createElement('p');
        hint.className = 'bg-photo-hint';
        hint.textContent = 'Upload photos first — then pick one as the backdrop.';
        body.appendChild(hint);
      } else {
        const grid = document.createElement('div');
        grid.className = 'bg-photo-grid';
        photoIds.forEach(id => {
          const src = typeof uploadedPhotos[id] === 'object' ? uploadedPhotos[id].src : uploadedPhotos[id];
          const t = document.createElement('div');
          t.className = 'bg-photo-thumb' + (bg.photoSrc === src ? ' active' : '');
          t.style.backgroundImage = 'url("' + src + '")';
          t.onclick = () => setBgPhoto(src);
          grid.appendChild(t);
        });
        body.appendChild(grid);

        const fadeWrap = document.createElement('div');
        fadeWrap.className = 'bg-fade-wrap';
        const fadeLabel = document.createElement('span');
        fadeLabel.className = 'bg-fade-label';
        const initialFade = Math.round(((bg.fade ?? 0.6) * 100));
        fadeLabel.textContent = 'White fade: ' + initialFade + '%';
        const fadeInput = document.createElement('input');
        fadeInput.type = 'range';
        fadeInput.min = 0;
        fadeInput.max = 100;
        fadeInput.step = 1;
        fadeInput.value = initialFade;
        fadeInput.oninput = e => {
          const v = parseInt(e.target.value, 10);
          fadeLabel.textContent = 'White fade: ' + v + '%';
          setBgFade(v / 100);
        };
        fadeWrap.appendChild(fadeLabel);
        fadeWrap.appendChild(fadeInput);
        body.appendChild(fadeWrap);
      }
      panel.appendChild(body);
    }
  }

  function setBgMode(mode) {
    saveHistory();
    const spread = spreadData[currentSpread];
    if (mode === 'solid') {
      spread.bg = { type: 'solid', color: (spread.bg && spread.bg.color) || '#f8f4ee' };
    } else if (mode === 'photo') {
      spread.bg = {
        type: 'photo',
        photoSrc: (spread.bg && spread.bg.photoSrc) || '',
        fade: (spread.bg && spread.bg.fade) ?? 0.6
      };
    }
    renderBgPanel();
    renderCanvas();
  }

  function setBgColor(color) {
    saveHistory();
    const spread = spreadData[currentSpread];
    spread.bg = { type: 'solid', color: color };
    renderBgPanel();
    renderCanvas();
  }

  function setBgPhoto(src) {
    saveHistory();
    const spread = spreadData[currentSpread];
    const fade = (spread.bg && spread.bg.fade) ?? 0.6;
    spread.bg = { type: 'photo', photoSrc: src, fade: fade };
    renderBgPanel();
    renderCanvas();
  }

  function setBgFade(fade) {
    const spread = spreadData[currentSpread];
    if (!spread.bg || spread.bg.type !== 'photo') return;
    spread.bg.fade = fade;
    // No history push on every tick — only renderCanvas.
    renderCanvas();
  }

  // ── TEXT OVERLAY ──
  function addTextOverlay() {
    const canvas = document.getElementById('spreadCanvas');
    if (!canvas) return;
    const wrap = document.createElement('div');
    wrap.className = 'text-overlay';
    wrap.style.left = '40px';
    wrap.style.top = '40px';
    const inner = document.createElement('div');
    inner.className = 'text-overlay-inner';
    inner.contentEditable = 'true';
    inner.textContent = 'Your text here';
    const del = document.createElement('button');
    del.className = 'text-del';
    del.innerHTML = '×';
    del.onclick = () => wrap.remove();
    wrap.appendChild(inner);
    wrap.appendChild(del);
    wrap.onmousedown = e => {
      if (e.target === inner || e.target === del) return;
      const ox = e.clientX - wrap.offsetLeft, oy = e.clientY - wrap.offsetTop;
      const mm = ev => { wrap.style.left = (ev.clientX - ox) + 'px'; wrap.style.top = (ev.clientY - oy) + 'px'; };
      const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    };
    canvas.appendChild(wrap);
    inner.focus();
    document.execCommand('selectAll');
  }

  // ── UNDO / REDO ──
  let history = [], future = [];
  function saveHistory() {
    history.push(JSON.stringify(spreadData.map(s => ({ ...s, slots: [...s.slots] }))));
    if (history.length > 30) history.shift();
    future = [];
  }
  function doUndo() {
    if (!history.length) return;
    future.push(JSON.stringify(spreadData.map(s => ({ ...s, slots: [...s.slots] }))));
    spreadData = JSON.parse(history.pop());
    renderCanvas();
  }
  function doRedo() {
    if (!future.length) return;
    history.push(JSON.stringify(spreadData.map(s => ({ ...s, slots: [...s.slots] }))));
    spreadData = JSON.parse(future.pop());
    renderCanvas();
  }

  /**
   * storePhoto — uploads file to Next.js /api/upload (Drive-backed in production).
   * Falls back to FileReader data URLs while /api/upload is unimplemented so the
   * builder still works against the preview deploy.
   */
  function storePhoto(file, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload', true);

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && typeof onProgress === 'function') {
          const pct = Math.min(90, (ev.loaded / ev.total) * 90);
          onProgress({ stage: 'uploading', pct });
        }
      };
      xhr.upload.onload = () => {
        if (typeof onProgress === 'function') onProgress({ stage: 'processing', pct: 90 });
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300 && data && data.url) {
          if (typeof onProgress === 'function') onProgress({ stage: 'done', pct: 100 });
          resolve({ id: 'photo_' + (data.id || Date.now()), src: data.url });
        } else if (xhr.status === 404) {
          // /api/upload not implemented yet — fall back to local data URL.
          fallbackToDataUrl(file, onProgress).then(resolve, reject);
        } else {
          const msg = (data && (data.message || data.code)) || ('HTTP ' + xhr.status);
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => fallbackToDataUrl(file, onProgress).then(resolve, reject);
      xhr.ontimeout = () => reject(new Error('Upload timed out'));
      xhr.timeout = 180000;
      xhr.send(fd);
    });
  }

  function fallbackToDataUrl(file, onProgress) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = ev => {
        if (typeof onProgress === 'function') onProgress({ stage: 'done', pct: 100 });
        resolve({ id: 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), src: ev.target.result });
      };
      r.onerror = () => reject(new Error('Could not read file'));
      r.readAsDataURL(file);
    });
  }

  function readLocalPreview(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = ev => resolve(ev.target.result);
      r.onerror = () => resolve('');
      r.readAsDataURL(file);
    });
  }

  /**
   * optimizeImage — client-side resize + recompress before upload.
   *
   * Why: photographers commonly drop 12-25 MB JPGs straight from the camera.
   * Most layouts only need ~3000-4500 px on the long edge to print at 300 DPI
   * on a 17×24" album spread. Resizing client-side gives 6× faster uploads,
   * fewer mobile-Safari crashes, and ~70% storage savings — without visibly
   * compromising the print. Full-bleed 20×60 layouts may still want originals;
   * a future toggle can opt out.
   *
   * Strategy:
   *   - Skip non-decodable types (defensive; the upload route validates again).
   *   - Skip files already below 1.5 MB — re-encoding gives no win.
   *   - Decode via createImageBitmap (off-main-thread when supported).
   *   - Resize so long edge ≤ MAX_LONG_EDGE.
   *   - Re-encode as JPEG quality 0.9 (visually lossless for prints).
   *   - Fall back to <canvas> if OffscreenCanvas unavailable (iOS < 16.4).
   *   - If the optimized blob ends up larger than the original (rare for tiny
   *     PNGs with hard edges), upload the original instead.
   */
  async function optimizeImage(file) {
    const MAX_LONG_EDGE = 4500;
    const QUALITY = 0.9;
    const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    if (file.size < SKIP_BELOW_BYTES) return file;

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      console.warn('Folio optimize: cannot decode, sending original', file.name, e);
      return file;
    }

    const longEdge = Math.max(bitmap.width, bitmap.height);
    const ratio = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
    const w = Math.max(1, Math.round(bitmap.width * ratio));
    const h = Math.max(1, Math.round(bitmap.height * ratio));

    let canvas;
    let useOffscreen = typeof OffscreenCanvas !== 'undefined';
    try {
      canvas = useOffscreen ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    } catch (_) {
      canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      useOffscreen = false;
    }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (typeof bitmap.close === 'function') bitmap.close();

    let blob;
    try {
      if (useOffscreen && canvas.convertToBlob) {
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
      } else {
        blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
      }
    } catch (e) {
      console.warn('Folio optimize: encode failed, sending original', e);
      return file;
    }
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], baseName + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  }

  function uploadOne(file) {
    const tmpId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    addPlaceholderThumb(tmpId, file);
    // Optimize client-side first (resize + recompress to ~4500px JPEG Q90).
    // The progress label flicks to "Optimizing…" during decode/encode.
    updatePlaceholderProgress(tmpId, { stage: 'optimizing', pct: 0 });
    return optimizeImage(file)
      .then((opt) => storePhoto(opt, info => updatePlaceholderProgress(tmpId, info)))
      .then(({ id, src }) => {
        uploadedPhotos[id] = src;
        replacePlaceholderWithThumb(tmpId, id, src);
        updatePhotoCount();
        return { id, src };
      })
      .catch(err => {
        console.warn('Folio upload failed', file.name, err);
        markPlaceholderError(tmpId, file.name, err.message, file);
        throw err;
      });
  }

  function triggerSlotUpload(idx) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      uploadOne(file).then(({ src }) => {
        saveHistory();
        spreadData[currentSpread].slots[idx] = { src, px: 0, py: 0, scale: 1, rotate: 0, flipX: false, flipY: false, filter: '' };
        _lockBindingNow();
        renderCanvas();
      }).catch(() => {});
    };
    input.click();
  }

  function dragPhoto(e, id) { draggedPhotoId = id; e.dataTransfer.effectAllowed = 'copy'; }
  function dropPhoto(idx) {
    if (!draggedPhotoId) return;
    saveHistory();
    const raw = uploadedPhotos[draggedPhotoId];
    const src = typeof raw === 'object' ? raw.src : raw;
    spreadData[currentSpread].slots[idx] = { src, px: 0, py: 0, scale: 1, rotate: 0, flipX: false, flipY: false, filter: '' };
    _lockBindingNow();
    renderCanvas();
    draggedPhotoId = null;
  }

  function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    files.forEach(file => uploadOne(file).catch(() => {}));
    e.target.value = '';
  }

  function addPlaceholderThumb(tmpId, file) {
    const grid = document.getElementById('photoGrid');
    if (!grid) return null;
    const t = document.createElement('div');
    t.className = 'photo-thumb is-loading';
    t.dataset.tmpId = tmpId;
    t.innerHTML =
      '<img src="" alt="" class="thumb-img">' +
      '<div class="thumb-loading-overlay">' +
        '<div class="thumb-spinner"></div>' +
        '<div class="thumb-progress-track"><div class="thumb-progress-fill" style="width:0%"></div></div>' +
        '<div class="thumb-progress-label">Uploading…</div>' +
      '</div>';
    grid.appendChild(t);
    readLocalPreview(file).then(dataUrl => {
      const img = t.querySelector('.thumb-img');
      if (img && dataUrl) img.src = dataUrl;
    });
    pendingUploads.add(tmpId);
    updatePhotoCount();
    return t;
  }

  function updatePlaceholderProgress(tmpId, info) {
    const t = document.querySelector('.photo-thumb[data-tmp-id="' + tmpId + '"]');
    if (!t) return;
    const fill = t.querySelector('.thumb-progress-fill');
    const label = t.querySelector('.thumb-progress-label');
    if (fill) fill.style.width = Math.round(info.pct) + '%';
    if (label) {
      if (info.stage === 'optimizing') label.textContent = 'Optimizing…';
      else if (info.stage === 'uploading') label.textContent = 'Uploading… ' + Math.round(info.pct) + '%';
      else if (info.stage === 'processing') label.textContent = 'Processing…';
      else if (info.stage === 'done') label.textContent = 'Done';
    }
  }

  function replacePlaceholderWithThumb(tmpId, id, src) {
    pendingUploads.delete(tmpId);
    const t = document.querySelector('.photo-thumb[data-tmp-id="' + tmpId + '"]');
    if (!t) { addThumb(id, src); return; }
    t.classList.remove('is-loading');
    t.dataset.id = id;
    delete t.dataset.tmpId;
    t.draggable = true;
    t.ondragstart = e => dragPhoto(e, id);
    t.innerHTML = '<img src="' + src + '" alt=""><div class="thumb-overlay">Drag</div>';
  }

  function markPlaceholderError(tmpId, fileName, errMsg, file) {
    pendingUploads.delete(tmpId);
    const t = document.querySelector('.photo-thumb[data-tmp-id="' + tmpId + '"]');
    if (!t) return;
    t.classList.remove('is-loading');
    t.classList.add('is-error');
    t.draggable = false;
    const safeMsg = String(errMsg || 'Upload failed').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const safeName = String(fileName || '').replace(/</g, '&lt;');
    t.innerHTML =
      '<div class="thumb-error-overlay" title="' + safeMsg + '">' +
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
          '<circle cx="10" cy="10" r="8" stroke="#ff6b6b" stroke-width="1"/>' +
          '<path d="M10 6v5M10 13.5h.01" stroke="#ff6b6b" stroke-width="1.5" stroke-linecap="round"/>' +
        '</svg>' +
        '<div class="thumb-error-msg">Failed</div>' +
        '<div class="thumb-error-filename">' + safeName + '</div>' +
        '<div class="thumb-error-actions">' +
          '<button type="button" class="thumb-retry">Retry</button>' +
          '<button type="button" class="thumb-dismiss" title="Dismiss">×</button>' +
        '</div>' +
      '</div>';
    t.querySelector('.thumb-retry').addEventListener('click', () => { t.remove(); uploadOne(file).catch(() => {}); });
    t.querySelector('.thumb-dismiss').addEventListener('click', () => { t.remove(); updatePhotoCount(); });
    updatePhotoCount();
  }

  function addThumb(id, src) {
    const grid = document.getElementById('photoGrid');
    if (!grid) return;
    const t = document.createElement('div');
    t.className = 'photo-thumb';
    t.draggable = true;
    t.dataset.id = id;
    t.ondragstart = e => dragPhoto(e, id);
    t.innerHTML = '<img src="' + src + '" alt=""><div class="thumb-overlay">Drag</div>';
    grid.appendChild(t);
  }

  function updatePhotoCount() {
    const n = Object.keys(uploadedPhotos).length;
    const inFlight = pendingUploads.size;
    const el = document.getElementById('photoCount');
    if (!el) return;
    if (n === 0 && inFlight === 0) el.textContent = 'Upload photos to begin';
    else if (inFlight > 0 && n === 0) el.textContent = 'Uploading ' + inFlight + ' photo' + (inFlight !== 1 ? 's' : '') + '…';
    else if (inFlight > 0) el.textContent = n + ' ready · uploading ' + inFlight + '…';
    else el.textContent = n + ' photo' + (n !== 1 ? 's' : '') + ' · Drag onto spreads';
  }

  function renderPageStrip() {
    const strip = document.getElementById('pageThumbs');
    if (!strip) return;
    strip.innerHTML = '';
    for (let i = 0; i < totalSpreads; i++) {
      const m = document.createElement('div');
      m.className = 'page-mini' + (i === currentSpread ? ' active' : '');
      m.onclick = () => { currentSpread = i; selectedLayout = spreadData[i].layoutId; renderCanvas(); renderLayoutPanel(); };
      m.innerHTML = (i + 1) + '<span class="page-mini-num">Spread ' + (i + 1) + '</span>';
      strip.appendChild(m);
    }
    const add = document.createElement('button');
    add.className = 'add-page-btn';
    add.innerHTML = '+';
    add.title = 'Add spread';
    add.onclick = () => {
      const l = findLayout(selectedLayout);
      spreadData.push({
        layoutId: l.id,
        slots: new Array(l.slots).fill(null),
        bg: { type: 'solid', color: '#f8f4ee' }
      });
      totalSpreads++;
      renderPageStrip();
      currentSpread = totalSpreads - 1;
      renderCanvas();
      // Adding a spread past the included count bumps the price by
      // perExtra, so we refresh the toolbar tag immediately.
      renderPriceTag();
    };
    strip.appendChild(add);
  }

  function updatePageStrip() {
    document.querySelectorAll('.page-mini').forEach((el, i) => el.classList.toggle('active', i === currentSpread));
  }
  function prevSpread() {
    if (currentSpread > 0) {
      currentSpread--;
      selectedLayout = spreadData[currentSpread].layoutId;
      renderCanvas();
      renderLayoutPanel();
    }
  }
  function nextSpread() {
    if (currentSpread < totalSpreads - 1) {
      currentSpread++;
      selectedLayout = spreadData[currentSpread].layoutId;
      renderCanvas();
      renderLayoutPanel();
    }
  }
  function zoom(d) {
    zoomLevel = Math.min(1.4, Math.max(0.4, zoomLevel + d));
    const z = document.getElementById('zoomVal');
    const c = document.getElementById('spreadCanvas');
    if (z) z.textContent = Math.round(zoomLevel * 100) + '%';
    if (c) c.style.transform = 'scale(' + zoomLevel + ')';
  }

  function openModal() {
    const m = document.getElementById('modalOverlay');
    if (m) m.classList.add('open');
    // Cover state may have changed since the toolbar tag was last
    // updated (acrylic adds $40 / $65). Recompute on open so the
    // breakdown matches what the customer is about to commit to.
    renderPriceBreakdown();
    renderPriceTag();
  }
  function closeModal() {
    const m = document.getElementById('modalOverlay');
    if (m) m.classList.remove('open');
  }
  // Generate a short, human-readable order id. Local-only — server-side
  // ids will replace this once /api/submit-order lands.
  function _newOrderId() {
    return 'FF-' + Date.now().toString(36).toUpperCase() +
      '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  // Lock the designer for further edits. localStorage is the authoritative
  // lock — on next /design load the React shell reads this flag and shows
  // the SubmittedView instead of the designer UI.
  function _lockAfterSubmit(orderId) {
    try {
      localStorage.setItem('folio-submitted', JSON.stringify({
        orderId: orderId,
        submittedAt: new Date().toISOString()
      }));
    } catch (e) { /* private mode / disabled — fail silently */ }
    try {
      window.dispatchEvent(new CustomEvent('folio:submitted', {
        detail: { orderId: orderId }
      }));
    } catch (e) { /* old browser — lock still applies on next reload */ }
    var idEl = document.getElementById('successOrderId');
    if (idEl) idEl.textContent = orderId;
  }

  function submitOrder() {
    closeModal();
    var orderId = _newOrderId();
    _lockAfterSubmit(orderId);
    const s = document.getElementById('successOverlay');
    if (s) s.classList.add('open');
  }
  function submitExpert() {
    const e = document.getElementById('expertSection');
    const s = document.getElementById('successOverlay');
    if (e) e.style.display = 'none';
    var orderId = _newOrderId();
    _lockAfterSubmit(orderId);
    if (s) s.classList.add('open');
  }
  function expertUploadHandle(e) {
    const lbl = document.getElementById('expertUploadLabel');
    if (lbl) lbl.textContent = e.target.files.length + ' photo' + (e.target.files.length !== 1 ? 's' : '') + ' selected ✓';
  }

  function serializeDesign() {
    return {
      version: 2,
      binding: currentBinding,
      size: currentSize,
      totalSpreads,
      spreadData,
      uploadedPhotos,
      savedAt: new Date().toISOString()
    };
  }

  async function saveDesign(opts) {
    opts = opts || {};
    const btn = opts.buttonEl;
    if (btn) { btn.disabled = true; btn.dataset.origLabel = btn.textContent; btn.textContent = 'Saving…'; }
    try {
      const res = await fetch('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: serializeDesign(), title: opts.title || '' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data && data.message ? data.message : 'Save failed (HTTP ' + res.status + ')';
        alert(msg);
        return null;
      }
      window.prompt('Design saved. Copy this preview URL to share with your client:', data.preview_url);
      return data;
    } catch (err) {
      alert('Network error saving design: ' + err.message);
      return null;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origLabel || 'Save & Share'; }
    }
  }

  // Defensive: function declarations in a non-module script are already on
  // window in browser contexts, but explicit assignment guarantees the
  // contract for the React JSX onClick handlers that call these.
  window.choosePath = choosePath;
  window.pickSize = pickSize;
  window.selectBinding = selectBinding;
  window.promptBindingChange = promptBindingChange;
  window.setSize = setSize;
  window.prevSpread = prevSpread;
  window.nextSpread = nextSpread;
  window.zoom = zoom;
  window.doUndo = doUndo;
  window.doRedo = doRedo;
  window.addTextOverlay = addTextOverlay;
  window.toggleBgPicker = toggleBgPicker;
  window.toggleFilterStrip = toggleFilterStrip;
  window.applyFilter = applyFilter;
  window.setBgColor = setBgColor;
  window.setBgMode = setBgMode;
  window.setBgPhoto = setBgPhoto;
  window.setBgFade = setBgFade;
  window.handleUpload = handleUpload;
  window.expertUploadHandle = expertUploadHandle;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.submitOrder = submitOrder;
  window.submitExpert = submitExpert;
  window.saveDesign = saveDesign;
  window.ftbFitFill = ftbFitFill;
  window.ftbFitOriginal = ftbFitOriginal;
  window.ftbZoomStep = ftbZoomStep;
  window.ftbZoomSlider = ftbZoomSlider;
  window.ftbFlip = ftbFlip;
  window.ftbRotate = ftbRotate;
  window.ftbReset = ftbReset;
  window.ftbDelete = ftbDelete;
  window.computePrice = computePrice;
  window.renderPriceTag = renderPriceTag;
  window.renderPriceBreakdown = renderPriceBreakdown;
