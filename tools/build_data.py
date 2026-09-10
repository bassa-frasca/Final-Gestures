#!/usr/bin/env python3
"""
Build a trimmed star catalog + constellation line figures for the night-sky app.

Inputs (downloaded at build time, both open data):
  - HYG Database v4.1 CSV  (public domain / CC0)
      https://github.com/astronexus/HYG-Database  hyg/CURRENT/hygdata_v41.csv
  - Stellarium "modern_iau" sky culture index.json (GPLv2, line figures keyed by HIP)
      https://github.com/Stellarium/stellarium  skycultures/modern_iau/index.json

Outputs:
  - data/stars.json          all stars to mag 5.2 plus every constellation-line vertex:
                             name, ra (hours J2000), dec (deg J2000), mag, con
  - data/constellations.json line figures (index pairs into stars.json) + mythology content
  - data/catalog.js          the same two payloads as globals, so index.html works when
                             opened directly from a file:// URL (browsers block fetch()
                             of local JSON there). Generated - edit the JSON sources or
                             tools/mythology.json and re-run this script.

Run:  python3 tools/build_data.py --hyg <hyg.csv> --iau <index.json> --out data/
"""

import argparse, csv, json, os, re, sys

# 12 zodiac + 5 circumpolar (as seen from mid-northern latitudes)
ZODIAC = ["Ari","Tau","Gem","Cnc","Leo","Vir","Lib","Sco","Sgr","Cap","Aqr","Psc"]
CIRCUMPOLAR = ["UMa","UMi","Cas","Cep","Dra"]
TARGETS = ZODIAC + CIRCUMPOLAR

# Every star this bright anywhere in the sky, so the view looks like the real thing
# rather than 17 constellations floating in a void. 5.2 is roughly the naked-eye
# limit under a genuinely dark country sky.
ALL_SKY_MAG = 5.2

# A few stars that Stellarium references by HIP are stored in HYG as Gliese entries
# with an empty "hip" column, so they can only be matched on HD number.
#   55203 = Xi Ursae Majoris (Alula Australis), a line vertex in the Big Dipper's paw.
HIP_TO_HD_FALLBACK = {55203: 98231}

# Greek letter names -> symbols, for labelling Bayer-designated stars
SUPERSCRIPT = {"": "", "1": "\u00b9", "2": "\u00b2", "3": "\u00b3",
               "4": "\u2074", "5": "\u2075", "6": "\u2076",
               "7": "\u2077", "8": "\u2078", "9": "\u2079"}

GREEK = {
 "Alp":"α","Bet":"β","Gam":"γ","Del":"δ","Eps":"ε","Zet":"ζ",
 "Eta":"η","The":"θ","Iot":"ι","Kap":"κ","Lam":"λ","Mu":"μ",
 "Nu":"ν","Xi":"ξ","Omi":"ο","Pi":"π","Rho":"ρ","Sig":"σ",
 "Tau":"τ","Ups":"υ","Phi":"φ","Chi":"χ","Psi":"ψ","Ome":"ω",
}


def load_glyph_spec(path):
    """
    Star-glyph spec from tools/star-glyphs.json (supplied alongside the design).

    The file lists a glyph id per star, but those values turn out to be fully
    derivable: sorting a constellation's figure stars by magnitude and indexing
    glyphOrder by (rank % len(glyphOrder)) reproduces all 110 of its assignments
    exactly. So the rule is applied to our own catalogue rather than matching the
    file star by star - our positions are the more precise of the two, and the rule
    then also covers the constellations the file does not include.
    """
    spec = json.load(open(path, encoding="utf-8"))
    order = spec["glyphOrder"]
    radii = spec["glyphOuterRadius"]
    if not order:
        sys.exit("glyph spec has an empty glyphOrder")
    return {
        "order": order,
        "outer_radius": radii,
        # Suggested by the spec's notes; kept here so the renderer and the
        # provenance stay in one place.
        "scale_from_mag": {"base": 0.42, "pivot": 0.85, "slope": 0.055,
                           "min": 0.16, "max": 0.42},
        "source": os.path.basename(path),
    }


