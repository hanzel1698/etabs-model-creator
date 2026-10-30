"""
ETABS bridge for ETABS Model Creator.

Runs a small HTTP server on http://127.0.0.1:8765 that the web app calls. It attaches to a running
ETABS 22 instance through the COM OAPI (ETABSv1) and reads/writes the model.

    pip install comtypes
    python bridge.py            # optional: --port 8765 --tlb "C:\\...\\ETABSv1.tlb"

All lengths exchanged with the web app are millimetres; the bridge switches ETABS present units to
kN-mm-C while it works and restores the user's units afterwards.
"""
import argparse
import glob
import json
import os
import sys
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

import comtypes
import comtypes.client

KN_MM_C = 5
TOL = 1.0  # mm
GRID_TABLE = "Grid Definitions - Grid Lines"
MAT_TYPES = {1: "Steel", 2: "Concrete", 3: "NoDesign", 4: "Aluminum", 5: "ColdFormed", 6: "Rebar", 7: "Tendon", 8: "Masonry"}

E = None  # comtypes.gen.ETABSv1
_etabs = None
_sm = None


class EtabsError(Exception):
    pass


def trace(*a):
    if os.environ.get("BRIDGE_TRACE"):
        print("[trace]", *a, flush=True)


def find_tlb(explicit=None):
    if explicit and os.path.exists(explicit):
        return explicit
    roots = [os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramW6432", r"C:\Program Files")]
    for root in roots:
        hits = sorted(glob.glob(os.path.join(root, "Computers and Structures", "ETABS 2*", "NativeAPI", "x64", "ETABSv1.tlb")), reverse=True)
        if hits:
            return hits[0]
    return None


def load_typelib(tlb):
    global E
    if E is None:
        if not tlb:
            raise EtabsError("ETABSv1.tlb not found. Pass --tlb with its path (ETABS 22\\NativeAPI\\x64\\ETABSv1.tlb).")
        mod = comtypes.client.GetModule(tlb)
        # ETABS 20 and 22 type libraries share the same LIBID/version, so comtypes may hand back a wrapper
        # generated earlier from another ETABS version. Calls through a wrong wrapper hit the wrong vtable
        # slots and crash ETABS' marshaller, so regenerate it when the cached source is not our tlb.
        if os.path.normcase(getattr(mod, "typelib_path", tlb)) != os.path.normcase(tlb):
            from comtypes import gen as cgen
            gen = os.path.dirname(cgen.__file__)
            stale = [n for n in list(sys.modules) if n == "comtypes.gen.ETABSv1" or n.startswith("comtypes.gen._542F7A9D")]
            for n in stale:
                del sys.modules[n]
            for f in glob.glob(os.path.join(gen, "_542F7A9D*")) + glob.glob(os.path.join(gen, "ETABSv1.py")):
                os.remove(f)
            print(f"Regenerated ETABSv1 wrapper from {tlb} (cached one came from {mod.typelib_path})")
            mod = comtypes.client.GetModule(tlb)
        E = mod


def attach(tlb=None):
    """Attach to the running ETABS instance."""
    global _etabs, _sm
    load_typelib(tlb or ARGS.tlb_path)
    obj = None
    err = None
    try:
        helper = comtypes.client.CreateObject("ETABSv1.Helper")
        helper = helper.QueryInterface(E.cHelper)
        obj = helper.GetObject("CSI.ETABS.API.ETABSObject")
    except Exception as e:  # noqa
        err = e
    if obj is None:
        try:
            obj = comtypes.client.GetActiveObject("CSI.ETABS.API.ETABSObject")
            obj = obj.QueryInterface(E.cOAPI)
        except Exception as e:  # noqa
            err = e
    if obj is None:
        raise EtabsError(f"No running ETABS instance found ({err}). Open ETABS 22 with a model first.")
    _etabs = obj
    _sm = obj.SapModel
    return _sm


def sm():
    global _sm
    if _sm is None:
        attach()
    try:
        _sm.GetModelFilename(True)
    except Exception:
        attach()  # ETABS was restarted
    return _sm


def ok(res, what):
    """comtypes returns [out..., retcode] for methods with ByRef args, or just retcode."""
    ret = res[-1] if isinstance(res, (list, tuple)) else res
    if ret != 0:
        raise EtabsError(f"{what} failed (ret={ret})")
    return res


def lst(v):
    return list(v) if v is not None else []


# ---------------------------------------------------------------- import

def get_stories(m):
    r = ok(m.Story.GetStories_2(0.0, 0, [], [], [], [], [], [], [], []), "Story.GetStories_2")
    base, n, names, elevs, heights, master, similar = r[0], r[1], lst(r[2]), lst(r[3]), lst(r[4]), lst(r[5]), lst(r[6])
    rows = sorted(zip(names, elevs, heights, master, similar), key=lambda t: t[1])
    return base, [{"name": a, "height": h, "isMaster": bool(ms), "similarTo": sim or ""} for a, e, h, ms, sim in rows]


def read_table(m, key):
    r = ok(m.DatabaseTables.GetTableForEditingArray(key, "", 0, [], 0, []), f"GetTableForEditingArray({key})")
    version, fields, nrec, data = r[0], lst(r[1]), r[2], lst(r[3])
    nf = len(fields)
    rows = [dict(zip(fields, data[i * nf:(i + 1) * nf])) for i in range(nrec)]
    return version, fields, rows


def _field(fields, *cands):
    low = {f.lower().replace(" ", ""): f for f in fields}
    for c in cands:
        if c in low:
            return low[c]
    for c in cands:
        for k, f in low.items():
            if c in k:
                return f
    return None


def get_grids(m, warnings):
    try:
        _, fields, rows = read_table(m, GRID_TABLE)
    except Exception as e:
        warnings.append(f"Grids not read: {e}")
        return []
    f_type = _field(fields, "linetype", "gridlinetype", "type")
    f_id = _field(fields, "id", "gridid", "label")
    f_ord = _field(fields, "ordinate", "coord")
    f_x1, f_y1, f_x2, f_y2 = (_field(fields, k) for k in ("x1", "y1", "x2", "y2"))
    f_bub = _field(fields, "bubbleloc", "bubble")
    xs, ys, gen = [], [], []
    for r in rows:
        t = str(r.get(f_type, "")).lower()
        bub = str(r.get(f_bub, "End")).lower() if f_bub else "end"
        bub = "both" if "both" in bub else ("start" if "start" in bub else "end")
        try:
            if t.startswith("x") and f_ord:
                xs.append((r[f_id], float(r[f_ord]), bub))
            elif t.startswith("y") and f_ord:
                ys.append((r[f_id], float(r[f_ord]), bub))
            elif f_x1 and r.get(f_x1) not in (None, ""):
                gen.append((r[f_id], float(r[f_x1]), float(r[f_y1]), float(r[f_x2]), float(r[f_y2]), bub))
        except (TypeError, ValueError):
            warnings.append(f"Skipped grid row {r}")
    allx = [v for _, v, _ in xs] or [0.0]
    ally = [v for _, v, _ in ys] or [0.0]
    ext = 1500.0
    out = []
    for lab, x, b in xs:
        out.append({"label": lab, "dir": "X", "x1": x, "y1": min(ally) - ext, "x2": x, "y2": max(ally) + ext, "bubble": b})
    for lab, y, b in ys:
        out.append({"label": lab, "dir": "Y", "x1": min(allx) - ext, "y1": y, "x2": max(allx) + ext, "y2": y, "bubble": b})
    for lab, x1, y1, x2, y2, b in gen:
        out.append({"label": lab, "dir": "G", "x1": x1, "y1": y1, "x2": x2, "y2": y2, "bubble": b})
    return out


def get_materials(m):
    r = ok(m.PropMaterial.GetNameList(0, []), "PropMaterial.GetNameList")
    out = []
    for n in lst(r[1]):
        try:
            g = m.PropMaterial.GetMaterial(n, 0, 0, "", "")
            out.append({"name": n, "type": MAT_TYPES.get(int(g[0]), str(g[0]))})
        except Exception:
            out.append({"name": n, "type": "?"})
    return out


def get_frame_sections(m, warnings):
    r = ok(m.PropFrame.GetNameList(0, []), "PropFrame.GetNameList")
    out = []
    for n in lst(r[1]):
        try:
            t = m.PropFrame.GetTypeOAPI(n, 0)[0]
            t = int(t)
            if t == 8:  # Rectangular
                g = ok(m.PropFrame.GetRectangle(n, "", "", 0.0, 0.0, 0, "", ""), "GetRectangle")
                out.append({"name": n, "shape": "Rectangle", "t3": g[2], "t2": g[3], "material": g[1], "fromEtabs": True})
            elif t == 9:  # Circle
                g = ok(m.PropFrame.GetCircle(n, "", "", 0.0, 0, "", ""), "GetCircle")
                out.append({"name": n, "shape": "Circle", "t3": g[2], "t2": g[2], "material": g[1], "fromEtabs": True})
            elif t == 1:  # I
                g = ok(m.PropFrame.GetISection(n, "", "", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, "", ""), "GetISection")
                out.append({"name": n, "shape": "Other", "t3": g[2], "t2": g[3], "material": g[1], "fromEtabs": True})
            else:
                mat = ""
                try:
                    mat = m.PropFrame.GetMaterial(n, "")[0]
                except Exception:
                    pass
                out.append({"name": n, "shape": "Other", "t3": 300.0, "t2": 300.0, "material": mat, "fromEtabs": True})
        except Exception as e:
            warnings.append(f"Frame section {n}: {e}")
    return out


def get_slab_sections(m, warnings):
    r = ok(m.PropArea.GetNameList(0, []), "PropArea.GetNameList")
    out = []
    for n in lst(r[1]):
        try:
            g = m.PropArea.GetSlab(n, 0, 0, "", 0.0, 0, "", "")
            if g[-1] == 0:
                out.append({"name": n, "thickness": g[3], "material": g[2], "fromEtabs": True})
        except Exception:
            pass  # walls / decks are not slabs
    return out


def do_import():
    m = sm()
    units = m.GetPresentUnits()
    warnings = []
    try:
        ok(m.SetPresentUnits(KN_MM_C), "SetPresentUnits")
        base, stories = get_stories(m)
        return {
            "baseElevation": base,
            "stories": stories,
            "grids": get_grids(m, warnings),
            "materials": get_materials(m),
            "frameSections": get_frame_sections(m, warnings),
            "slabSections": get_slab_sections(m, warnings),
            "patterns": get_patterns(m),
            **get_elements(m, warnings),
            "warnings": warnings,
        }
    finally:
        m.SetPresentUnits(units)


def get_elements(m, warnings):
    """
    Frame and area objects with their GUIDs, which become the app element ids (so pushes update them in
    place). An object without a GUID is given one in ETABS. Openings are left out. Frame and uniform area
    loads come along in the push form (kN-mm, relative distances), so a push with loads keeps them.
    """
    pats = {x["name"] for x in get_patterns(m)}
    cur_f = current_frame_loads(m, pats)
    cur_a = current_area_loads(m, pats)
    frames, areas = [], []
    for is_frame, out in ((True, frames), (False, areas)):
        obj = m.FrameObj if is_frame else m.AreaObj
        for name, g, geom in geom_index(m, is_frame):
            try:
                if not is_frame and m.AreaObj.GetOpening(name, False)[0]:
                    continue
                if not g:
                    if m.GetModelIsLocked():
                        m.SetModelIsLocked(False)
                    g = str(uuid.uuid4())
                    ok(obj.SetGUID(name, g), "SetGUID")
                if is_frame:
                    a, b = geom
                    out.append({"name": name, "guid": g, "section": m.FrameObj.GetSection(name, "", "")[0],
                                "angle": m.FrameObj.GetLocalAxes(name, 0.0, False)[0],
                                "pts": [{"x": a[0], "y": a[1], "z": a[2]}, {"x": b[0], "y": b[1], "z": b[2]}],
                                "loads": [{"pattern": l["pattern"], "kind": l["kind"], "type": l["type"], "dir": l["dir"], "rel": True,
                                           "d1": l["rd"][0], "d2": l["rd"][1], "v1": l["v1"], "v2": l["v2"]} for l in cur_f.get(name, [])]})
                else:
                    out.append({"name": name, "guid": g, "section": m.AreaObj.GetProperty(name, "")[0],
                                "pts": [{"x": p[0], "y": p[1], "z": p[2]} for p in geom],
                                "loads": [{"pattern": pt, "dir": d, "value": v} for pt, d, v in cur_a.get(name, [])]})
            except Exception as e:
                warnings.append(f"{'Frame' if is_frame else 'Area'} {name} not read: {e}")
    return {"frames": frames, "areas": areas}

# ---------------------------------------------------------------- loads
#
# Values arrive in kN-mm: frame loads with MyType 1 (force) / 2 (moment), ETABS Dir codes (1-3 local,
# 4-6 global X/Y/Z, 7-9 projected, 10 gravity, 11 projected gravity) and distances relative (0-1) or in mm;
# uniform area loads in kN/mm2 (ETABS 22 answers -100, not supported, to AreaObj.*LoadUniformToFrame);
# joint forces [F1, F2, F3, M1, M2, M3] in Global. Only loads in the app's patterns are read, compared and
# rewritten; loads in other patterns (e.g. ones defined only in ETABS) are left as they are.

PATTERN_TYPES = {1: "Dead", 2: "SuperDead", 3: "Live", 4: "ReduceLive", 5: "Quake", 6: "Wind", 7: "Snow", 8: "Other",
                 11: "Rooflive", 12: "Notional"}
GROUP = 1  # eItemType.Group: Name "All" reads the loads of every object in one call


def get_patterns(m):
    """Load patterns in ETABS as app patterns (types the app doesn't know come in as Other)."""
    if m.LoadPatterns.Count() == 0:
        return []
    out = []
    for n in lst(ok(m.LoadPatterns.GetNameList(0, []), "LoadPatterns.GetNameList")[1]):
        t = m.LoadPatterns.GetLoadType(n, 0)
        sw = m.LoadPatterns.GetSelfWTMultiplier(n, 0.0)
        out.append({"name": n, "type": PATTERN_TYPES.get(int(t[0]), "Other"), "selfWeight": float(sw[0])})
    return out


def push_patterns(m, pats, log):
    """Create the app's patterns (each with its linear static case) and bring type and self-weight up to date."""
    have = {x["name"]: x for x in get_patterns(m)}
    for pt in pats:
        cur = have.get(pt["name"])
        try:
            if cur is None:
                ok(m.LoadPatterns.Add(pt["name"], int(pt["type"]), float(pt["selfWeight"]), True), f"LoadPatterns.Add {pt['name']}")
                log.append(f"Created load pattern {pt['name']} (with its linear static load case)")
                continue
            if PATTERN_TYPES.get(int(pt["type"])) != cur["type"]:
                ok(m.LoadPatterns.SetLoadType(pt["name"], int(pt["type"])), "SetLoadType")
            if abs(cur["selfWeight"] - pt["selfWeight"]) > 1e-9:
                ok(m.LoadPatterns.SetSelfWTMultiplier(pt["name"], float(pt["selfWeight"])), "SetSelfWTMultiplier")
        except Exception as e:
            log.append(f"ERROR load pattern {pt['name']}: {e}")


def sig(v):
    """A load value rounded to 6 significant digits, so ETABS' stored floats compare equal to what was sent."""
    return float(f"{float(v):.6g}")


def csys_for(d):
    return "Local" if int(d) <= 3 else "Global"


def read_all(call, n_arrays):
    """Call a GetLoad* method for every object; returns its arrays (empty when there are no loads)."""
    try:
        r = call()
    except Exception:
        return [[] for _ in range(n_arrays)]
    if r[-1] != 0 or not r[0]:
        return [[] for _ in range(n_arrays)]
    return [lst(a) for a in r[1:1 + n_arrays]]


def frame_load_key(l):
    rel = bool(l["rel"])
    return (l["pattern"], l["kind"], int(l["type"]), int(l["dir"]), rel, sig(l["d1"]), sig(l["d2"]), sig(l["v1"]), sig(l["v2"]))


def current_frame_loads(m, managed):
    """{frame name: sorted keys} of distributed and point loads in the managed patterns."""
    out = {}
    names, pats, types, _cs, dirs, rd1, rd2, d1, d2, v1, v2 = read_all(
        lambda: m.FrameObj.GetLoadDistributed("All", 0, [], [], [], [], [], [], [], [], [], [], [], GROUP), 11)
    for i, n in enumerate(names):
        if pats[i] not in managed:
            continue
        # compare by whichever distance the app would send: relative when it spans 0-1, else both work
        out.setdefault(n, []).append({"pattern": pats[i], "kind": "dist", "type": types[i], "dir": dirs[i],
                                      "rd": (rd1[i], rd2[i]), "ad": (d1[i], d2[i]), "v1": v1[i], "v2": v2[i]})
    names, pats, types, _cs, dirs, rd, d, v = read_all(
        lambda: m.FrameObj.GetLoadPoint("All", 0, [], [], [], [], [], [], [], [], GROUP), 8)
    for i, n in enumerate(names):
        if pats[i] not in managed:
            continue
        out.setdefault(n, []).append({"pattern": pats[i], "kind": "point", "type": types[i], "dir": dirs[i],
                                      "rd": (rd[i], rd[i]), "ad": (d[i], d[i]), "v1": v[i], "v2": v[i]})
    return out


def frame_loads_match(cur, want):
    """ETABS reports both relative and absolute distances; match each wanted load in the form it was sent."""
    if len(cur) != len(want):
        return False
    left = list(cur)
    for w in want:
        k = frame_load_key(w)
        hit = None
        for c in left:
            dd = c["rd"] if w["rel"] else c["ad"]
            ck = (c["pattern"], c["kind"], int(c["type"]), int(c["dir"]), bool(w["rel"]), sig(dd[0]), sig(dd[1]), sig(c["v1"]), sig(c["v2"]))
            if ck == k:
                hit = c
                break
        if hit is None:
            return False
        left.remove(hit)
    return True


def area_load_key(l):
    return (l["pattern"], int(l["dir"]), sig(l["value"]))


def current_area_loads(m, managed):
    out = {}
    names, pats, _cs, dirs, vals = read_all(lambda: m.AreaObj.GetLoadUniform("All", 0, [], [], [], [], [], GROUP), 5)
    for i, n in enumerate(names):
        if pats[i] in managed:
            out.setdefault(n, []).append((pats[i], int(dirs[i]), sig(vals[i])))
    return out


def current_joint_loads(m, managed):
    """{point name: {pattern: [6 summed components]}} in the managed patterns."""
    out = {}
    names, pats, _step, _cs, f1, f2, f3, m1, m2, m3 = read_all(
        lambda: m.PointObj.GetLoadForce("All", 0, [], [], [], [], [], [], [], [], [], [], GROUP), 10)
    for i, n in enumerate(names):
        if pats[i] not in managed:
            continue
        acc = out.setdefault(n, {}).setdefault(pats[i], [0.0] * 6)
        for k, v in enumerate((f1[i], f2[i], f3[i], m1[i], m2[i], m3[i])):
            acc[k] += v
    return out


def point_finder(m):
    """Look up the ETABS point at (x, y, z) mm, within TOL."""
    r = m.PointObj.GetAllPoints(0, [], [], [], [], "Global")
    grid = {}
    if r[-1] == 0:
        for n, x, y, z in zip(lst(r[1]), lst(r[2]), lst(r[3]), lst(r[4])):
            grid.setdefault((round(x), round(y), round(z)), []).append((n, x, y, z))

    def find(x, y, z):
        kx, ky, kz = round(x), round(y), round(z)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for n, px, py, pz in grid.get((kx + dx, ky + dy, kz + dz), []):
                        if abs(px - x) <= TOL and abs(py - y) <= TOL and abs(pz - z) <= TOL:
                            return n
        return None
    return find


def wanted_joints(p, find, log=None):
    """{point name: {pattern: [6]}} from the payload, plus the names of joints to clear."""
    want = {}
    for j in p.get("jointLoads", []):
        n = find(j["x"], j["y"], j["z"])
        if n is None:
            if log is not None:
                log.append(f"WARNING joint load {j['pattern']} at ({j['x']:.0f}, {j['y']:.0f}, {j['z']:.0f}): no ETABS joint there")
            continue
        acc = want.setdefault(n, {}).setdefault(j["pattern"], [0.0] * 6)
        for k in range(6):
            acc[k] += j["f"][k]
    clear = set()
    for c in p.get("clearJoints", []):
        n = find(c["x"], c["y"], c["z"])
        if n is not None and n not in want:
            clear.add(n)
    return want, clear


def joints_match(cur, want):
    pats = set(cur) | set(want)
    return all([sig(v) for v in cur.get(pt, [0.0] * 6)] == [sig(v) for v in want.get(pt, [0.0] * 6)] for pt in pats)


def write_frame_loads(m, name, want, cur_pats):
    for pt in cur_pats | {l["pattern"] for l in want}:
        m.FrameObj.DeleteLoadDistributed(name, pt, 0)
        m.FrameObj.DeleteLoadPoint(name, pt, 0)
    for l in want:
        if l["kind"] == "dist":
            ok(m.FrameObj.SetLoadDistributed(name, l["pattern"], int(l["type"]), int(l["dir"]), float(l["d1"]), float(l["d2"]),
                                             float(l["v1"]), float(l["v2"]), csys_for(l["dir"]), bool(l["rel"]), False, 0), "SetLoadDistributed")
        else:
            ok(m.FrameObj.SetLoadPoint(name, l["pattern"], int(l["type"]), int(l["dir"]), float(l["d1"]), float(l["v1"]),
                                       csys_for(l["dir"]), bool(l["rel"]), False, 0), "SetLoadPoint")


def write_area_loads(m, name, want, cur_pats):
    for pt in cur_pats | {l["pattern"] for l in want}:
        m.AreaObj.DeleteLoadUniform(name, pt, 0)
    for l in want:
        ok(m.AreaObj.SetLoadUniform(name, l["pattern"], float(l["value"]), int(l["dir"]), False, csys_for(l["dir"]), 0), "SetLoadUniform")


def write_joint_loads(m, name, want, cur):
    for pt in set(cur) | set(want):
        m.PointObj.DeleteLoadForce(name, pt, 0)
    for pt, f in want.items():
        if any(abs(v) > 0 for v in f):
            ok(m.PointObj.SetLoadForce(name, pt, [float(v) for v in f], False, "Global", 0), "SetLoadForce")


def push_loads(m, p, frame_names, area_names, log):
    """
    Write the app's loads onto the objects it owns (`frame_names` / `area_names`: payload guid -> ETABS name) and
    its joints. An object whose loads in the app's patterns already match is left alone.
    """
    managed = set(p.get("loadPatterns", []))
    res = {"frames": 0, "areas": 0, "joints": 0, "unchanged": 0}
    cur_f = current_frame_loads(m, managed)
    for f in p["frames"]:
        name = frame_names.get(f["guid"])
        if not name:
            continue
        cur = cur_f.get(name, [])
        if frame_loads_match(cur, f.get("loads", [])):
            res["unchanged"] += bool(cur)
            continue
        try:
            write_frame_loads(m, name, f.get("loads", []), {c["pattern"] for c in cur})
            res["frames"] += 1
        except Exception as e:
            log.append(f"ERROR loads on {f['kind']} {name}: {e}")
    cur_a = current_area_loads(m, managed)
    for a in p["areas"]:
        name = area_names.get(a["guid"])
        if not name:
            continue
        cur = cur_a.get(name, [])
        want = a.get("loads", [])
        if sorted(cur) == sorted(area_load_key(l) for l in want):
            res["unchanged"] += bool(cur)
            continue
        try:
            write_area_loads(m, name, want, {c[0] for c in cur})
            res["areas"] += 1
        except Exception as e:
            log.append(f"ERROR loads on slab {name}: {e}")
    cur_j = current_joint_loads(m, managed)
    want, clear = wanted_joints(p, point_finder(m), log)
    for name in set(want) | clear:
        cur = cur_j.get(name, {})
        w = want.get(name, {})
        if joints_match(cur, w):
            res["unchanged"] += bool(cur)
            continue
        try:
            write_joint_loads(m, name, w, cur)
            res["joints"] += 1
        except Exception as e:
            log.append(f"ERROR joint load at point {name}: {e}")
    return res


def verify_loads(m, p, fmap, amap, log):
    """Count app objects whose loads in the app's patterns differ from ETABS (and log the first few)."""
    managed = set(p.get("loadPatterns", []))
    diff = 0
    cur_f = current_frame_loads(m, managed)
    for f in p["frames"]:
        n = fmap.get(f["guid"])
        if n and not frame_loads_match(cur_f.get(n, []), f.get("loads", [])):
            diff += 1
            log.append(f"Loads differ on {f['kind']} {n}")
    cur_a = current_area_loads(m, managed)
    for a in p["areas"]:
        n = amap.get(a["guid"])
        if n and sorted(cur_a.get(n, [])) != sorted(area_load_key(l) for l in a.get("loads", [])):
            diff += 1
            log.append(f"Loads differ on slab {n}")
    cur_j = current_joint_loads(m, managed)
    want, clear = wanted_joints(p, point_finder(m), log)
    for n in set(want) | clear:
        if not joints_match(cur_j.get(n, {}), want.get(n, {})):
            diff += 1
            log.append(f"Joint loads differ at point {n}")
    have = {x["name"] for x in get_patterns(m)}
    missing = [pt["name"] for pt in p.get("patterns", []) if pt["name"] not in have]
    if missing:
        log.append(f"Load patterns missing in ETABS: {', '.join(missing)}")
    return diff + len(missing)



# ---------------------------------------------------------------- push

def ensure_material(m, name, log):
    names = lst(m.PropMaterial.GetNameList(0, [])[1])
    if name in names:
        return
    ok(m.PropMaterial.SetMaterial(name, 2), f"SetMaterial {name}")
    log.append(f"Created concrete material {name} (default properties - review in ETABS)")


def frame_section_matches(m, s):
    """True when ETABS already has this section with the same shape, size and material."""
    try:
        t = int(m.PropFrame.GetTypeOAPI(s["name"], 0)[0])
        if s["shape"] == "Circle":
            g = m.PropFrame.GetCircle(s["name"], "", "", 0.0, 0, "", "")
            return t == 9 and g[-1] == 0 and g[1] == s["material"] and abs(g[2] - s["t3"]) <= TOL
        g = m.PropFrame.GetRectangle(s["name"], "", "", 0.0, 0.0, 0, "", "")
        return t == 8 and g[-1] == 0 and g[1] == s["material"] and abs(g[2] - s["t3"]) <= TOL and abs(g[3] - s["t2"]) <= TOL
    except Exception:
        return False


def slab_section_matches(m, s):
    """True when ETABS already has this slab section with the same thickness and material."""
    try:
        g = m.PropArea.GetSlab(s["name"], 0, 0, "", 0.0, 0, "", "")
        return g[-1] == 0 and g[2] == s["material"] and abs(g[3] - s["thickness"]) <= TOL
    except Exception:
        return False


def push_sections(m, p, log):
    """Create the app's sections, or rewrite them when they differ; ones that match are left alone so ETABS-side edits stay."""
    existing_f = set(lst(m.PropFrame.GetNameList(0, [])[1]))
    for s in p["frameSections"]:
        if s["name"] in existing_f and frame_section_matches(m, s):
            continue
        ensure_material(m, s["material"], log)
        if s["shape"] == "Circle":
            ok(m.PropFrame.SetCircle(s["name"], s["material"], s["t3"], -1, "", ""), f"SetCircle {s['name']}")
        else:
            ok(m.PropFrame.SetRectangle(s["name"], s["material"], s["t3"], s["t2"], -1, "", ""), f"SetRectangle {s['name']}")
        log.append(("Updated" if s["name"] in existing_f else "Created") + f" frame section {s['name']}")
    existing_a = set(lst(m.PropArea.GetNameList(0, [])[1]))
    for s in p["slabSections"]:
        if s["name"] in existing_a and slab_section_matches(m, s):
            continue
        ensure_material(m, s["material"], log)
        # eSlabType.Slab = 0, eShellType.ShellThin = 1
        ok(m.PropArea.SetSlab(s["name"], 0, 1, s["material"], s["thickness"], -1, "", ""), f"SetSlab {s['name']}")
        log.append(("Updated" if s["name"] in existing_a else "Created") + f" slab section {s['name']}")


def update_existing_stories(m, p, log):
    """SetStories_2 only works on a model with no objects, and the API cannot add, remove or rename stories
    after that (the Story Definitions table is not editable either). Stories can still be changed one by one
    when ETABS already has the same story names in the same order."""
    base, cur = get_stories(m)
    want = [s["name"] for s in p["stories"]]
    have = [s["name"] for s in cur]
    if want != have:
        log.append(f"WARNING stories not updated: ETABS cannot add, remove or rename stories once the model has objects. "
                   f"ETABS has {', '.join(have)} (base {base:g}); the app has {', '.join(want)} (base {p['baseElevation']:g}). "
                   f"Make the stories match in ETABS (Edit > Edit Stories and Grid Systems), or push into an empty model.")
        return
    for s in p["stories"]:
        ok(m.Story.SetHeight(s["name"], float(s["height"])), f"Story.SetHeight {s['name']}")
        ok(m.Story.SetMasterStory(s["name"], bool(s["isMaster"])), f"Story.SetMasterStory {s['name']}")
    # SetSimilarTo only takes a master story name, so "None" cannot be set back through the API
    kept = []
    for s, c in zip(p["stories"], cur):
        if s["isMaster"]:
            continue
        if s["similarTo"]:
            ok(m.Story.SetSimilarTo(s["name"], s["similarTo"]), f"Story.SetSimilarTo {s['name']}")
        elif c["similarTo"] and c["similarTo"] != "None":
            kept.append(f"{s['name']} ({c['similarTo']})")
    if kept:
        log.append(f"Similar-to left as in ETABS for {', '.join(kept)} - the API cannot set it to None; change it in ETABS if needed")
    log.append(f"Story heights updated ({len(want)})" +
               (f" - WARNING base elevation is {base:g} in ETABS, {p['baseElevation']:g} in the app; change it in ETABS"
                if abs(base - p["baseElevation"]) > 1e-6 else ""))


def push_stories(m, p, log):
    st = p["stories"]
    n = len(st)
    try:
        ok(m.Story.SetStories_2(p["baseElevation"], n, [s["name"] for s in st], [float(s["height"]) for s in st],
                                [bool(s["isMaster"]) for s in st], [s["similarTo"] or "None" for s in st],
                                [False] * n, [0.0] * n, [0] * n), "Story.SetStories_2")
        log.append(f"Stories set ({n})")
        return
    except Exception:
        pass  # the model already has objects
    try:
        update_existing_stories(m, p, log)
    except Exception as e:
        log.append(f"WARNING stories not updated: {e}. Edit them in ETABS to match the app if needed.")


def push_grids(m, grids, log):
    version, fields, rows = read_table(m, GRID_TABLE)
    if not fields:
        raise EtabsError("Grid table has no fields")
    f_sys = _field(fields, "name", "gridsystem", "system")
    f_type = _field(fields, "linetype", "gridlinetype", "type")
    f_id = _field(fields, "id", "gridid", "label")
    f_ord = _field(fields, "ordinate", "coord")
    f_x1, f_y1, f_x2, f_y2 = (_field(fields, k) for k in ("x1", "y1", "x2", "y2"))
    f_bub = _field(fields, "bubbleloc", "bubble")
    f_vis = _field(fields, "visible")
    sysname = rows[0].get(f_sys, "G1") if rows else "G1"
    xtype = next((r[f_type] for r in rows if str(r.get(f_type, "")).lower().startswith("x")), "X (Cartesian)")
    ytype = next((r[f_type] for r in rows if str(r.get(f_type, "")).lower().startswith("y")), "Y (Cartesian)")
    gtype = next((r[f_type] for r in rows if str(r.get(f_type, "")).lower().startswith("gen")), "General")
    data = []
    skipped = 0
    for g in grids:
        row = {f: "" for f in fields}
        row[f_sys] = sysname
        row[f_id] = g["label"]
        if f_bub:
            row[f_bub] = {"start": "Start", "end": "End", "both": "Both"}[g.get("bubble", "end")]
        if f_vis:
            row[f_vis] = "Yes"
        if g["dir"] == "X":
            row[f_type] = xtype
            row[f_ord] = str(g["x1"])
        elif g["dir"] == "Y":
            row[f_type] = ytype
            row[f_ord] = str(g["y1"])
        else:
            if not f_x1:
                skipped += 1
                continue
            row[f_type] = gtype
            row[f_x1], row[f_y1], row[f_x2], row[f_y2] = (str(g[k]) for k in ("x1", "y1", "x2", "y2"))
        data.extend(row[f] if row[f] is not None else "" for f in fields)
    # keep other grid systems' rows untouched
    for r in rows:
        if r.get(f_sys) != sysname:
            data.extend(r[f] if r[f] is not None else "" for f in fields)
    nrec = len(data) // len(fields)
    ok(m.DatabaseTables.SetTableForEditingArray(GRID_TABLE, version, fields, nrec, data), "SetTableForEditingArray")
    r = m.DatabaseTables.ApplyEditedTables(True, 0, 0, 0, 0, "")
    nfatal, nerr, logtxt = r[0], r[1], r[4]
    if nfatal or nerr:
        raise EtabsError(f"Grid import errors: {logtxt}")
    log.append(f"Grids set on system {sysname} ({len(grids) - skipped})" + (f", {skipped} general grids skipped" if skipped else ""))


def to_guid(g):
    """ETABS crashes (access violation) on SetGUID with a non-GUID string, so map any id to a valid GUID."""
    try:
        return str(uuid.UUID(str(g)))
    except ValueError:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, "emc:" + str(g)))


