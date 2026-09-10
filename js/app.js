/*
 * app.js — state, interaction and the plain-language layer.
 *
 * The astronomy underneath is exact (see astro.js), but nothing on screen is
 * expressed in degrees or hour angles. Positions become "high in the south-east",
 * sky quality becomes "a village garden", and the sky itself does the explaining.
 *
 * A view can be injected through the URL, which is also how to test it:
 *   ?t=2026-09-10T22:30   wall clock in the active zone (append Z for UTC)
 *   ?lat=45.695&lon=9.670 observer position
 *   ?tz=Europe/Rome       IANA time zone
 *   ?facing=180           compass direction to look towards
 */
(() => {
  'use strict';

  const BERGAMO = { lat: 45.695, lon: 9.670, tz: 'Europe/Rome', name: 'Bergamo, Italy' };
  const $ = (id) => document.getElementById(id);

  // Zodiac in the order the Sun travels through them, which is how the signs are
  // always taught — not by brightness or by what happens to be up.
  const ZODIAC_ORDER = ['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir',
                        'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc'];
  const CIRCUMPOLAR_ORDER = ['UMa', 'UMi', 'Cas', 'Cep', 'Dra'];

  // How dark your sky is, in words. The number is the faintest star the eye catches.
  const SKY_CONDITIONS = [
    { id: 'city',      label: 'City centre',      limit: 2.6, note: 'only the brightest stars push through' },
    { id: 'town',      label: 'Town edge',        limit: 3.4, note: 'the main shapes come out' },
    { id: 'village',   label: 'Village garden',   limit: 4.2, note: 'most naked-eye stars visible' },
    { id: 'dark',      label: 'Dark countryside', limit: 5.2, note: 'the full naked-eye sky' },
  ];

  const state = {
    lat: BERGAMO.lat, lon: BERGAMO.lon, tz: BERGAMO.tz, placeName: BERGAMO.name,
    date: new Date(),
    live: true,
    playing: false,
    playSpeed: 3600,
    facing: 180, pitch: 28, fov: 110,
    targetFacing: 180, targetPitch: 28,
    conditions: 'village',
    magLimit: 4.2,
    showLines: true,
    showLabels: true,
    showStarNames: true,
    showMilkyWay: true,
    showBackdrop: true,
    showZodiac: true,
    showCircumpolar: true,
    twinkle: true,
    selected: null,
    hovered: null,
  };

  let data = null, frame = null, computed = null;
  let dragging = null;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) state.twinkle = false;

  /* --------------------------------------------------------- data loading --- */

  async function loadData() {
    let starsDoc = window.STAR_DATA, consDoc = window.CONSTELLATION_DATA;
    if (!starsDoc || !consDoc) {
      const [a, b] = await Promise.all([
        fetch('data/stars.json').then((r) => r.json()),
        fetch('data/constellations.json').then((r) => r.json()),
      ]);
      starsDoc = a; consDoc = b;
    }
    const conByAbbrev = {};
    for (const c of consDoc.constellations) conByAbbrev[c.abbrev] = c;
    return { stars: starsDoc.stars, constellations: consDoc.constellations, conByAbbrev };
  }

  /* ------------------------------------------------------ sky computation --- */

  function computeSky(date) {
    const jd = Astro.julianDay(date);
    const lstDeg = Astro.lst(jd, state.lon);
    const starAltAz = data.stars.map((s) => Astro.starAltAz(s.ra, s.dec, jd, lstDeg, state.lat));

    const conVisible = {};
    for (const con of data.constellations) {
      const idx = new Set();
      for (const [i, j] of con.lines) { idx.add(i); idx.add(j); }
      let visible = 0, sumAlt = 0, ax = 0, ay = 0, brightest = null;
      for (const i of idx) {
        const h = starAltAz[i];
        if (h.alt < 0) continue;
        visible++;
        sumAlt += h.alt;
        ax += Math.cos(h.az * Astro.DEG);
        ay += Math.sin(h.az * Astro.DEG);
        const s = data.stars[i];
        if (!brightest || s.m < brightest.m) brightest = s;
      }
      conVisible[con.abbrev] = {
        total: idx.size,
        visibleStars: visible,
        fraction: idx.size ? visible / idx.size : 0,
        centroidAlt: visible ? sumAlt / visible : -90,
        centroidAz: visible ? Astro.norm360(Math.atan2(ay, ax) * Astro.RAD) : 0,
        brightestVisible: brightest,
      };
    }

    const sunMoon = Astro.sunMoon(date, jd, lstDeg, state.lat, state.lon);
    const tw = Astro.twilight(sunMoon.sun.alt);
    return {
      jd, lstDeg, starAltAz, conVisible, sunMoon,
      twilight: tw, twilightKey: tw.key,
      astroCtx: { jd, lstDeg, lat: state.lat, lon: state.lon },
    };
  }

  /* -------------------------------------------------- words, not numbers --- */

  const DIR_WORDS = {
    N: 'north', NNE: 'north-north-east', NE: 'north-east', ENE: 'east-north-east',
    E: 'east', ESE: 'east-south-east', SE: 'south-east', SSE: 'south-south-east',
    S: 'south', SSW: 'south-south-west', SW: 'south-west', WSW: 'west-south-west',
    W: 'west', WNW: 'west-north-west', NW: 'north-west', NNW: 'north-north-west',
  };
  const dirWord = (az) => DIR_WORDS[Astro.compassPoint(az)];

  /** Where a constellation sits, said the way you'd say it to someone outside. */
  function placeInSky(v) {
    if (v.visibleStars === 0) return { short: 'not up now', long: 'below the horizon right now' };
    const alt = v.centroidAlt, dir = dirWord(v.centroidAz);
    if (alt >= 72) return { short: 'overhead', long: 'almost straight overhead' };
    if (alt >= 52) return { short: `high, ${dir}`, long: `high up towards the ${dir}` };
    if (alt >= 32) return { short: `mid, ${dir}`, long: `about halfway up the ${dir} sky` };
    if (alt >= 14) return { short: `low, ${dir}`, long: `low in the ${dir}` };
    return { short: `rim, ${dir}`, long: `just clearing the horizon in the ${dir}` };
  }

  /** The time of night in ordinary words, from where the Sun actually is. */
  function nightPhrase() {
    const sun = computed.sunMoon.sun;
    const rising = sun.az < 180;      // sun in the eastern half means the day is coming
    if (sun.alt > 6) return 'broad daylight — the stars are there, but washed out';
    if (sun.alt > -0.833) return rising ? 'sunrise' : 'sunset';
    if (sun.alt > -6) return rising ? 'first light' : 'dusk, brightest stars appearing';
    if (sun.alt > -12) return rising ? 'dawn is breaking' : 'the sky is going dark';
    if (sun.alt > -18) return rising ? 'last of the darkness' : 'nearly full darkness';
    return 'full darkness — the best of the night';
  }

  function moonPhrase() {
    const m = computed.sunMoon.moon;
    const pct = Math.round(m.illum * 100);
    const lit = pct < 3 ? 'barely lit' : pct > 97 ? 'full' : `${pct}% lit`;
    if (m.alt < 0) return `${m.phaseName.toLowerCase()} (${lit}), below the horizon — dark skies`;
    const bright = m.illum > 0.55 ? ' — its glare will hide fainter stars' : '';
    return `${m.phaseName.toLowerCase()} (${lit}), ${placeInSky({ visibleStars: 1, centroidAlt: m.alt, centroidAz: m.az }).long}${bright}`;
  }

  /* ------------------------------------------------------------ rendering --- */

  let animClock = 0;
  function draw(dtSeconds = 0) {
    animClock += dtSeconds;
    // The time strip overlays the canvas; tell the projection how much room it takes
    // so the horizon is never hidden behind the controls.
    const strip = document.querySelector('.tline');
    state.bottomInset = strip ? strip.offsetHeight : 0;
    computed = computeSky(state.date);
    frame = Sky.render($('sky'), state, data, computed,
      { t: animClock, twinkle: state.twinkle });
    renderOverlay();
    renderLists();
  }

  function fmtClock(date) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: state.tz, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(date).replace(/\s?([ap])m/i, (_, p) => ` ${p.toLowerCase()}m`);
  }
  const fmtDay = (date) => new Intl.DateTimeFormat('en-GB', {
    timeZone: state.tz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(date);

  function renderOverlay() {
    $('placeName').textContent = state.placeName;
    $('clockText').textContent = fmtClock(state.date);
    $('dayText').textContent = fmtDay(state.date);
    $('nightPhrase').textContent = nightPhrase();
    $('moonPhrase').textContent = moonPhrase();
    $('facingText').textContent = `looking ${dirWord(state.facing)}`;
    $('liveDot').classList.toggle('on', state.live);
    for (const b of document.querySelectorAll('.cbtn')) {
      const az = Number(b.dataset.az);
      let d = Math.abs(Astro.norm360(state.facing - az));
      if (d > 180) d = 360 - d;
      b.classList.toggle('active', d < 22.5);
    }
  }

  function conRow(abbrev) {
    const con = data.conByAbbrev[abbrev];
    const v = computed.conVisible[abbrev];
    const where = placeInSky(v);
    const up = v.visibleStars > 0;
    return `<li class="crow ${up ? '' : 'down'} ${state.selected === abbrev ? 'sel' : ''}"
                data-abbrev="${abbrev}" tabindex="0" role="button"
                aria-label="${con.name}, ${where.long}">
      <span class="cdot ${con.group}"></span>
      <span class="cname">${con.name}</span>
      <span class="cwhere">${where.short}</span>
    </li>`;
  }

  /**
   * The sidebar only changes when a constellation's description or selection
   * changes, but draw() runs many times a second so the stars can twinkle.
   * Rewriting innerHTML on every frame would thrash the DOM and throw away
   * hover and keyboard focus mid-interaction, so compare a signature first.
   */
  let listSignature = '';
  function renderLists() {
    const sig = [...ZODIAC_ORDER, ...CIRCUMPOLAR_ORDER].map((a) => {
      const v = computed.conVisible[a];
      return `${a}${placeInSky(v).short}${state.selected === a ? '*' : ''}`;
    }).join('|') + `#${state.showZodiac}${state.showCircumpolar}`;
    if (sig === listSignature) return;
    listSignature = sig;
    $('zodiacList').innerHTML = ZODIAC_ORDER.map(conRow).join('');
    $('polarList').innerHTML = CIRCUMPOLAR_ORDER.map(conRow).join('');
  }

  /* ---------------------------------------------------------- story panel --- */

  function openStory(abbrev) {
    const con = data.conByAbbrev[abbrev];
    if (!con) { $('story').hidden = true; return; }
    const v = computed.conVisible[abbrev];
    const where = placeInSky(v);
    const up = v.visibleStars > 0;

    $('story').innerHTML = `
      <button id="closeStory" class="close" aria-label="Close">×</button>
      <p class="skind"><span class="cdot ${con.group}"></span>${
        con.group === 'circumpolar' ? 'Never sets from here' : 'Zodiac — the Sun passes through it'
      }</p>
      <h2>${con.name}</h2>
      <p class="swhere ${up ? '' : 'is-down'}">${
        up ? `Right now: <strong>${where.long}</strong>${v.fraction < 0.9 ? ', partly below the horizon' : ''}`
           : `Right now: <strong>below the horizon</strong> — try another time of night, or a different month`
      }</p>
      ${con.brightest ? `<p class="sbright">Brightest star: <strong>${con.brightest.replace(/\s*\([^)]*\)/, '')}</strong></p>` : ''}
      ${up ? `<button id="turnTo" class="turn">Turn and look at it</button>` : ''}
      <section><h3>Mythology</h3><p>${con.myth_fact}</p></section>
      <section><h3>How it was used</h3><p>${con.ancient_use}</p></section>
      <section><h3>The story</h3><p>${con.story}</p></section>`;

    $('story').hidden = false;
    $('story').scrollTop = 0;
    $('closeStory').addEventListener('click', () => select(null));
    const turn = $('turnTo');
    if (turn) turn.addEventListener('click', () => lookAt(v.centroidAz, v.centroidAlt));
  }

  function select(abbrev, alsoTurn = false) {
    // Guard against a star from one of the other 71 constellations, which has a
    // name to show on hover but no story behind it.
    if (abbrev && !data.conByAbbrev[abbrev]) abbrev = null;
    state.selected = abbrev;
    if (!abbrev) {
      $('story').hidden = true;
    } else {
      const v = computed.conVisible[abbrev];
      if (alsoTurn && v.visibleStars > 0) lookAt(v.centroidAz, v.centroidAlt);
      openStory(abbrev);
    }
    draw();
  }

  /* ---------------------------------------------- looking around the sky --- */

  /** Point the view at an alt/az, taking the short way round the compass. */
  function lookAt(az, alt) {
    let delta = Astro.norm360(az - state.facing);
    if (delta > 180) delta -= 360;
    state.targetFacing = state.facing + delta;
    state.targetPitch = Math.max(5, Math.min(78, alt));
    if (prefersReducedMotion) {
      state.facing = Astro.norm360(state.targetFacing);
      state.targetFacing = state.facing;
      state.pitch = state.targetPitch;
      draw();
    }
  }

  function turnBy(deg) {
    state.targetFacing += deg;
  }

  /** Ease the view towards its target; returns true while still moving. */
  function stepView(dt) {
    const k = 1 - Math.exp(-dt * 7);
    let moved = false;
    const dF = state.targetFacing - state.facing;
    if (Math.abs(dF) > 0.02) { state.facing += dF * k; moved = true; }
    else state.facing = state.targetFacing;
    const dP = state.targetPitch - state.pitch;
    if (Math.abs(dP) > 0.02) { state.pitch += dP * k; moved = true; }
    else state.pitch = state.targetPitch;
    if (!moved && Math.abs(state.facing) > 720) {
      state.facing = Astro.norm360(state.facing);
      state.targetFacing = state.facing;
    }
    return moved;
  }

  /* -------------------------------------------------------- time controls --- */

  let syncing = false;
  function syncTimeInputs() {
    syncing = true;
    const p = Astro.zonedParts(state.date, state.tz);
    $('hourSlider').value = String(p.hour * 60 + p.minute);
    $('hourReadout').textContent = fmtClock(state.date);
    $('daySlider').value = String(dayOfYear(p.year, p.month, p.day));
    $('dayReadout').textContent = new Intl.DateTimeFormat('en-GB',
      { timeZone: state.tz, day: 'numeric', month: 'long' }).format(state.date);
    syncing = false;
  }

  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const MONTHS = (y) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function dayOfYear(y, m, d) {
    const L = MONTHS(y); let n = d;
    for (let i = 0; i < m - 1; i++) n += L[i];
    return n;
  }
  function fromDayOfYear(y, doy) {
    const L = MONTHS(y); let m = 1, d = Math.max(1, Math.min(doy, isLeap(y) ? 366 : 365));
    while (d > L[m - 1]) { d -= L[m - 1]; m++; }
    return { month: m, day: d };
  }

  function setZoned(fields) {
    const p = Astro.zonedParts(state.date, state.tz);
    state.date = Astro.instantFromZoned({ ...p, ...fields }, state.tz);
    state.live = false;
    syncTimeInputs();
    draw();
  }

  function goLive() {
    state.live = true;
    state.playing = false;
    $('playBtn').classList.remove('on');
    $('playBtn').textContent = 'Play';
    state.date = new Date();
    syncTimeInputs();
    draw();
  }

  /* ------------------------------------------------------------ main loop --- */

  let last = performance.now();
  let idleAccum = 0;

  // The browser suspends requestAnimationFrame while the page is hidden, so on
  // coming back the first timestamp is stale. Reset the clock instead of feeding
  // a huge delta into the easing.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { last = performance.now(); idleAccum = 0; }
  });

  function loop(now) {
    // Whatever happens in a frame, schedule the next one first: an exception
    // escaping here would otherwise stop the clock and the view for good.
    requestAnimationFrame(loop);
    try { frameBody(now); }
    catch (err) { console.error('sky frame failed', err); }
  }

  function frameBody(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    let needsDraw = false;
    if (state.live) { state.date = new Date(); syncTimeInputs(); needsDraw = true; }
    else if (state.playing) {
      state.date = new Date(state.date.getTime() + dt * state.playSpeed * 1000);
      syncTimeInputs();
      needsDraw = true;
    }
    if (stepView(dt)) needsDraw = true;

    // Twinkling keeps the sky alive while nothing else is moving, but there is no
    // reason to burn a full 60fps on it.
    if (!needsDraw && state.twinkle) {
      idleAccum += dt;
      if (idleAccum > 1 / 24) needsDraw = true;
    }
    if (needsDraw) { draw(dt); idleAccum = 0; }
  }

  /* --------------------------------------------------------------- wiring --- */

  function wire() {
    const canvas = $('sky');

    /* --- dragging to look around --- */
    const pointerPos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const p = pointerPos(e);
      dragging = { ...p, startX: p.x, startY: p.y, moved: false,
                   facing: state.targetFacing, pitch: state.targetPitch };
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = pointerPos(e);
      if (dragging) {
        const dx = p.x - dragging.startX, dy = p.y - dragging.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging.moved = true;
        // One canvas width of drag turns you through one field of view.
        const perPx = state.fov / canvas.clientWidth;
        state.targetFacing = dragging.facing - dx * perPx;
        state.targetPitch = Math.max(5, Math.min(78, dragging.pitch + dy * perPx));
        state.facing = state.targetFacing;
        state.pitch = state.targetPitch;
        canvas.style.cursor = 'grabbing';
        draw();
        return;
      }
      const h = Sky.pick(frame, p.x, p.y);
      const nextHover = h ? h.abbrev : null;
      if (nextHover !== state.hovered) { state.hovered = nextHover; draw(); }
      canvas.style.cursor = h ? 'pointer' : 'grab';

      const tip = $('tooltip');
      if (h && h.via === 'star' && h.star) {
        const con = data.conByAbbrev[h.star.c];
        tip.textContent = con ? `${h.star.n} · in ${con.name}` : h.star.n;
        tip.classList.toggle('plain', !con);
        tip.style.left = `${p.x + 14}px`;
        tip.style.top = `${p.y + 14}px`;
        tip.hidden = false;
      } else tip.hidden = true;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      const wasClick = !dragging.moved;
      const p = pointerPos(e);
      dragging = null;
      canvas.style.cursor = 'grab';
      if (wasClick) {
        const h = Sky.pick(frame, p.x, p.y);
        select(h ? h.abbrev : null);
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', () => { dragging = null; });
    canvas.addEventListener('pointerleave', () => {
      $('tooltip').hidden = true;
      if (state.hovered) { state.hovered = null; draw(); }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      state.fov = Math.max(45, Math.min(150, state.fov + Math.sign(e.deltaY) * 6));
      draw();
    }, { passive: false });

    /* --- compass buttons --- */
    for (const b of document.querySelectorAll('.cbtn')) {
      b.addEventListener('click', () => lookAt(Number(b.dataset.az), state.targetPitch));
    }
    $('turnLeft').addEventListener('click', () => turnBy(-45));
    $('turnRight').addEventListener('click', () => turnBy(45));

    /* --- constellation lists --- */
    for (const listId of ['zodiacList', 'polarList']) {
      const el = $(listId);
      el.addEventListener('click', (e) => {
        const row = e.target.closest('[data-abbrev]');
        if (row) select(row.dataset.abbrev, true);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('[data-abbrev]');
        if (row) { e.preventDefault(); select(row.dataset.abbrev, true); }
      });
      el.addEventListener('pointerover', (e) => {
        const row = e.target.closest('[data-abbrev]');
        const next = row ? row.dataset.abbrev : null;
        if (next !== state.hovered) { state.hovered = next; draw(); }
      });
      el.addEventListener('pointerleave', () => {
        if (state.hovered) { state.hovered = null; draw(); }
      });
    }

    /* --- time --- */
    $('hourSlider').addEventListener('input', (e) => {
      if (syncing) return;
      const m = Number(e.target.value);
      setZoned({ hour: Math.floor(m / 60), minute: m % 60, second: 0 });
    });
    $('daySlider').addEventListener('input', (e) => {
      if (syncing) return;
      const p = Astro.zonedParts(state.date, state.tz);
      const { month, day } = fromDayOfYear(p.year, Number(e.target.value));
      setZoned({ month, day });
    });
    $('nowBtn').addEventListener('click', goLive);
    $('playBtn').addEventListener('click', () => {
      state.playing = !state.playing;
      if (state.playing) state.live = false;
      $('playBtn').classList.toggle('on', state.playing);
      $('playBtn').textContent = state.playing ? 'Pause' : 'Play';
    });
    $('speedSelect').addEventListener('change', (e) => {
      state.playSpeed = Number(e.target.value);
    });

    /* --- what you can see --- */
    const conditions = $('conditions');
    for (const c of SKY_CONDITIONS) conditions.add(new Option(c.label, c.id));
    conditions.value = state.conditions;
    const applyConditions = () => {
      const c = SKY_CONDITIONS.find((x) => x.id === conditions.value);
      state.conditions = c.id;
      state.magLimit = c.limit;
      $('conditionsNote').textContent = c.note;
      draw();
    };
    conditions.addEventListener('change', applyConditions);
    applyConditions();

    const toggles = {
      showZodiac: 'tZodiac', showCircumpolar: 'tCircumpolar', showLines: 'tLines',
      showLabels: 'tLabels', showStarNames: 'tStarNames', showMilkyWay: 'tMilkyWay',
      showBackdrop: 'tBackdrop', twinkle: 'tTwinkle',
    };
    for (const [key, id] of Object.entries(toggles)) {
      const el = $(id);
      el.checked = state[key];
      el.addEventListener('change', () => {
        state[key] = el.checked;
        if (key === 'showBackdrop') syncBackdrop();
        draw();
      });
    }
    syncBackdrop();

    /* --- location --- */
    $('applyLocation').addEventListener('click', () => {
      const lat = Number($('latInput').value), lon = Number($('lonInput').value);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) return flash('latInput');
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) return flash('lonInput');
      state.lat = lat; state.lon = lon;
      state.tz = $('tzSelect').value;
      state.placeName = $('placeInput').value.trim() || 'Somewhere on Earth';
      syncTimeInputs();
      draw();
    });
    $('resetLocation').addEventListener('click', () => {
      Object.assign(state, { lat: BERGAMO.lat, lon: BERGAMO.lon, tz: BERGAMO.tz, placeName: BERGAMO.name });
      fillLocationInputs(); syncTimeInputs(); draw();
    });
    $('geoBtn').addEventListener('click', () => {
      if (!navigator.geolocation) return;
      $('geoBtn').textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition((pos) => {
        state.lat = +pos.coords.latitude.toFixed(4);
        state.lon = +pos.coords.longitude.toFixed(4);
        state.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        state.placeName = 'Where you are';
        fillLocationInputs(); syncTimeInputs(); draw();
        $('geoBtn').textContent = 'Use my location';
      }, () => { $('geoBtn').textContent = 'Location unavailable'; }, { timeout: 10000 });
    });

    window.addEventListener('resize', () => draw());
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, select, textarea')) return;
      switch (e.key) {
        case 'Escape': select(null); break;
        case 'ArrowLeft': turnBy(-15); break;
        case 'ArrowRight': turnBy(15); break;
        case 'ArrowUp': state.targetPitch = Math.min(78, state.targetPitch + 8); break;
        case 'ArrowDown': state.targetPitch = Math.max(5, state.targetPitch - 8); break;
        case ' ': e.preventDefault(); $('playBtn').click(); break;
        case 'n': case 'N': goLive(); break;
      }
    });
  }

  /** The plate is a DOM layer, so it is shown or hidden outside the canvas draw. */
  function syncBackdrop() {
    $('backdrop').hidden = !state.showBackdrop;
  }

  function flash(id) {
    const el = $(id);
    el.classList.add('bad');
    setTimeout(() => el.classList.remove('bad'), 900);
  }

  function fillLocationInputs() {
    $('latInput').value = state.lat;
    $('lonInput').value = state.lon;
    $('placeInput').value = state.placeName;
    const sel = $('tzSelect');
    if (![...sel.options].some((o) => o.value === state.tz)) sel.add(new Option(state.tz, state.tz));
    sel.value = state.tz;
  }

  /* -------------------------------------------------------- URL injection --- */

  function applyUrlParams() {
    const q = new URLSearchParams(location.search);
    const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90) { state.lat = lat; state.placeName = 'Custom location'; }
    if (Number.isFinite(lon) && lon >= -180 && lon <= 180) { state.lon = lon; }
    const tz = q.get('tz');
    if (tz) {
      try { Astro.zoneOffsetMinutes(new Date(), tz); state.tz = tz; }
      catch { console.warn('Unknown time zone in URL; keeping', state.tz); }
    }
    const facing = parseFloat(q.get('facing'));
    if (Number.isFinite(facing)) {
      state.facing = state.targetFacing = Astro.norm360(facing);
    }
    const t = q.get('t');
    if (t) {
      if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) {
        const d = new Date(t);
        if (!Number.isNaN(+d)) { state.date = d; state.live = false; }
      } else {
        const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
        if (m) {
          state.date = Astro.instantFromZoned({
            year: +m[1], month: +m[2], day: +m[3],
            hour: +(m[4] || 0), minute: +(m[5] || 0), second: 0,
          }, state.tz);
          state.live = false;
        }
      }
    }
  }

  /* ----------------------------------------------------------------- boot --- */

  async function boot() {
    try {
      data = await loadData();
    } catch (err) {
      $('loadError').hidden = false;
      $('loadError').textContent =
        'Could not load the star catalogue. Serve this folder over HTTP ' +
        '(python3 -m http.server) or rebuild data/catalog.js. ' + err;
      return;
    }
    applyUrlParams();
    fillLocationInputs();
    syncTimeInputs();
    wire();
    draw();
    requestAnimationFrame(loop);

    // astronomy-engine arrives from the CDN after first paint; redraw when it does
    // so the Sun and Moon step up from the built-in series to the precise ones.
    let waited = 0;
    const poll = setInterval(() => {
      waited += 250;
      if (Astro.usableEngine() || waited > 6000) {
        clearInterval(poll);
        if (Astro.usableEngine()) draw();
      }
    }, 250);
  }

  window.__sky = { state, get data() { return data; }, get frame() { return frame; },
                   get computed() { return computed; }, computeSky, draw, lookAt, select };

  document.addEventListener('DOMContentLoaded', boot);
})();