def load_iau_lines(path):
    """Return {con_abbrev: [[hip,...], ...]} for our target constellations."""
    data = json.load(open(path, encoding="utf-8"))
    out = {}
    for c in data.get("constellations", []):
        # ids look like "CON modern_iau And"
        abbrev = c["id"].split()[-1]
        if abbrev in TARGETS:
            out[abbrev] = c.get("lines", [])
    missing = [t for t in TARGETS if t not in out]
    if missing:
        sys.exit("IAU data missing constellations: %s" % missing)
    return out


def star_label(row):
    """Best human label: proper name, else Greek/Bayer, else Flamsteed, else HIP."""
    proper = (row.get("proper") or "").strip()
    if proper:
        return proper
    bayer = (row.get("bayer") or "").strip()
    con = (row.get("con") or "").strip()
    if bayer:
        # HYG spells a Bayer superscript as a trailing digit, sometimes hyphenated:
        # "Alp1" and "Zet-1" both occur, so strip the digit and any separator.
        m = re.match(r"^([A-Za-z]+)[-\s]?([0-9]?)$", bayer)
        if m:
            sym = GREEK.get(m.group(1))
            if sym:
                sup = SUPERSCRIPT.get(m.group(2), "")
                return ("%s%s %s" % (sym, sup, con)).strip() if con else sym + sup
        return "%s %s" % (bayer, con)
    flam = (row.get("flam") or "").strip()
    if flam:
        return "%s %s" % (flam, con)
    hip = (row.get("hip") or "").strip()
    return "HIP %s" % hip if hip else ""