def normalize(p):
    """Copy of the payload with every element id converted to a GUID; keeps the original id as 'appId'."""
    q = dict(p)
    q["frames"] = [dict(f, appId=f["guid"], guid=to_guid(f["guid"])) for f in p.get("frames", [])]
    q["areas"] = [dict(a, appId=a["guid"], guid=to_guid(a["guid"])) for a in p.get("areas", [])]
    q["deleteGuids"] = [to_guid(g) for g in p.get("deleteGuids", [])]
    return q


def frame_geom(m, name):
    p = ok(m.FrameObj.GetPoints(name, "", ""), "GetPoints")
    a = ok(m.PointObj.GetCoordCartesian(p[0], 0.0, 0.0, 0.0, "Global"), "GetCoord")
    b = ok(m.PointObj.GetCoordCartesian(p[1], 0.0, 0.0, 0.0, "Global"), "GetCoord")
    return (a[0], a[1], a[2]), (b[0], b[1], b[2])


def area_geom(m, name):
    r = ok(m.AreaObj.GetPoints(name, 0, []), "AreaObj.GetPoints")
    out = []
    for pn in lst(r[1]):
        c = ok(m.PointObj.GetCoordCartesian(pn, 0.0, 0.0, 0.0, "Global"), "GetCoord")
        out.append((c[0], c[1], c[2]))
    return out


