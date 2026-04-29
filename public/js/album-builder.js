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
  let uploadedPhotos = {}, spreadData = [], selectedLayout = 1, draggedPhotoId = null;
  // Tracks placeholder thumbs whose upload is still in flight.
  const pendingUploads = new Set();

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

  const layouts = [
    { id: 0, name: 'Full Spread',    cols: '1fr',         rows: '1fr',     slots: 1 },
    { id: 1, name: 'Side by Side',   cols: '1fr 1fr',     rows: '1fr',     slots: 2 },
    { id: 2, name: 'Feature Left',   cols: '2fr 1fr',     rows: '1fr',     slots: 2 },
    { id: 3, name: 'Feature Right',  cols: '1fr 2fr',     rows: '1fr',     slots: 2 },
    { id: 4, name: 'Triptych',       cols: '1fr 1fr 1fr', rows: '1fr',     slots: 3 },
    { id: 5, name: 'Top Feature',    cols: '1fr 1fr',     rows: '2fr 1fr', slots: 3 },
    { id: 6, name: 'Bottom Feature', cols: '1fr 1fr',     rows: '1fr 2fr', slots: 3 },
    { id: 7, name: 'Four Square',    cols: '1fr 1fr',     rows: '1fr 1fr', slots: 4 },
    { id: 8, name: 'Five Panel',     cols: '1fr 1fr 1fr', rows: '1fr 1fr', slots: 5 },
    { id: 9, name: 'Magazine',       cols: '3fr 2fr',     rows: '1fr 1fr', slots: 3 }
  ];

  for (let i = 0; i < totalSpreads; i++) spreadData.push({ layoutId: 1, slots: [null, null] });

  /**
   * localStorage persistence — keeps the design alive across refreshes.
   *
   * Why: photos are already safely uploaded to R2; what disappears on refresh
   * is the *map* of which photos belong to this design and which slot they
   * sit in. We persist the small metadata (URLs + slot transforms), not the
   * actual image bytes. ~10 kB per design, well under the 5 MB cap.
   *
   * Schema versioning (v: 1) lets us bump and ignore stale state if we ever
   * change the shape. Failures (storage disabled, quota full, JSON parse) are
   * logged and swallowed — the builder keeps working from defaults.
   *
   * The "right" answer is server-side persistence in D1 with a cookie-based
   * design id, which we'll add when login lands. Until then, localStorage
   * covers ~99% of the "I came back to my design" use case (same browser,
   * same device).
   */
  const LS_KEY = 'folio-design-v1';

  function saveLocalState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        v: 1,
        uploadedPhotos,
        spreadData,
        currentSpread,
        totalSpreads,
        currentSize,
        selectedLayout,
        savedAt: new Date().toISOString(),
      }));
    } catch (e) {
      // Quota or disabled-storage. Don't crash the app over a save failure.
      console.warn('Folio: cannot persist design state', e);
    }
  }

  function loadLocalState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return false;
      if (data.uploadedPhotos && typeof data.uploadedPhotos === 'object') {
        uploadedPhotos = data.uploadedPhotos;
      }
      if (Array.isArray(data.spreadData) && data.spreadData.length > 0) {
        spreadData = data.spreadData;
        totalSpreads = data.spreadData.length;
      }
      if (typeof data.currentSpread === 'number') {
        currentSpread = Math.max(0, Math.min(totalSpreads - 1, data.currentSpread));
      }
      if (typeof data.currentSize === 'string' && sizes[data.currentSize]) {
        currentSize = data.currentSize;
      }
      if (typeof data.selectedLayout === 'number') {
        selectedLayout = Math.max(0, Math.min(layouts.length - 1, data.selectedLayout));
      }
      return true;
    } catch (e) {
      console.warn('Folio: cannot restore design state', e);
      return false;
    }
  }

  function rebuildPhotoGrid() {
    const grid = document.getElementById('photoGrid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.entries(uploadedPhotos).forEach(([id, raw]) => {
      const src = typeof raw === 'string' ? raw : raw && raw.src;
      if (src) addThumb(id, src);
    });
    updatePhotoCount();
  }

  // Restore on script init. Render is deferred — the spread builder isn't
  // mounted until the user picks "I'll design it", at which point choosePath
  // calls renderCanvas + rebuildPhotoGrid against the already-restored state.
  loadLocalState();

  function choosePath(type) {
    const intro = document.getElementById('introSection');
    if (intro) intro.style.display = 'none';
    if (type === 'self') {
      const builder = document.getElementById('builderSection');
      if (builder) builder.classList.add('active');
      const submitBtn = document.getElementById('navSubmitBtn');
      if (submitBtn) submitBtn.style.display = 'block';
      const saveBtn = document.getElementById('navSaveBtn');
      if (saveBtn) saveBtn.style.display = 'block';
      applySizeToCanvas(currentSize);
      renderLayoutPanel();
      renderPageStrip();
      renderCanvas();
      updateSpreadInfoLabel();
      // Repopulate the photo sidebar from any restored uploads.
      rebuildPhotoGrid();
    } else {
      const expert = document.getElementById('expertSection');
      if (expert) expert.classList.add('active');
    }
  }

  function setSize(sizeKey) {
    if (!sizes[sizeKey] || sizeKey === currentSize) return;
    currentSize = sizeKey;
    applySizeToCanvas(sizeKey);
    document.querySelectorAll('.size-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.size === sizeKey);
    });
    updateSpreadInfoLabel();
    saveLocalState();
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
  }

  function updateSpreadInfoLabel() {
    const info = document.getElementById('spreadInfo');
    if (!info) return;
    const unit = sizes[currentSize].unitLabel;
    info.textContent = unit + ' ' + (currentSpread + 1) + ' of ' + totalSpreads;
  }

  function renderLayoutPanel() {
    const c = document.getElementById('layoutScroll');
    if (!c) return;
    c.innerHTML = '';
    const groups = [
      { label: 'Single Photo', from: 0, to: 0 },
      { label: 'Two Photos',   from: 1, to: 3 },
      { label: 'Three Photos', from: 4, to: 6 },
      { label: 'More Photos',  from: 7, to: 9 }
    ];
    groups.forEach(g => {
      const title = document.createElement('span');
      title.className = 'layout-section-title';
      title.textContent = g.label;
      c.appendChild(title);
      for (let i = g.from; i <= g.to; i++) {
        const l = layouts[i];
        const div = document.createElement('div');
        div.className = 'layout-thumb' + (i === selectedLayout ? ' active' : '');
        div.onclick = () => applyLayout(i);
        const preview = document.createElement('div');
        preview.className = 'layout-preview';
        preview.style.gridTemplateColumns = l.cols;
        preview.style.gridTemplateRows = l.rows;
        const colCount = l.cols.split(' ').length;
        const rowCount = l.rows.split(' ').length;
        for (let x = 0; x < colCount * rowCount; x++) {
          const cell = document.createElement('div');
          cell.className = 'lp-cell';
          preview.appendChild(cell);
        }
        div.appendChild(preview);
        const name = document.createElement('span');
        name.className = 'layout-name';
        name.textContent = l.name;
        div.appendChild(name);
        c.appendChild(div);
      }
    });
  }

  function applyLayout(layoutId) {
    selectedLayout = layoutId;
    const l = layouts[layoutId];
    const spread = spreadData[currentSpread];
    const old = [...spread.slots];
    spread.layoutId = layoutId;
    spread.slots = new Array(l.slots).fill(null);
    for (let i = 0; i < Math.min(old.length, l.slots); i++) spread.slots[i] = old[i];
    renderCanvas();
    document.querySelectorAll('.layout-thumb').forEach((el, i) => el.classList.toggle('active', i === layoutId));
  }

  function renderCanvas() {
    const spread = spreadData[currentSpread];
    const l = layouts[spread.layoutId];
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
      canvas.style.background = spreadData[currentSpread].bgColor || '#f8f4ee';
      canvas.style.transform = 'scale(' + zoomLevel + ')';
    }
    updateSpreadInfoLabel();
    updatePageStrip();
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

  // ── BACKGROUND COLOR ──
  function toggleBgPicker() {
    const bg = document.getElementById('bgPicker');
    const fs = document.getElementById('filterStrip');
    if (bg) bg.classList.toggle('open');
    if (fs) fs.classList.remove('open');
  }
  function setBgColor(color, swatch) {
    saveHistory();
    spreadData[currentSpread].bgColor = color;
    document.querySelectorAll('.bg-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    const c = document.getElementById('spreadCanvas');
    if (c) c.style.background = color;
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
  // saveHistory/doUndo/doRedo all funnel through saveLocalState so the
  // localStorage snapshot stays in sync with whatever state the user
  // can see on the canvas.
  let history = [], future = [];
  function saveHistory() {
    history.push(JSON.stringify(spreadData.map(s => ({ ...s, slots: [...s.slots] }))));
    if (history.length > 30) history.shift();
    future = [];
    saveLocalState();
  }
  function doUndo() {
    if (!history.length) return;
    future.push(JSON.stringify(spreadData.map(s => ({ ...s, slots: [...s.slots] }))));
    spreadData = JSON.parse(history.pop());
    renderCanvas();
    saveLocalState();
  }
  function doRedo() {
    if (!future.length) return;
    history.push(JSON.stringify(spreadData.map(s => ({ ...s, slots: [...s.slots] }))));
    spreadData = JSON.parse(future.pop());
    renderCanvas();
    saveLocalState();
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
        // Persist the upload immediately. saveLocalState inside
        // replacePlaceholderWithThumb only runs on the happy DOM path
        // (placeholder thumb still present); pulling it up here means
        // we record the new photo even if the DOM was disrupted.
        saveLocalState();
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
    // Persist the new photo so it's still in the grid after refresh.
    saveLocalState();
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
      m.onclick = () => { currentSpread = i; selectedLayout = spreadData[i].layoutId; renderCanvas(); renderLayoutPanel(); saveLocalState(); };
      m.innerHTML = (i + 1) + '<span class="page-mini-num">Spread ' + (i + 1) + '</span>';
      strip.appendChild(m);
    }
    const add = document.createElement('button');
    add.className = 'add-page-btn';
    add.innerHTML = '+';
    add.title = 'Add spread';
    add.onclick = () => {
      const l = layouts[selectedLayout];
      spreadData.push({ layoutId: selectedLayout, slots: new Array(l.slots).fill(null) });
      totalSpreads++;
      renderPageStrip();
      currentSpread = totalSpreads - 1;
      renderCanvas();
      saveLocalState();
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
      saveLocalState();
    }
  }
  function nextSpread() {
    if (currentSpread < totalSpreads - 1) {
      currentSpread++;
      selectedLayout = spreadData[currentSpread].layoutId;
      renderCanvas();
      renderLayoutPanel();
      saveLocalState();
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
  }
  function closeModal() {
    const m = document.getElementById('modalOverlay');
    if (m) m.classList.remove('open');
  }
  function submitOrder() {
    closeModal();
    const s = document.getElementById('successOverlay');
    if (s) s.classList.add('open');
  }
  function submitExpert() {
    const e = document.getElementById('expertSection');
    const s = document.getElementById('successOverlay');
    if (e) e.style.display = 'none';
    if (s) s.classList.add('open');
  }
  function expertUploadHandle(e) {
    const lbl = document.getElementById('expertUploadLabel');
    if (lbl) lbl.textContent = e.target.files.length + ' photo' + (e.target.files.length !== 1 ? 's' : '') + ' selected ✓';
  }

  function serializeDesign() {
    return {
      version: 1,
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
