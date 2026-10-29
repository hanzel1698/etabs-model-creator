"""
Bridge self-test: starts a NEW ETABS 22 instance on a blank model (does not touch your open models),
pushes a small 2-story frame, re-pushes with edits, verifies, and closes ETABS.

    python selftest.py            # add --keep to leave ETABS open afterwards
"""
import sys
import uuid

import comtypes.client

import bridge as B

KEEP = "--keep" in sys.argv


def payload(beam_section="B300x500", move_beam=False, drop=None):
    g = lambda: str(uuid.uuid4())  # noqa: E731
    stories = [{"name": "Story1", "height": 3000, "isMaster": True, "similarTo": ""},
               {"name": "Story2", "height": 3000, "isMaster": False, "similarTo": "Story1"}]
    frames, areas = [], []
    for si, st in enumerate(stories):
        z0, z1 = si * 3000, (si + 1) * 3000
        for (x, y) in [(0, 0), (6000, 0), (6000, 5000), (0, 5000)]:
            frames.append({"guid": f"col-{st['name']}-{x}-{y}", "kind": "column", "x1": x, "y1": y, "z1": z0, "x2": x, "y2": y, "z2": z1,
                           "section": "C400x400", "angle": 30 if (x, y) == (0, 0) else 0, "story": st["name"]})
        pts = [(0, 0), (6000, 0), (6000, 5000), (0, 5000)]
        for i in range(4):
            a, b = pts[i], pts[(i + 1) % 4]
            if move_beam and i == 0 and si == 0:
                a, b = (0, 500), (6000, 500)
            frames.append({"guid": f"beam-{st['name']}-{i}", "kind": "beam", "x1": a[0], "y1": a[1], "z1": z1, "x2": b[0], "y2": b[1], "z2": z1,
                           "section": beam_section, "angle": 0, "story": st["name"]})
        areas.append({"guid": f"slab-{st['name']}", "pts": [{"x": x, "y": y, "z": z1} for x, y in pts], "section": "S150", "story": st["name"]})
    if drop:
        frames = [f for f in frames if f["guid"] != drop]
    grids = [{"label": "A", "dir": "X", "x1": 0, "y1": -1500, "x2": 0, "y2": 6500, "bubble": "end"},
             {"label": "B", "dir": "X", "x1": 6000, "y1": -1500, "x2": 6000, "y2": 6500, "bubble": "end"},
             {"label": "1", "dir": "Y", "x1": -1500, "y1": 0, "x2": 7500, "y2": 0, "bubble": "start"},
             {"label": "2", "dir": "Y", "x1": -1500, "y1": 5000, "x2": 7500, "y2": 5000, "bubble": "start"}]
    return {"baseElevation": 0, "stories": stories, "updateStories": True, "grids": grids,
            "frameSections": [{"name": "C400x400", "shape": "Rectangle", "t3": 400, "t2": 400, "material": "4000Psi", "fromEtabs": False},
                              {"name": "B300x500", "shape": "Rectangle", "t3": 500, "t2": 300, "material": "4000Psi", "fromEtabs": False},
                              {"name": "B300x600", "shape": "Rectangle", "t3": 600, "t2": 300, "material": "4000Psi", "fromEtabs": False}],
            "slabSections": [{"name": "S150", "thickness": 150, "material": "4000Psi", "fromEtabs": False}],
            "frames": frames, "areas": areas, "deleteGuids": [], "supports": "fixed"}