def close(a, b):
    return all(abs(x - y) <= TOL for x, y in zip(a, b))


def same_frame(g, f):
    a, b = g
    p, q = (f["x1"], f["y1"], f["z1"]), (f["x2"], f["y2"], f["z2"])
    return (close(a, p) and close(b, q)) or (close(a, q) and close(b, p))


def same_area(pts, a):
    want = [(p["x"], p["y"], p["z"]) for p in a["pts"]]
    if len(pts) != len(want):
        return False
    return all(any(close(p, w) for p in pts) for w in want)


def guid_map(obj, m):
    if obj.Count() == 0:  # GetNameList raises on an empty model
        return {}
    names = lst(ok(obj.GetNameList(0, []), "GetNameList")[1])
    out = {}
    for n in names:
        try:
            g = obj.GetGUID(n, "")
            if g[-1] == 0 and g[0]:
                out[to_guid(g[0])] = n
        except Exception:
            pass
    return out


class Refused(EtabsError):
    pass


def add_frame(m, f):
    r = m.FrameObj.AddByCoord(f["x1"], f["y1"], f["z1"], f["x2"], f["y2"], f["z2"], "", f["section"], "", "Global")
    if r[-1] != 0:
        raise Refused("ETABS refused the frame - an object probably already exists between these points")
    name = r[0]
    ok(m.FrameObj.SetGUID(name, f["guid"]), "FrameObj.SetGUID")
    if f["kind"] == "column" and abs(f["angle"]) > 1e-9:
        ok(m.FrameObj.SetLocalAxes(name, float(f["angle"]), 0), "SetLocalAxes")
    return name


