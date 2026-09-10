/*
 * astro.js — coordinate and time astronomy for the sky chart.
 *
 * Star positions in data/stars.json are J2000 mean equatorial. To draw them for a
 * given instant we (1) precess J2000 -> mean equinox of date, (2) convert to local
 * hour angle using local sidereal time, (3) rotate to altitude/azimuth, and
 * (4) add atmospheric refraction.
 *
 * Sun and Moon come from astronomy-engine (MIT, Don Cross) when the CDN script has
 * loaded. Compact built-in series are used as a fallback so the page still works
 * fully offline from a file:// URL; Astro.ephemerisSource() reports which is active.
 */
const Astro = (() => {
  'use strict';

  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const J2000 = 2451545.0;
  const norm360 = (d) => ((d % 360) + 360) % 360;

  /* ---------------------------------------------------------------- time --- */

  /** Julian Day for a JS Date (which is already an absolute UTC instant). */
  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  /**
   * Greenwich mean sidereal time in degrees (Meeus, Astronomical Algorithms 12.4).
   * Accurate to well under an arcsecond for our era — far below one screen pixel.
   */
  function gmst(jd) {
    const d = jd - J2000;
    const T = d / 36525;
    return norm360(
      280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000
    );
  }

  /** Local mean sidereal time in degrees; lonEast is positive east of Greenwich. */
  function lst(jd, lonEast) {
    return norm360(gmst(jd) + lonEast);
  }

  /* ---------------------------------------------------------- precession --- */

  /**
   * Precess mean J2000 equatorial coordinates to the mean equinox of date
   * (Lieske et al. 1977 rotation angles, as given in Meeus ch. 21).
   * Over a couple of decades this is a shift of roughly a quarter of a degree —
   * small, but larger than a pixel, so it is worth doing properly.
   * @param {number} raHours right ascension, hours
   * @param {number} decDeg  declination, degrees
   * @returns {{ra: number, dec: number}} of-date RA (hours) and Dec (degrees)
   */
  function precessFromJ2000(raHours, decDeg, jd) {
    const T = (jd - J2000) / 36525;
    const arcsec = 1 / 3600;
    const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * arcsec * DEG;
    const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * arcsec * DEG;
    const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * arcsec * DEG;

    const ra0 = raHours * 15 * DEG;
    const dec0 = decDeg * DEG;
    const cd = Math.cos(dec0), sd = Math.sin(dec0);
    const cRaZeta = Math.cos(ra0 + zeta), sRaZeta = Math.sin(ra0 + zeta);

    const A = cd * sRaZeta;
    const B = Math.cos(theta) * cd * cRaZeta - Math.sin(theta) * sd;
    const C = Math.sin(theta) * cd * cRaZeta + Math.cos(theta) * sd;

    return {
      ra: norm360((Math.atan2(A, B) + z) * RAD) / 15,
      dec: Math.asin(Math.max(-1, Math.min(1, C))) * RAD,
    };
  }

  /* ------------------------------------------------------ horizon frame --- */

  /**
   * Atmospheric refraction in degrees (Bennett 1982). Lifts objects near the
   * horizon by about half a degree, which is exactly where "is it up yet?" is
   * decided, so it matters for visibility even though it is tiny elsewhere.
   *
   * Below -1 degrees the model stops being meaningful. Rather than cutting to
   * zero (which would put a 0.65 degree step right next to the horizon and make
   * stars flicker between up and down while scrubbing time) the input is clamped
   * and the result tapered linearly to zero at the nadir. This is exactly what
   * astronomy-engine does in 'normal' mode, so the two agree to well under an
   * arcsecond at every altitude.
   */
  function refraction(altDeg) {
    if (altDeg < -90 || altDeg > 90) return 0;
    const h = Math.max(altDeg, -1);
    let refr = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) / 60;
    if (altDeg < -1) refr *= (altDeg + 90) / 89;
    return refr;
  }

  /**
   * Equatorial (of date) -> horizontal. Azimuth is measured from north,
   * increasing eastward, so 0=N, 90=E, 180=S, 270=W.
   *   sin(alt) = sin d sin f + cos d cos f cos H
   *   cos(alt) sin(Az) = -cos d sin H
   *   cos(alt) cos(Az) =  sin d cos f - cos d sin f cos H
   * @param {number} raHours of-date right ascension, hours
   * @param {number} decDeg  of-date declination, degrees
   * @param {number} lstDeg  local sidereal time, degrees
   * @param {number} latDeg  observer latitude, degrees
   * @param {boolean} [applyRefraction=true]
   */
  function equatorialToHorizontal(raHours, decDeg, lstDeg, latDeg, applyRefraction = true) {
    const H = (lstDeg - raHours * 15) * DEG;   // hour angle, increasing westward
    const d = decDeg * DEG;
    const f = latDeg * DEG;
    const sd = Math.sin(d), cd = Math.cos(d);
    const sf = Math.sin(f), cf = Math.cos(f);
    const cH = Math.cos(H), sH = Math.sin(H);

    const sinAlt = Math.max(-1, Math.min(1, sd * sf + cd * cf * cH));
    let alt = Math.asin(sinAlt) * RAD;
    const az = norm360(Math.atan2(-cd * sH, sd * cf - cd * sf * cH) * RAD);
    if (applyRefraction) alt += refraction(alt);
    return { alt, az };
  }

  /** Convenience: J2000 catalogue entry straight to alt/az for an instant. */
  function starAltAz(raJ2000, decJ2000, jd, lstDeg, latDeg) {
    const p = precessFromJ2000(raJ2000, decJ2000, jd);
    return equatorialToHorizontal(p.ra, p.dec, lstDeg, latDeg);
  }

  /** Ecliptic longitude (deg) at zero latitude -> of-date equatorial. */
  function eclipticToEquatorial(lonDeg, latDeg, jd) {
    const T = (jd - J2000) / 36525;
    const eps = (23.439291 - 0.0130042 * T) * DEG;
    const l = lonDeg * DEG, b = latDeg * DEG;
    const sl = Math.sin(l), cl = Math.cos(l), sb = Math.sin(b), cb = Math.cos(b);
    const ra = Math.atan2(sl * Math.cos(eps) - (sb / cb) * Math.sin(eps), cl);
    const dec = Math.asin(sb * Math.cos(eps) + cb * Math.sin(eps) * sl);
    return { ra: norm360(ra * RAD) / 15, dec: dec * RAD };
  }

  /* ------------------------------------------------------- sun and moon --- */

  const engine = () => (typeof window !== 'undefined' ? window.Astronomy : null);

  /**
   * Only use astronomy-engine if it exposes the calls we rely on. A CDN miss or an
   * API change should quietly degrade to the built-in series, never blank the chart.
   */
  function usableEngine() {
    const eng = engine();
    if (!eng) return null;
    const ok = typeof eng.Observer === 'function'
      && typeof eng.Equator === 'function'
      && typeof eng.Illumination === 'function'
      && typeof eng.MoonPhase === 'function'
      && eng.Body;
    return ok ? eng : null;
  }

  function ephemerisSource() {
    return usableEngine() ? 'astronomy-engine' : 'built-in';
  }

  /** Low-precision Sun, of date (Meeus ch. 25). Good to about 0.01 degrees. */
  function sunEquatorialFallback(jd) {
    const n = jd - J2000;
    const L = norm360(280.460 + 0.9856474 * n);
    const g = norm360(357.528 + 0.9856003 * n) * DEG;
    const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
    const eps = (23.439 - 0.0000004 * n) * DEG;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    return { ra: norm360(ra * RAD) / 15, dec: dec * RAD, lon: norm360(lambda * RAD) };
  }

  /** Abbreviated lunar series (Meeus ch. 47, leading terms). Good to ~0.3 deg. */
  function moonEquatorialFallback(jd) {
    const T = (jd - J2000) / 36525;
    const Lp = norm360(218.3164477 + 481267.88123421 * T);      // mean longitude
    const D = norm360(297.8501921 + 445267.1114034 * T) * DEG;  // mean elongation
    const M = norm360(357.5291092 + 35999.0502909 * T) * DEG;   // sun mean anomaly
    const Mp = norm360(134.9633964 + 477198.8675055 * T) * DEG; // moon mean anomaly
    const F = norm360(93.2720950 + 483202.0175233 * T) * DEG;   // argument of latitude

    const lon = Lp
      + 6.289 * Math.sin(Mp)
      + 1.274 * Math.sin(2 * D - Mp)
      + 0.658 * Math.sin(2 * D)
      + 0.214 * Math.sin(2 * Mp)
      - 0.186 * Math.sin(M)
      - 0.114 * Math.sin(2 * F);
    const lat =
      5.128 * Math.sin(F)
      + 0.281 * Math.sin(Mp + F)
      - 0.278 * Math.sin(F - Mp)
      - 0.173 * Math.sin(2 * D - F);

    const eq = eclipticToEquatorial(norm360(lon), lat, jd);
    return { ra: eq.ra, dec: eq.dec, lon: norm360(lon) };
  }

  /**
   * Sun and Moon for an instant, in horizontal coordinates, plus the Moon's
   * illuminated fraction and whether it is waxing.
   */
  function sunMoon(date, jd, lstDeg, latDeg, lonDeg) {
    const eng = usableEngine();
    let sunEq, moonEq, illum, waxing;

    if (eng) {
      const obs = new eng.Observer(latDeg, lonDeg, 0);
      const sv = eng.Equator(eng.Body.Sun, date, obs, true, true);
      const mv = eng.Equator(eng.Body.Moon, date, obs, true, true);
      sunEq = { ra: sv.ra, dec: sv.dec };
      moonEq = { ra: mv.ra, dec: mv.dec };
      illum = eng.Illumination(eng.Body.Moon, date).phase_fraction;
      // Phase angle 0-360 measured from new moon; the first half is waxing.
      waxing = eng.MoonPhase(date) < 180;
    } else {
      sunEq = sunEquatorialFallback(jd);
      moonEq = moonEquatorialFallback(jd);
      const elong = norm360(moonEq.lon - sunEq.lon);
      illum = (1 - Math.cos(elong * DEG)) / 2;
      waxing = elong < 180;
    }

    return {
      sun: {
        ...sunEq,
        ...equatorialToHorizontal(sunEq.ra, sunEq.dec, lstDeg, latDeg),
      },
      moon: {
        ...moonEq,
        ...equatorialToHorizontal(moonEq.ra, moonEq.dec, lstDeg, latDeg),
        illum,
        waxing,
        phaseName: moonPhaseName(illum, waxing),
      },
    };
  }

  /**
   * Just the Sun's altitude, in degrees. Separate from sunMoon() because searching
   * for nightfall samples a whole day, and there is no reason to compute the Moon a
   * hundred and forty times over to find out when it gets dark.
   */
  function sunAltitude(date, latDeg, lonDeg) {
    const jd = julianDay(date);
    const lstDeg = lst(jd, lonDeg);
    const eng = usableEngine();
    const eq = eng
      ? eng.Equator(eng.Body.Sun, date, new eng.Observer(latDeg, lonDeg, 0), true, true)
      : sunEquatorialFallback(jd);
    return equatorialToHorizontal(eq.ra, eq.dec, lstDeg, latDeg).alt;
  }

  function moonPhaseName(illum, waxing) {
    if (illum < 0.02) return 'New Moon';
    if (illum > 0.98) return 'Full Moon';
    if (Math.abs(illum - 0.5) < 0.06) return waxing ? 'First Quarter' : 'Last Quarter';
    if (illum < 0.5) return waxing ? 'Waxing Crescent' : 'Waning Crescent';
    return waxing ? 'Waxing Gibbous' : 'Waning Gibbous';
  }

  /** Named twilight band from the Sun's altitude. */
  function twilight(sunAlt) {
    if (sunAlt > -0.833) return { key: 'day', label: 'Daylight' };
    if (sunAlt > -6) return { key: 'civil', label: 'Civil twilight' };
    if (sunAlt > -12) return { key: 'nautical', label: 'Nautical twilight' };
    if (sunAlt > -18) return { key: 'astronomical', label: 'Astronomical twilight' };
    return { key: 'night', label: 'Night' };
  }

  /* ------------------------------------------------------------ timezone --- */

  /** Offset in minutes (east positive) of an IANA zone at a given instant. */
  function zoneOffsetMinutes(date, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const { type, value } of dtf.formatToParts(date)) p[type] = value;
    // Treat the zone's wall clock as if it were UTC, then compare to the real instant.
    const asUTC = Date.UTC(+p.year, p.month - 1, +p.day,
      p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  }

  /** Wall-clock fields for an instant in a zone. */
  function zonedParts(date, timeZone) {
    const off = zoneOffsetMinutes(date, timeZone);
    const shifted = new Date(date.getTime() + off * 60000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
      offsetMinutes: off,
    };
  }

  /**
   * Inverse of zonedParts: a wall clock reading in a zone -> absolute instant.
   * Iterates because the offset itself depends on the instant (DST); two passes
   * settle every case except the ambiguous hour of a fall-back transition.
   */
  function instantFromZoned({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
    let guess = Date.UTC(year, month - 1, day, hour, minute, second);
    for (let i = 0; i < 3; i++) {
      const off = zoneOffsetMinutes(new Date(guess), timeZone);
      const next = Date.UTC(year, month - 1, day, hour, minute, second) - off * 60000;
      if (next === guess) break;
      guess = next;
    }
    return new Date(guess);
  }

  function formatOffset(minutes) {
    const sign = minutes < 0 ? '-' : '+';
    const a = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  }

  /* ----------------------------------------------------- compass helpers --- */

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compassPoint = (az) => COMPASS[Math.round(norm360(az) / 22.5) % 16];

  return {
    DEG, RAD, norm360,
    julianDay, gmst, lst,
    precessFromJ2000, equatorialToHorizontal, starAltAz, eclipticToEquatorial, refraction,
    sunMoon, sunAltitude, twilight, moonPhaseName, ephemerisSource, usableEngine,
    zoneOffsetMinutes, zonedParts, instantFromZoned, formatOffset,
    compassPoint,
  };
})();