def build(hyg_path, iau_path, outdir, myths_path, glyph_path=None):
    lines_by_con = load_iau_lines(iau_path)
    glyphs = load_glyph_spec(glyph_path) if glyph_path else None

    # every HIP that a line figure needs — these must be kept no matter how faint
    needed_hip = set()
    for segs in lines_by_con.values():
        for seg in segs:
            needed_hip.update(int(h) for h in seg)

    # HD numbers we may need to fall back on, mapped back to the HIP that wants them
    hd_fallback = {hd: hip for hip, hd in HIP_TO_HD_FALLBACK.items() if hip in needed_hip}

    by_hip = {}      # hip -> star dict, for resolving line vertices
    field = []       # every other star bright enough to see

    with open(hyg_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            hip_s = (row.get("hip") or "").strip()
            hip = int(hip_s) if hip_s else None
            if hip is None:
                hd_s = (row.get("hd") or "").strip()
                if hd_s and int(hd_s) in hd_fallback:
                    hip = hd_fallback[int(hd_s)]
            con = (row.get("con") or "").strip()
            try:
                mag = float(row["mag"]); ra = float(row["ra"]); dec = float(row["dec"])
            except (ValueError, KeyError, TypeError):
                continue
            if row.get("proper") == "Sol":
                continue

            is_vertex = hip is not None and hip in needed_hip
            # Line vertices are kept however faint; everything else must be visible.
            if not is_vertex and mag > ALL_SKY_MAG:
                continue

            star = {
                "n": star_label(row),
                "ra": round(ra, 6),      # hours, J2000
                "dec": round(dec, 6),    # degrees, J2000
                "m": round(mag, 2),
                "c": con,
            }
            if hip is not None:
                star["hip"] = hip

            if is_vertex:
                # HYG can list several components under one HIP; keep the brightest.
                prev = by_hip.get(hip)
                if prev is None or star["m"] < prev["m"]:
                    by_hip[hip] = star
            else:
                field.append(star)

    missing = sorted(needed_hip - set(by_hip))
    if missing:
        print("WARNING: %d line-vertex HIPs not found in HYG: %s" % (len(missing), missing[:20]))

    # Line vertices come first so their indices are stable and compact; the rest of
    # the sky follows, brightest first.
    stars = []
    index_of_hip = {}
    for hip, star in sorted(by_hip.items(), key=lambda kv: kv[1]["m"]):
        index_of_hip[hip] = len(stars)
        stars.append(star)
    vertex_hips = set(by_hip)
    for star in sorted(field, key=lambda s: s["m"]):
        if star.get("hip") in vertex_hips:
            continue
        star.pop("hip", None)      # only vertices need to stay identifiable
        stars.append(star)

    # Decorative glyph per figure star, by brightness rank within its own figure.
    if glyphs:
        order = glyphs["order"]
        for abbrev in TARGETS:
            members = sorted(
                {index_of_hip[int(h)] for poly in lines_by_con[abbrev]
                 for h in poly if int(h) in index_of_hip},
                key=lambda i: stars[i]["m"],
            )
            for rank, i in enumerate(members):
                stars[i]["g"] = order[rank % len(order)]

    # Constellation figures: convert HIP polylines to index segment pairs.
    myths = json.load(open(myths_path, encoding="utf-8"))
    constellations = []
    for abbrev in TARGETS:
        segs = []
        for poly in lines_by_con[abbrev]:
            idxs = [index_of_hip[int(h)] for h in poly if int(h) in index_of_hip]
            for a, b in zip(idxs, idxs[1:]):
                if a != b:
                    segs.append([a, b])
        info = myths.get(abbrev)
        if info is None:
            sys.exit("Missing mythology entry for %s" % abbrev)
        constellations.append({
            "abbrev": abbrev,
            "name": info["name"],
            "group": "circumpolar" if abbrev in CIRCUMPOLAR else "zodiac",
            "lines": segs,
            "myth_fact": info["myth_fact"],
            "ancient_use": info["ancient_use"],
            "story": info["story"],
            "brightest": info.get("brightest", ""),
        })

    os.makedirs(outdir, exist_ok=True)
    meta = {
        "star_source": "HYG Database v4.1 (hygdata_v41.csv), astronexus/HYG-Database, public domain",
        "line_source": "Stellarium modern_iau sky culture (index.json), IAU-recognised figures",
        "epoch": "J2000",
        "all_sky_mag_limit": ALL_SKY_MAG,
    }
    if glyphs:
        meta["glyphs"] = glyphs
    with open(os.path.join(outdir, "stars.json"), "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "stars": stars}, fh, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(outdir, "constellations.json"), "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "constellations": constellations}, fh,
                  indent=1, ensure_ascii=False)

    # file:// friendly copy of both payloads as plain globals.
    with open(os.path.join(outdir, "catalog.js"), "w", encoding="utf-8") as fh:
        fh.write("/* Generated by tools/build_data.py - do not edit by hand.\n"
                 " * Mirrors data/stars.json and data/constellations.json as globals so the\n"
                 " * page loads from a file:// URL, where fetch() of local JSON is blocked.\n"
                 " */\n")
        fh.write("window.STAR_DATA=")
        json.dump({"meta": meta, "stars": stars}, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write(";\n")
        fh.write("window.CONSTELLATION_DATA=")
        json.dump({"meta": meta, "constellations": constellations}, fh,
                  separators=(",", ":"), ensure_ascii=False)
        fh.write(";\n")

    print("stars.json: %d stars (%d line vertices, %d field stars to mag %.1f)"
          % (len(stars), len(by_hip), len(stars) - len(by_hip), ALL_SKY_MAG))
    print("constellations.json: %d constellations, %d segments"
          % (len(constellations), sum(len(c["lines"]) for c in constellations)))
    print("constellations represented in the star field: %d"
          % len({s["c"] for s in stars if s["c"]}))
    if glyphs:
        tally = {}
        for st in stars:
            if "g" in st:
                tally[st["g"]] = tally.get(st["g"], 0) + 1
        print("glyphs assigned: %d stars %s"
              % (sum(tally.values()), dict(sorted(tally.items()))))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--hyg", required=True)
    p.add_argument("--iau", required=True)
    p.add_argument("--myths", required=True)
    p.add_argument("--glyphs", help="star-glyph spec (tools/star-glyphs.json)")
    p.add_argument("--out", default="data")
    a = p.parse_args()
    build(a.hyg, a.iau, a.out, a.myths, a.glyphs)