def add_area(m, a):
    xs = [p["x"] for p in a["pts"]]
    ys = [p["y"] for p in a["pts"]]
    zs = [p["z"] for p in a["pts"]]
    r = m.AreaObj.AddByCoord(len(xs), xs, ys, zs, "", a["section"], "", "Global")
    if r[-1] != 0:
        raise Refused("ETABS refused the slab - an area probably already exists on these points")
    name = r[-2]
    ok(m.AreaObj.SetGUID(name, a["guid"]), "AreaObj.SetGUID")
    return name


def geom_index(m, is_frame):
    """[(name, GUID or '', geometry)] for every frame or area object in the model."""
    obj = m.FrameObj if is_frame else m.AreaObj
    if obj.Count() == 0:
        return []
    out = []
    for n in lst(ok(obj.GetNameList(0, []), "GetNameList")[1]):
        try:
            g = obj.GetGUID(n, "")[0] or ""
            g = to_guid(g) if g else ""  # GUIDs ETABS made may differ in case/braces from the form the app uses
            out.append((n, g, frame_geom(m, n) if is_frame else area_geom(m, n)))
        except Exception:
            pass
    return out


def take_over(m, el, is_frame, index, claimed, taken):
    """
    ETABS refused to add `el` because something already sits on its points. If that something is an
    object no element of the app owns (left behind by an undone push or an older project file), give
    it the element's GUID and section instead. Returns the object name, or raises with the reason.
    """
    obj = m.FrameObj if is_frame else m.AreaObj
    for name, g, geom in index:
        if name in taken:
            continue
        if not (same_frame(geom, el) if is_frame else same_area(geom, el)):
            continue
        if g in claimed:
            raise EtabsError("another element of the app is already at these points (a duplicate) - delete one of them")
        ok(obj.SetGUID(name, el["guid"]), "SetGUID")
        if is_frame:
            ok(m.FrameObj.SetSection(name, el["section"], 0, 0.0, 0.0), "SetSection")
            if el["kind"] == "column":
                ok(m.FrameObj.SetLocalAxes(name, float(el["angle"]), 0), "SetLocalAxes")
        else:
            ok(m.AreaObj.SetProperty(name, el["section"], 0), "SetProperty")
        taken.add(name)
        return name
    raise EtabsError("ETABS refused it and nothing found at the same points to take over - check ETABS for overlapping objects")


