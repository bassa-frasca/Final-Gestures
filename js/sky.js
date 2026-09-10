/*
 * sky.js — naked-eye horizon view.
 *
 * You are standing outside facing a compass direction. The horizon runs along the
 * bottom, stars sit above it, and swinging left or right turns you on the spot.
 *
 * Projection: stereographic, centred on wherever you are looking. A star's angular
 * distance t from the centre of view maps to a radius of 2*tan(t/2), which keeps
 * constellation shapes recognisable right out to the edge of a wide field of view —
 * a plain perspective projection would stretch the corners badly at 110 degrees.
 */
const Sky = (() => {
  'use strict';

  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;

  const COMPASS = [
    [0, 'N'], [22.5, 'NNE'], [45, 'NE'], [67.5, 'ENE'],
    [90, 'E'], [112.5, 'ESE'], [135, 'SE'], [157.5, 'SSE'],
    [180, 'S'], [202.5, 'SSW'], [225, 'SW'], [247.5, 'WSW'],
    [270, 'W'], [292.5, 'WNW'], [315, 'NW'], [337.5, 'NNW'],
  ];

  // Sky colour by twilight band: [zenith, horizon]. The horizon is always a little
  // lighter than the zenith — airglow and distant light do that in real skies.
  const SKY_TINT = {
    day:          [[38, 92, 150], [150, 186, 214]],
    civil:        [[16, 33, 62], [92, 104, 132]],
    nautical:     [[10, 19, 40], [44, 56, 84]],
    astronomical: [[6, 12, 27], [24, 33, 55]],
    night:        [[3, 6, 15], [16, 23, 41]],
  };

  const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* ---------------------------------------------------------- view frame --- */

  /** Horizon-frame unit vector. x -> north, y -> east, z -> up. */
  function toVec(alt, az) {
    const a = alt * DEG, z = az * DEG, ca = Math.cos(a);
    return { x: ca * Math.cos(z), y: ca * Math.sin(z), z: Math.sin(a) };
  }

  /**
   * Orthonormal basis for a view direction: f forward, r to the viewer's right,
   * u up. Facing north, "right" is east — the way it works when you stand there.
   */
  function viewFrame(facingAz, pitchAlt) {
    const f = toVec(pitchAlt, facingAz);
    const A = facingAz * DEG;
    const r = { x: -Math.sin(A), y: Math.cos(A), z: 0 };
    const u = {                              // u = f x r
      x: f.y * r.z - f.z * r.y,
      y: f.z * r.x - f.x * r.z,
      z: f.x * r.y - f.y * r.x,
    };
    return { f, r, u };
  }

  /**
   * alt/az -> screen. Returns null for anything behind the viewer.
   * `depth` is the cosine of the angle from the centre of view, handy for fading
   * things out towards the edge of vision.
   */
  function project(alt, az, view) {
    const s = toVec(alt, az);
    const { frame, scale, cx, cy } = view;
    const sz = s.x * frame.f.x + s.y * frame.f.y + s.z * frame.f.z;
    if (sz <= -0.2) return null;                    // well behind the viewer
    const denom = 1 + sz;
    if (denom < 1e-6) return null;
    const sx = s.x * frame.r.x + s.y * frame.r.y + s.z * frame.r.z;
    const sy = s.x * frame.u.x + s.y * frame.u.y + s.z * frame.u.z;
    return {
      x: cx + (2 * sx / denom) * scale,
      y: cy - (2 * sy / denom) * scale,
      depth: sz,
    };
  }

  // Half of the vertical field that must always fit on screen, in degrees. Without
  // this, a wide short window (a laptop with the sidebar stacked below, say) gets a
  // vertical field of only ~25 degrees, and the horizon and compass fall off the
  // bottom entirely — you end up staring at empty sky with no way to orient.
  const MIN_VERTICAL_HALF_FOV = 34;

  /**
   * Per-frame view parameters. `fovDeg` is the requested horizontal field; it is
   * widened automatically when the canvas is too short to show enough sky
   * vertically, so the horizon always stays reachable.
   */
  function makeView(w, h, facingAz, pitchAlt, fovDeg, bottomInset = 0) {
    // The time controls sit over the bottom of the canvas, so the usable height is
    // less than the canvas height. Fit the sky to that, and lift the centre of view,
    // so the skyline and its compass labels stay clear of the controls.
    const usableH = Math.max(120, h - bottomInset);
    const rH = 2 * Math.tan((fovDeg / 2) * DEG / 2);
    const rV = 2 * Math.tan(MIN_VERTICAL_HALF_FOV * DEG / 2);
    // The smaller scale wins, i.e. whichever constraint demands more sky on screen.
    const scale = Math.min((w / 2) / rH, (usableH / 2) / rV);
    return {
      frame: viewFrame(facingAz, pitchAlt),
      scale,
      cx: w / 2,
      cy: usableH / 2,
      w, h, usableH, facingAz, pitchAlt, fovDeg,
      // What is actually on screen, once the constraint above has been applied.
      effectiveHalfFovH: 2 * Math.atan((w / 2) / scale / 2) * RAD,
      effectiveHalfFovV: 2 * Math.atan((usableH / 2) / scale / 2) * RAD,
    };
  }

  /* ------------------------------------------------------- galactic plane --- */

  // J2000 galactic pole and the galactic longitude of the north celestial pole.
  const GAL_POLE_RA = 192.85948, GAL_POLE_DEC = 27.12825, GAL_L_NCP = 122.93192;

  /** Galactic (l, b) in degrees -> J2000 equatorial (RA hours, Dec degrees). */
  function galacticToEquatorial(l, b) {
    const dG = GAL_POLE_DEC * DEG, aG = GAL_POLE_RA * DEG;
    const lb = (GAL_L_NCP - l) * DEG, bb = b * DEG;
    const sinDec = Math.sin(dG) * Math.sin(bb) + Math.cos(dG) * Math.cos(bb) * Math.cos(lb);
    const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
    const y = Math.cos(bb) * Math.sin(lb);
    const x = Math.cos(dG) * Math.sin(bb) - Math.sin(dG) * Math.cos(bb) * Math.cos(lb);
    const ra = aG + Math.atan2(y, x);
    return { ra: (((ra * RAD) % 360 + 360) % 360) / 15, dec: dec * RAD };
  }

  /**
   * The Milky Way, built from soft additive blobs strung along the galactic
   * equator. Blobs rather than one wide stroke because they overlap into an
   * uneven, patchy glow — closer to what the eye actually sees than a clean band.
   * Brightness peaks towards the galactic centre in Sagittarius and thins out
   * near Auriga on the far side, and a slow modulation stands in for the dust
   * lanes of the Great Rift.
   */
  function drawMilkyWay(ctx, view, astroCtx, dim) {
    if (dim < 0.08) return;
    const { jd, lstDeg, lat } = astroCtx;
    // Screen pixels per degree near the centre of view, so the band is sized in
    // degrees of sky rather than in pixels.
    const pxPerDeg = view.scale * DEG;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let l = 0; l <= 360; l += 2) {
      const toCentre = Math.abs(((l + 180) % 360) - 180);
      // Bright and broad towards Sagittarius, thin and faint opposite.
      const bright = 0.30 + 0.70 * Math.pow(Math.cos((toCentre / 2) * DEG), 2.2);
      const rift = 0.78 + 0.22 * Math.sin(l * 3.1 * DEG) * Math.cos(l * 1.7 * DEG);
      const widthDeg = 7 + 9 * bright;

      const eq = galacticToEquatorial(l, 0);
      const pr = Astro.precessFromJ2000(eq.ra, eq.dec, jd);
      const hz = Astro.equatorialToHorizontal(pr.ra, pr.dec, lstDeg, lat);
      if (hz.alt < -3) continue;
      const p = project(hz.alt, hz.az, view);
      if (!p || p.depth < 0.12) continue;

      // Fade into the horizon murk, and out towards the edge of vision.
      const horizonFade = Math.min(1, Math.max(0, (hz.alt + 1) / 14));
      const edgeFade = Math.min(1, (p.depth - 0.12) * 2.2);
      const alpha = 0.020 * bright * rift * horizonFade * edgeFade * dim;
      if (alpha < 0.0012) continue;

      const r = widthDeg * pxPerDeg;
      if (r < 1 || p.x < -r || p.x > view.w + r || p.y < -r || p.y > view.h + r) continue;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(188,203,236,${alpha})`);
      g.addColorStop(0.55, `rgba(170,188,228,${alpha * 0.45})`);
      g.addColorStop(1, 'rgba(150,175,225,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------- ground --- */

  /** The horizon as a screen polyline, sampled in azimuth around the viewer. */
  function horizonCurve(view) {
    const pts = [];
    for (let d = -180; d <= 180; d += 1.5) {
      const p = project(0, view.facingAz + d, view);
      if (p && p.depth > 0.02) pts.push(p);
    }
    return pts.sort((a, b) => a.x - b.x);
  }

  function drawGround(ctx, view, pts, sunGlow) {
    if (!pts.length) return;
    const { w, h } = view;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-20, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(w + 20, pts[pts.length - 1].y);
    ctx.lineTo(w + 20, h + 20);
    ctx.lineTo(-20, h + 20);
    ctx.closePath();

    const top = Math.min(...pts.map((p) => p.y));
    const g = ctx.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, '#0a0d14');
    g.addColorStop(0.25, '#05070c');
    g.addColorStop(1, '#020306');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // A faint rim of light along the skyline, warmed towards the Sun.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = sunGlow > 0.06
      ? `rgba(190,150,110,${0.10 + 0.30 * sunGlow})`
      : 'rgba(120,140,175,0.13)';
    ctx.stroke();
    ctx.restore();
  }

  function drawCompass(ctx, view, pts, scale) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const [az, name] of COMPASS) {
      const p = project(0, az, view);
      if (!p || p.depth < 0.25) continue;
      if (p.x < -30 || p.x > view.w + 30) continue;
      const major = name.length === 1;
      const minor = name.length === 3;
      if (minor && view.fovDeg > 130) continue;      // too crowded when zoomed out

      ctx.globalAlpha = Math.min(1, (p.depth - 0.25) * 3) * (major ? 0.92 : minor ? 0.4 : 0.62);
      ctx.fillStyle = major ? '#dbe6f4' : '#93a3bd';
      ctx.font = `${major ? 700 : 500} ${(major ? 13 : 10.5) * scale}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(name, p.x, p.y + 7 * scale);

      ctx.globalAlpha *= 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 4 * scale);
      ctx.lineTo(p.x, p.y + 3 * scale);
      ctx.strokeStyle = major ? '#dbe6f4' : '#93a3bd';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ----------------------------------------------------------- the sky bg --- */

  /**
   * @param skyAlpha 1 paints an opaque sky; less than 1 lets the deep-space plate
   *   behind the canvas show through. Daylight is always opaque — a nebula has no
   *   business showing through a blue sky.
   */
  function drawSkyBackground(ctx, view, twilightKey, sunMoon, dim, skyAlpha = 1) {
    const [zen, hor] = SKY_TINT[twilightKey] || SKY_TINT.night;
    const { w, h } = view;

    // Vertical wash: find where the horizon sits so the gradient tracks it.
    const hp = project(0, view.facingAz, view);
    const horizonY = hp ? Math.max(0, Math.min(h, hp.y)) : h * 0.78;
    const g = ctx.createLinearGradient(0, Math.min(0, horizonY - h), 0, horizonY);
    g.addColorStop(0, rgb(zen, skyAlpha));
    g.addColorStop(0.72, rgb(zen.map((v, i) => (v + hor[i]) / 2), skyAlpha));
    // Keep the horizon band close to opaque so the plate does not bleed into the
    // skyline, where it would read as haze sitting in front of the ground.
    g.addColorStop(1, rgb(hor, Math.min(1, skyAlpha + 0.3)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Twilight glow in the direction of the Sun, even while it is below the horizon.
    if (!sunMoon) return 0;
    const sun = sunMoon.sun;
    const strength = Math.max(0, Math.min(1, (sun.alt + 17) / 17));
    if (strength <= 0.02) return 0;
    const sp = project(Math.max(sun.alt, -14), sun.az, view);
    if (!sp) return strength;
    const radius = Math.max(w, h) * (0.55 + 0.35 * strength);
    const glow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, radius);
    const warm = sun.alt > -2 ? [255, 190, 130] : [210, 140, 110];
    glow.addColorStop(0, rgb(warm, 0.42 * strength * dim));
    glow.addColorStop(0.45, rgb([120, 110, 140], 0.16 * strength * dim));
    glow.addColorStop(1, rgb([60, 70, 110], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    return strength;
  }

  /* --------------------------------------------------------------- stars --- */

  /** Apparent size of a star to the eye: brighter reads as bigger and softer. */
  function starRadius(mag, scale) {
    return Math.max(0.5, (1.35 + (4.6 - mag) * 0.62) * scale);
  }

  function drawStar(ctx, p, mag, scale, alpha, twinkle) {
    const r = starRadius(mag, scale) * twinkle;
    const a = alpha * Math.min(1, 1.18 - mag * 0.055);

    if (mag < 2.6) {
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.6);
      halo.addColorStop(0, `rgba(255,253,244,${0.34 * a})`);
      halo.addColorStop(0.4, `rgba(214,228,255,${0.11 * a})`);
      halo.addColorStop(1, 'rgba(180,205,255,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 4.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,252,242,${a})`;
    ctx.fill();
  }

  /* ------------------------------------------------------------- drawing --- */

  function render(canvas, state, data, computed, anim) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 500;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const view = makeView(w, h, state.facing, state.pitch, state.fov, state.bottomInset || 0);
    const scale = Math.max(0.8, Math.min(1.5, w / 900));
    const { starAltAz, conVisible, sunMoon, twilightKey, astroCtx } = computed;

    // Daylight washes the stars out, exactly as it does outdoors.
    const dayWash = Math.max(0, Math.min(1, (sunMoon.sun.alt + 6) / 12));
    const starDim = 1 - 0.92 * dayWash;

    // Show the plate through the sky only once it is genuinely dark, and fade it
    // out as the Sun comes up so dusk washes it away the way real light does.
    const skyAlpha = state.showBackdrop
      ? Math.min(1, 0.26 + 0.74 * dayWash + 0.30 * Math.max(0, (sunMoon.sun.alt + 18) / 18))
      : 1;
    const sunGlow = drawSkyBackground(ctx, view, twilightKey, sunMoon, 1, skyAlpha);
    if (state.showMilkyWay) drawMilkyWay(ctx, view, astroCtx, starDim);

    const hit = { constellations: [], stars: [], view };
    const groupShown = (g) => (g === 'circumpolar' ? state.showCircumpolar : state.showZodiac);

    /* ---- constellation figures ---- */
    for (const con of data.constellations) {
      if (!groupShown(con.group)) continue;
      const selected = state.selected === con.abbrev;
      const hovered = state.hovered === con.abbrev;
      const muted = state.selected && !selected;
      const segments = [];

      for (const [i, j] of con.lines) {
        const A = starAltAz[i], B = starAltAz[j];
        if (A.alt < -1 && B.alt < -1) continue;
        const pa = project(A.alt, A.az, view);
        const pb = project(B.alt, B.az, view);
        if (!pa || !pb || pa.depth < 0.05 || pb.depth < 0.05) continue;
        segments.push([pa.x, pa.y, pb.x, pb.y]);
      }
      if (!segments.length) continue;

      if (state.showLines || selected || hovered) {
        ctx.save();
        // Gold for the twelve of the zodiac, muted grey-blue for the five extras.
        const base = con.group === 'circumpolar' ? [147, 168, 196] : [227, 199, 127];
        let alpha = state.showLines ? 0.34 : 0;
        if (hovered) alpha = 0.7;
        if (selected) alpha = 0.95;
        if (muted && !hovered) alpha *= 0.32;
        ctx.strokeStyle = rgb(base, alpha * starDim);
        ctx.lineWidth = (selected ? 1.5 : 1) * scale;
        ctx.lineCap = 'round';
        if (selected) {
          ctx.shadowColor = rgb(base, 0.5);
          ctx.shadowBlur = 7 * scale;
        }
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of segments) {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
        ctx.restore();
      }
      hit.constellations.push({ abbrev: con.abbrev, con, segments, label: null });
    }

    /* ---- stars ---- */
    const now = anim ? anim.t : 0;
    for (let i = 0; i < data.stars.length; i++) {
      const s = data.stars[i];
      const hz = starAltAz[i];
      if (hz.alt < 0) continue;
      // Stars in one of the 17 told constellations follow its toggle; every other
      // star in the catalogue is plain sky and is always drawn.
      const owner = data.conByAbbrev[s.c];
      if (owner && !groupShown(owner.group)) continue;

      // How dark the observer's sky is. Stars do not wink out at a hard limit —
      // the last half magnitude fades towards the threshold of seeing, and
      // everything is harder to catch low down through thicker, murkier air.
      const extinction = 0.9 * Math.max(0, 1 - hz.alt / 25);
      const effLimit = state.magLimit - extinction;
      if (s.m > effLimit) continue;
      const limitFade = Math.min(1, (effLimit - s.m) / 0.5 + 0.35);

      const p = project(hz.alt, hz.az, view);
      if (!p || p.depth < 0.04) continue;
      if (p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) {
        hit.stars.push({ x: p.x, y: p.y, r: 0, star: s, conAbbrev: s.c });
        continue;
      }

      // Scintillation: real and strongest for stars low down, through more air.
      let tw = 1;
      if (anim && anim.twinkle) {
        const lowness = Math.max(0, 1 - hz.alt / 40);
        const amp = 0.06 + 0.16 * lowness;
        tw = 1 + amp * Math.sin(now * (1.7 + (i % 7) * 0.31) + i * 2.399);
      }
      const edgeFade = Math.min(1, (p.depth - 0.04) * 4);
      const muted = state.selected && (!owner || owner.abbrev !== state.selected);
      drawStar(ctx, p, s.m, scale,
        starDim * edgeFade * limitFade * (muted ? 0.4 : 1), tw);
      // Only stars in a told constellation can open a story; the rest are
      // hoverable for their name but not clickable through to a panel.
      hit.stars.push({ x: p.x, y: p.y, r: starRadius(s.m, scale), star: s,
                       conAbbrev: owner ? s.c : null });

      const named = /^[A-Z][a-z]/.test(s.n);
      if (state.showStarNames && named && (s.m < 1.9 || state.selected === s.c) && starDim > 0.35) {
        ctx.save();
        ctx.globalAlpha = 0.62 * starDim * edgeFade;
        ctx.fillStyle = '#dce5f2';
        ctx.font = `${10.5 * scale}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.n, p.x + 7 * scale, p.y);
        ctx.restore();
      }
    }

    /* ---- Sun and Moon ---- */
    if (sunMoon.moon.alt > -1) {
      const p = project(sunMoon.moon.alt, sunMoon.moon.az, view);
      if (p && p.depth > 0.05) drawMoon(ctx, p, scale, sunMoon.moon);
    }
    if (sunMoon.sun.alt > -1) {
      const p = project(sunMoon.sun.alt, sunMoon.sun.az, view);
      if (p && p.depth > 0.05) drawSun(ctx, p, scale);
    }

    /* ---- ground, then names on top ---- */
    const pts = horizonCurve(view);
    drawGround(ctx, view, pts, sunGlow);
    drawCompass(ctx, view, pts, scale);

    if (state.showLabels) {
      for (const entry of hit.constellations) {
        const v = conVisible[entry.abbrev];
        if (!v || v.visibleStars < 2) continue;
        const p = project(v.centroidAlt, v.centroidAz, view);
        if (!p || p.depth < 0.35) continue;
        if (p.x < 40 || p.x > w - 40 || p.y < 18 || p.y > view.usableH - 18) continue;

        const selected = state.selected === entry.abbrev;
        const hovered = state.hovered === entry.abbrev;
        const muted = state.selected && !selected;
        ctx.save();
        ctx.font = `${selected ? 600 : 500} ${(selected ? 13.5 : 12) * scale}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(entry.con.name).width;
        ctx.globalAlpha = (selected ? 1 : hovered ? 0.95 : muted ? 0.28 : 0.72) * Math.max(0.35, starDim);
        if (selected || hovered) {
          ctx.fillStyle = 'rgba(6,9,17,0.66)';
          ctx.beginPath();
          ctx.roundRect(p.x - tw / 2 - 6 * scale, p.y - 9 * scale,
            tw + 12 * scale, 18 * scale, 4 * scale);
          ctx.fill();
        }
        ctx.fillStyle = entry.con.group === 'circumpolar' ? '#a8bad2' : '#e8d093';
        ctx.fillText(entry.con.name, p.x, p.y);
        ctx.restore();
        entry.label = { x: p.x, y: p.y, w: tw + 16 * scale, h: 22 * scale };
      }
    }

    return hit;
  }

  function drawSun(ctx, p, scale) {
    const r = 8 * scale;
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 8);
    g.addColorStop(0, 'rgba(255,236,190,0.95)');
    g.addColorStop(0.14, 'rgba(255,206,120,0.5)');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff6dc';
    ctx.fill();
    ctx.restore();
  }

  /**
   * The Moon at its true size-ish with the terminator drawn, so the phase reads at
   * a glance. In the northern sky a waxing moon is lit on its right-hand limb.
   */
  function drawMoon(ctx, p, scale, moon) {
    const r = 9 * scale;
    const k = Math.max(0, Math.min(1, moon.illum));

    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, r, p.x, p.y, r * 6);
    g.addColorStop(0, `rgba(226,232,246,${0.22 + 0.3 * k})`);
    g.addColorStop(1, 'rgba(200,215,245,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 6, 0, Math.PI * 2);
    ctx.fill();

    // Earthshine: the unlit part is not truly black.
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(46,52,68,0.85)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.clip();
    const half = Math.PI / 2;
    const litRight = moon.waxing;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, litRight ? -half : half, litRight ? half : half * 3);
    const bulge = r * (2 * k - 1);
    ctx.ellipse(p.x, p.y, Math.abs(bulge), r, 0,
      litRight ? half : -half, litRight ? -half : half,
      bulge >= 0 ? litRight : !litRight);
    ctx.fillStyle = '#f6f4ea';
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------- hit testing --- */

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  /** Labels first, then stars, then figure lines — easiest to aim at wins. */
  function pick(hit, px, py) {
    if (!hit) return null;
    for (const e of hit.constellations) {
      const L = e.label;
      if (L && Math.abs(px - L.x) <= L.w / 2 && Math.abs(py - L.y) <= L.h / 2) {
        return { abbrev: e.abbrev, via: 'label' };
      }
    }
    let best = null, namedOnly = null;
    for (const s of hit.stars) {
      if (!s.r) continue;
      const d = Math.hypot(px - s.x, py - s.y);
      if (d > Math.max(11, s.r + 7)) continue;
      if (s.conAbbrev) {
        if (!best || d < best.d) best = { abbrev: s.conAbbrev, via: 'star', star: s.star, d };
      } else if (!namedOnly || d < namedOnly.d) {
        namedOnly = { abbrev: null, via: 'star', star: s.star, d };
      }
    }
    if (best) return best;
    for (const e of hit.constellations) {
      for (const [x1, y1, x2, y2] of e.segments) {
        const d = distToSegment(px, py, x1, y1, x2, y2);
        if (d <= 9 && (!best || d < best.d)) best = { abbrev: e.abbrev, via: 'line', d };
      }
    }
    // A field star's name is still worth showing if nothing else was hit.
    return best || namedOnly;
  }

  return { render, pick, project, makeView, starRadius, galacticToEquatorial, COMPASS };
})();
