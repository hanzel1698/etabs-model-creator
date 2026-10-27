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
            "warnings": warnings,
        }
    finally:
        m.SetPresentUnits(units)


# ---------------------------------------------------------------- push

def ensure_material(m, name, log):
    names = lst(m.PropMaterial.GetNameList(0, [])[1])
    if name in names:
        return
    ok(m.PropMaterial.SetMaterial(name, 2), f"SetMaterial {name}")
    log.append(f"Created concrete material {name} (default properties - review in ETABS)")


def push_sections(m, p, log):
    existing_f = set(lst(m.PropFrame.GetNameList(0, [])[1]))
    for s in p["frameSections"]:
        ensure_material(m, s["material"], log)
        if s["shape"] == "Circle":
            ok(m.PropFrame.SetCircle(s["name"], s["material"], s["t3"], -1, "", ""), f"SetCircle {s['name']}")
        else:
            ok(m.PropFrame.SetRectangle(s["name"], s["material"], s["t3"], s["t2"], -1, "", ""), f"SetRectangle {s['name']}")
        log.append(("Updated" if s["name"] in existing_f else "Created") + f" frame section {s['name']}")
    existing_a = set(lst(m.PropArea.GetNameList(0, [])[1]))
    for s in p["slabSections"]:
        ensure_material(m, s["material"], log)
        # eSlabType.Slab = 0, eShellType.ShellThin = 1
        ok(m.PropArea.SetSlab(s["name"], 0, 1, s["material"], s["thickness"], -1, "", ""), f"SetSlab {s['name']}")
        log.append(("Updated" if s["name"] in existing_a else "Created") + f" slab section {s['name']}")


def push_stories(m, p, log):
    st = p["stories"]
    n = len(st)
    try:
        ok(m.Story.SetStories_2(p["baseElevation"], n, [s["name"] for s in st], [float(s["height"]) for s in st],
                                [bool(s["isMaster"]) for s in st], [s["similarTo"] or "None" for s in st],
                                [False] * n, [0.0] * n, [0] * n), "Story.SetStories_2")
        log.append(f"Stories set ({n})")
    except Exception as e:
        log.append(f"WARNING stories not updated: {e}. ETABS only allows replacing stories in some cases - "
                   f"edit them in ETABS to match the app if needed.")


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
                out[g[0]] = n
        except Exception:
            pass
    return out


def add_frame(m, f):
    r = m.FrameObj.AddByCoord(f["x1"], f["y1"], f["z1"], f["x2"], f["y2"], f["z2"], "", f["section"], "", "Global")
    if r[-1] != 0:
        raise EtabsError("ETABS refused the frame - an object probably already exists between these points")
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
        raise EtabsError("ETABS refused the slab - an area probably already exists on these points")
    name = r[-2]
    ok(m.AreaObj.SetGUID(name, a["guid"]), "AreaObj.SetGUID")
    return name


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

        trace("frames")
        for f in p["frames"]:
            try:
                name = fmap.get(f["guid"])
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
                    else:
                        ok(m.FrameObj.Delete(name, 0), "FrameObj.Delete")
                        add_frame(m, f)
                        res["updated"] += 1
                else:
                    add_frame(m, f)
                    res["added"] += 1
                pushed.append(f["appId"])
            except Exception as e:
                res["failed"] += 1
                log.append(f"ERROR {f['kind']} {f['story']} {f['section']} ({f['x1']:.0f},{f['y1']:.0f})-({f['x2']:.0f},{f['y2']:.0f}): {e}")

        for a in p["areas"]:
            try:
                name = amap.get(a["guid"])
                if name:
                    if same_area(area_geom(m, name), a):
                        prop = m.AreaObj.GetProperty(name, "")[0]
                        if prop != a["section"]:
                            ok(m.AreaObj.SetProperty(name, a["section"], 0), "SetProperty")
                            res["updated"] += 1
                        else:
                            res["unchanged"] += 1
                    else:
                        ok(m.AreaObj.Delete(name, 0), "AreaObj.Delete")
                        add_area(m, a)
                        res["updated"] += 1
                else:
                    add_area(m, a)
                    res["added"] += 1
                pushed.append(a["appId"])
            except Exception as e:
                res["failed"] += 1
                log.append(f"ERROR slab {a['story']} {a['section']}: {e}")

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
        log.insert(0, f"Checked {len(p['frames'])} frames and {len(p['areas'])} slabs: {missing} missing, {wrong} different.")
        return {"ok": missing == 0 and wrong == 0, "log": log}
    finally:
        m.SetPresentUnits(units)


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
    HTTPServer(("127.0.0.1", ARGS.port), Handler).serve_forever()


ARGS = argparse.Namespace(tlb_path=find_tlb())

if __name__ == "__main__":
    main()