# U1 U2 U3 R1 R2 R3
SUPPORTS = {"fixed": [True] * 6, "pinned": [True, True, True, False, False, False]}


def set_supports(m, col_names, kind, base_z, log):
    """Restrain the bottom joint of each base column; returns how many joints were set."""
    value = SUPPORTS[kind]
    done = set()
    for name in col_names:
        try:
            i, j = ok(m.FrameObj.GetPoints(name, "", ""), "GetPoints")[:2]
            zi = ok(m.PointObj.GetCoordCartesian(i, 0.0, 0.0, 0.0, "Global"), "GetCoord")[2]
            zj = ok(m.PointObj.GetCoordCartesian(j, 0.0, 0.0, 0.0, "Global"), "GetCoord")[2]
            pt = i if abs(zi - base_z) <= abs(zj - base_z) else j
            if pt in done:
                continue
            ok(m.PointObj.SetRestraint(pt, list(value), 0), "SetRestraint")
            done.add(pt)
        except Exception as e:
            log.append(f"ERROR support at column {name}: {e}")
    log.append(f"Supports: {len(done)} base joints set to {kind}")
    return len(done)


def do_push(p):
    p = normalize(p)
    m = sm()
    if m.GetModelIsLocked():
        m.SetModelIsLocked(False)
    units = m.GetPresentUnits()
    log = []
    res = {"added": 0, "updated": 0, "unchanged": 0, "deleted": 0, "failed": 0}
    pushed = []
    try:
        ok(m.SetPresentUnits(KN_MM_C), "SetPresentUnits")
        trace("stories")
        if p.get("updateStories"):
            push_stories(m, p, log)
        trace("grids")
        if p.get("grids") is not None:
            try:
                push_grids(m, p["grids"], log)
            except Exception as e:
                log.append(f"WARNING grids not pushed: {e}")
        trace("sections")
        push_sections(m, p, log)
        if p.get("loads"):
            trace("load patterns")
            push_patterns(m, p.get("patterns", []), log)
        trace("guid maps")

        fmap = guid_map(m.FrameObj, m)
        amap = guid_map(m.AreaObj, m)

        for g in p.get("deleteGuids", []):
            try:
                if g in fmap:
                    ok(m.FrameObj.Delete(fmap.pop(g), 0), "FrameObj.Delete")
                    res["deleted"] += 1
                elif g in amap:
                    ok(m.AreaObj.Delete(amap.pop(g), 0), "AreaObj.Delete")
                    res["deleted"] += 1
            except Exception as e:
                res["failed"] += 1
                log.append(f"ERROR delete {g}: {e}")

        claimed = {f["guid"] for f in p["frames"]} | {a["guid"] for a in p["areas"]}
        base_cols = []  # names of columns that start at the base elevation (for supports)
        frame_names, area_names = {}, {}  # guid -> ETABS name of everything pushed, for the loads

        def frame_done(f, name):
            pushed.append(f["appId"])
            frame_names[f["guid"]] = name
            if f["kind"] == "column" and abs(min(f["z1"], f["z2"]) - p["baseElevation"]) <= TOL:
                base_cols.append(name)

        def frame_err(f, e):
            res["failed"] += 1
            log.append(f"ERROR {f['kind']} {f['story']} {f['section']} ({f['x1']:.0f},{f['y1']:.0f})-({f['x2']:.0f},{f['y2']:.0f}): {e}")

        trace("frames")
        refused = []  # (frame, result key) to retry once everything else is in place
        for f in p["frames"]:
            try:
                name = fmap.get(f["guid"])
                key = "added"
                if name:
                    if same_frame(frame_geom(m, name), f):
                        changed = False
                        sec = m.FrameObj.GetSection(name, "", "")[0]
                        if sec != f["section"]:
                            ok(m.FrameObj.SetSection(name, f["section"], 0, 0.0, 0.0), "SetSection")
                            changed = True
                        if f["kind"] == "column":
                            ang = m.FrameObj.GetLocalAxes(name, 0.0, False)[0]
                            if abs(ang - f["angle"]) > 1e-6:
                                ok(m.FrameObj.SetLocalAxes(name, float(f["angle"]), 0), "SetLocalAxes")
                                changed = True
                        res["updated" if changed else "unchanged"] += 1
                        frame_done(f, name)
                        continue
                    ok(m.FrameObj.Delete(name, 0), "FrameObj.Delete")
                    key = "updated"
                try:
                    name = add_frame(m, f)
                except Refused:
                    refused.append((f, key))
                    continue
                res[key] += 1
                frame_done(f, name)
            except Exception as e:
                frame_err(f, e)

        # an element refused in the first pass may have been blocked by another element that has since
        # moved away; what is still in the way and owned by nobody in the app is taken over
        taken_over = 0
        index = geom_index(m, True) if refused else []
        taken = set()
        for f, key in refused:
            try:
                try:
                    name = add_frame(m, f)
                except Refused:
                    name = take_over(m, f, True, index, claimed, taken)
                    taken_over += 1
                res[key] += 1
                frame_done(f, name)
            except Exception as e:
                frame_err(f, e)

        refused = []
        for a in p["areas"]:
            try:
                name = amap.get(a["guid"])
                key = "added"
                if name:
                    if same_area(area_geom(m, name), a):
                        prop = m.AreaObj.GetProperty(name, "")[0]
                        if prop != a["section"]:
                            ok(m.AreaObj.SetProperty(name, a["section"], 0), "SetProperty")
                            res["updated"] += 1
                        else:
                            res["unchanged"] += 1
                        pushed.append(a["appId"])
                        area_names[a["guid"]] = name
                        continue
                    ok(m.AreaObj.Delete(name, 0), "AreaObj.Delete")
                    key = "updated"
                try:
                    name = add_area(m, a)
                except Refused:
                    refused.append((a, key))
                    continue
                res[key] += 1
                pushed.append(a["appId"])
                area_names[a["guid"]] = name
            except Exception as e:
                res["failed"] += 1
                log.append(f"ERROR slab {a['story']} {a['section']}: {e}")

        index = geom_index(m, False) if refused else []
        taken = set()
        for a, key in refused:
            try:
                try:
                    name = add_area(m, a)
                except Refused:
                    name = take_over(m, a, False, index, claimed, taken)
                    taken_over += 1
                res[key] += 1
                pushed.append(a["appId"])
                area_names[a["guid"]] = name
            except Exception as e:
                res["failed"] += 1
                log.append(f"ERROR slab {a['story']} {a['section']}: {e}")

        if taken_over:
            log.insert(0, f"Took over {taken_over} objects ETABS already had at the same points but no app element owned "
                          "(left from an undone push or an older project file)")

        if p.get("supports", "none") in SUPPORTS:
            res["restrained"] = set_supports(m, base_cols, p["supports"], p["baseElevation"], log)

        if p.get("loads"):
            trace("loads")
            res["loads"] = push_loads(m, p, frame_names, area_names, log)

        try:
            m.View.RefreshView(0, False)
        except Exception:
            pass
    finally:
        m.SetPresentUnits(units)
    # keep guids that failed to delete so they are retried next time
    res["log"] = log
    res["pushedGuids"] = pushed
    return res