def with_loads(p, beam_udl=10.0, joint=True):
    """`p` plus load patterns and loads in the kN-mm form the web app sends (see web/src/etabs/mapping.ts)."""
    q = dict(p, loads=True, loadPatterns=["Dead", "SDL", "Live"],
             patterns=[{"name": "Dead", "type": 1, "selfWeight": 1}, {"name": "SDL", "type": 2, "selfWeight": 0}, {"name": "Live", "type": 3, "selfWeight": 0}])
    udl = {"pattern": "SDL", "kind": "dist", "type": 1, "dir": 10, "rel": True, "d1": 0, "d2": 1, "v1": beam_udl / 1000, "v2": beam_udl / 1000}
    pt = {"pattern": "Live", "kind": "point", "type": 1, "dir": 10, "rel": False, "d1": 2000, "d2": 2000, "v1": 20, "v2": 20}
    loads = {"beam-Story1-1": [udl], "beam-Story2-1": [udl, pt]}
    q["frames"] = [dict(f, loads=loads.get(f["guid"], [])) for f in p["frames"]]
    q["areas"] = [dict(a, loads=[{"pattern": "SDL", "dir": 10, "value": 1.5e-6 if a["story"] == "Story1" else 2.0e-6}]) for a in p["areas"]]
    jl = {"x": 0, "y": 0, "z": 6000, "pattern": "Dead", "f": [0, 0, -50, 0, 0, 0]}
    q["jointLoads"] = [jl] if joint else []
    q["clearJoints"] = [] if joint else [{"x": 0, "y": 0, "z": 6000}]
    return q


def base_restraints(m):
    """Distinct restraint tuples of all joints at z = 0."""
    names = B.lst(m.PointObj.GetNameList(0, [])[1])
    out = set()
    for n in names:
        if abs(m.PointObj.GetCoordCartesian(n, 0.0, 0.0, 0.0, "Global")[2]) < 1:
            out.add(tuple(bool(v) for v in m.PointObj.GetRestraint(n, [])[0]))
    return out