def do_verify(p):
    p = normalize(p)
    m = sm()
    units = m.GetPresentUnits()
    log = []
    try:
        m.SetPresentUnits(KN_MM_C)
        fmap = guid_map(m.FrameObj, m)
        amap = guid_map(m.AreaObj, m)
        missing = wrong = 0
        for f in p["frames"]:
            n = fmap.get(f["guid"])
            if not n:
                missing += 1
                continue
            if not same_frame(frame_geom(m, n), f) or m.FrameObj.GetSection(n, "", "")[0] != f["section"]:
                wrong += 1
                log.append(f"Mismatch {f['kind']} {n}")
        for a in p["areas"]:
            n = amap.get(a["guid"])
            if not n:
                missing += 1
                continue
            if not same_area(area_geom(m, n), a) or m.AreaObj.GetProperty(n, "")[0] != a["section"]:
                wrong += 1
                log.append(f"Mismatch slab {n}")
        loads = verify_loads(m, p, fmap, amap, log) if p.get("loads") else 0
        log.insert(0, f"Checked {len(p['frames'])} frames and {len(p['areas'])} slabs: {missing} missing, {wrong} different"
                      + (f", loads differ on {loads}" if p.get("loads") else "") + ".")
        return {"ok": missing == 0 and wrong == 0 and loads == 0, "log": log, "unowned": unowned(m, owned_guids(p))}
    finally:
        m.SetPresentUnits(units)


def owned_guids(p):
    return {f["guid"] for f in p["frames"]} | {a["guid"] for a in p["areas"]}


def story_of(obj, name):
    try:
        return obj.GetLabelFromName(name, "", "")[1]
    except Exception:
        return ""


def unowned(m, owned):
    """Frame and area objects in ETABS that no element of the app owns (in kN-mm units)."""
    out = []
    for name, g, (a, b) in geom_index(m, True):
        if g in owned:
            continue
        plan = abs(a[0] - b[0]) <= TOL and abs(a[1] - b[1]) <= TOL
        kind = "column" if plan else "beam" if abs(a[2] - b[2]) <= TOL else "brace"
        out.append({"name": name, "obj": "frame", "kind": kind, "story": story_of(m.FrameObj, name),
                    "section": m.FrameObj.GetSection(name, "", "")[0],
                    "pts": [{"x": a[0], "y": a[1], "z": a[2]}, {"x": b[0], "y": b[1], "z": b[2]}]})
    for name, g, pts in geom_index(m, False):
        if g in owned:
            continue
        flat = max(p[2] for p in pts) - min(p[2] for p in pts) <= TOL
        out.append({"name": name, "obj": "area", "kind": "slab" if flat else "wall", "story": story_of(m.AreaObj, name),
                    "section": m.AreaObj.GetProperty(name, "")[0],
                    "pts": [{"x": p[0], "y": p[1], "z": p[2]} for p in pts]})
    return out