def main():
    B.load_typelib(B.find_tlb())
    helper = comtypes.client.CreateObject("ETABSv1.Helper").QueryInterface(B.E.cHelper)
    if "--attach" in sys.argv:  # reuse a running (scratch) instance
        etabs = helper.GetObject("CSI.ETABS.API.ETABSObject")
    else:
        etabs = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")
        etabs.ApplicationStart()
    m = etabs.SapModel
    print("started", flush=True)
    B.ok(m.InitializeNewModel(B.KN_MM_C), "InitializeNewModel")
    B.ok(m.File.NewBlank(), "NewBlank")
    B._etabs, B._sm = etabs, m
    try:
        print("status:", B.do_status(), flush=True)
        p = payload()
        r = B.do_push(p)
        print("push 1:", {k: v for k, v in r.items() if k not in ("log", "pushedGuids")})
        print("\n".join(r["log"]))
        assert r["failed"] == 0 and r["added"] == 18, r
        assert r["restrained"] == 4, r
        print("restraints after push 1:", base_restraints(m))
        assert base_restraints(m) == {(True,) * 6}, "base joints should be fixed"

        imp = B.do_import()
        print("import:", len(imp["stories"]), "stories", [s["name"] for s in imp["stories"]], len(imp["grids"]), "grids",
              [s["name"] for s in imp["frameSections"]], [s["name"] for s in imp["slabSections"]], imp["warnings"])
        fr = {f["guid"]: f for f in imp["frames"]}
        print("import elements:", len(imp["frames"]), "frames,", len(imp["areas"]), "areas")
        assert len(imp["frames"]) == 16 and len(imp["areas"]) == 2, imp["warnings"]
        assert {B.to_guid(f["guid"]) for f in p["frames"]} == set(fr), "imported frames should carry the pushed GUIDs"
        assert abs(fr[B.to_guid("col-Story1-0-0")]["angle"] - 30) < 1e-6, fr[B.to_guid("col-Story1-0-0")]

        # an object drawn in ETABS comes in with a GUID that a push finds it by
        B.ok(m.SetPresentUnits(B.KN_MM_C), "SetPresentUnits")
        drawn = m.FrameObj.AddByCoord(0, 0, 3000, 6000, 5000, 3000, "", "B300x500", "", "Global")[0]
        new = [f for f in B.do_import()["frames"] if f["name"] == drawn]
        print("drawn in ETABS:", new)
        assert len(new) == 1 and new[0]["guid"] in B.guid_map(m.FrameObj, m), new
        B.ok(m.FrameObj.Delete(drawn, 0), "FrameObj.Delete")

        print("verify 1:", B.do_verify(p)["log"][0])

        # re-push: same model -> all unchanged
        r = B.do_push(p)
        print("push 2 (same):", {k: v for k, v in r.items() if k not in ("log", "pushedGuids")})
        assert r["unchanged"] == 18 and r["added"] == 0, r

        # edit: beam section change + one beam moved + one column removed
        p2 = payload("B300x600", move_beam=True, drop="col-Story2-6000-5000")
        p2["deleteGuids"] = ["col-Story2-6000-5000"]
        p2["supports"] = "pinned"
        r = B.do_push(p2)
        print("push 3 (edits):", {k: v for k, v in r.items() if k not in ("log", "pushedGuids")})
        print("restraints after push 3:", base_restraints(m))
        assert base_restraints(m) == {(True, True, True, False, False, False)}, "base joints should be pinned"
        v = B.do_verify(p2)
        print("verify 3:", v["log"][0])
        assert v["ok"], v
        n = m.FrameObj.Count(), m.AreaObj.Count()
        print("ETABS counts (frames, areas):", n)
        assert n == (15, 2), n

        # loads: patterns, a 10 kN/m beam load, a point load, slab loads and a joint load
        p4 = with_loads(p2)
        r = B.do_push(p4)
        print("push 4 (loads):", r["loads"], [x for x in r["log"] if "ERROR" in x or "WARNING" in x or "pattern" in x])
        assert r["loads"]["frames"] == 2 and r["loads"]["areas"] == 2 and r["loads"]["joints"] == 1, r["loads"]
        names = {x["name"]: x for x in B.get_patterns(m)}
        assert names["SDL"]["type"] == "SuperDead" and names["Dead"]["selfWeight"] == 1, names
        B.ok(m.SetPresentUnits(B.KN_MM_C), "SetPresentUnits")
        beam = B.guid_map(m.FrameObj, m)[B.to_guid("beam-Story1-1")]
        d = m.FrameObj.GetLoadDistributed(beam, 0, [], [], [], [], [], [], [], [], [], [], [], 0)
        print("beam-Story1-1 distributed:", B.lst(d[2]), B.lst(d[11]))
        assert abs(B.lst(d[11])[0] - 0.01) < 1e-9, "10 kN/m should read back as 0.01 kN/mm"
        v = B.do_verify(p4)
        print("verify 4:", v["log"][0])
        assert v["ok"], v
        loaded = {f["guid"]: f["loads"] for f in B.do_import()["frames"]}[B.to_guid("beam-Story1-1")]
        print("imported loads on beam-Story1-1:", loaded)
        assert len(loaded) == 1 and loaded[0]["rel"] and abs(loaded[0]["v1"] - 0.01) < 1e-9 and loaded[0]["dir"] == 10, loaded
        # pushing the loads as imported changes nothing
        same = dict(p4, frames=[dict(f, loads=loaded if f["guid"] == "beam-Story1-1" else f["loads"]) for f in p4["frames"]])
        assert B.do_verify(same)["ok"], "imported loads should match ETABS"
        r = B.do_push(p4)
        print("push 5 (same loads):", r["loads"])
        assert r["loads"]["frames"] == r["loads"]["areas"] == r["loads"]["joints"] == 0, r["loads"]

        # change one beam load, remove the joint load (cleared by position)
        p6 = with_loads(p2, beam_udl=12.5, joint=False)
        r = B.do_push(p6)
        print("push 6 (load edits):", r["loads"])
        assert r["loads"]["frames"] == 2 and r["loads"]["areas"] == 0 and r["loads"]["joints"] == 1, r["loads"]  # both beams carry the edited UDL
        assert B.current_joint_loads(m, {"Dead"}) == {}, "joint load should be cleared"
        v = B.do_verify(p6)
        print("verify 6:", v["log"][0])
        assert v["ok"], v
        print("SELFTEST OK")
    finally:
        if not KEEP:
            etabs.ApplicationExit(False)


if __name__ == "__main__":
    main()