def do_delete(p):
    """Delete the named frame/area objects, skipping any that an app element owns by now."""
    m = sm()
    if m.GetModelIsLocked():
        m.SetModelIsLocked(False)
    keep = {to_guid(g) for g in p.get("keepGuids", [])}
    log = []
    deleted = 0
    for key, obj in (("frames", m.FrameObj), ("areas", m.AreaObj)):
        for name in p.get(key, []):
            try:
                if to_guid(obj.GetGUID(name, "")[0]) in keep:
                    log.append(f"Skipped {name}: an app element owns it")
                    continue
                ok(obj.Delete(name, 0), "Delete")
                deleted += 1
            except Exception as e:
                log.append(f"ERROR delete {name}: {e}")
    try:
        m.View.RefreshView(0, False)
    except Exception:
        pass
    return {"deleted": deleted, "log": log}


def do_status():
    try:
        m = sm()
        return {"ok": True, "attached": True, "model": m.GetModelFilename(True), "units": m.GetPresentUnits(),
                "version": str(_etabs.SapModel.GetVersion("", 0.0)[0]) if hasattr(m, "GetVersion") else ""}
    except Exception as e:
        return {"ok": True, "attached": False, "message": str(e)}


# ---------------------------------------------------------------- http

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _run(self, fn, *a):
        try:
            self._send(200, fn(*a))
        except EtabsError as e:
            self._send(500, {"error": str(e)})
        except Exception as e:  # noqa
            traceback.print_exc()
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        if u.path == "/status":
            self._run(do_status)
        elif u.path == "/import":
            self._run(do_import)
        elif u.path == "/table":
            key = parse_qs(u.query).get("key", [GRID_TABLE])[0]
            self._run(lambda: dict(zip(("version", "fields", "rows"), read_table(sm(), key))))
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        u = urlparse(self.path)
        if u.path == "/attach":
            self._run(lambda: (attach(), do_status())[1])
        elif u.path == "/push":
            self._run(do_push, body)
        elif u.path == "/delete":
            self._run(do_delete, body)
        elif u.path == "/verify":
            self._run(do_verify, body)
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        sys.stderr.write("[bridge] " + fmt % args + "\n")


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--tlb", default=None, help="path to ETABSv1.tlb")
    ARGS = ap.parse_args()
    ARGS.tlb_path = find_tlb(ARGS.tlb)
    print(f"ETABS bridge on http://127.0.0.1:{ARGS.port}  (type library: {ARGS.tlb_path})")
    try:
        attach()
        print("Attached to ETABS:", _sm.GetModelFilename(True))
    except Exception as e:
        print("Not attached yet:", e)
    # HTTPServer sets SO_REUSEADDR, which on Windows lets a second bridge bind the port while an older one
    # still answers on it; without it, starting a bridge next to a running one fails here instead
    HTTPServer.allow_reuse_address = False
    try:
        server = HTTPServer(("127.0.0.1", ARGS.port), Handler)
    except OSError as e:
        sys.exit(f"Port {ARGS.port} is in use ({e}). Another bridge is probably running: close it, or pass --port.")
    server.serve_forever()


ARGS = argparse.Namespace(tlb_path=find_tlb())

if __name__ == "__main__":
    main()
