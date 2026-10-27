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
            "frames": frames, "areas": areas, "deleteGuids": []}


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

        imp = B.do_import()
        print("import:", len(imp["stories"]), "stories", [s["name"] for s in imp["stories"]], len(imp["grids"]), "grids",
              [s["name"] for s in imp["frameSections"]], [s["name"] for s in imp["slabSections"]], imp["warnings"])

        print("verify 1:", B.do_verify(p)["log"][0])

        # re-push: same model -> all unchanged
        r = B.do_push(p)
        print("push 2 (same):", {k: v for k, v in r.items() if k not in ("log", "pushedGuids")})
        assert r["unchanged"] == 18 and r["added"] == 0, r

        # edit: beam section change + one beam moved + one column removed
        p2 = payload("B300x600", move_beam=True, drop="col-Story2-6000-5000")
        p2["deleteGuids"] = ["col-Story2-6000-5000"]
        r = B.do_push(p2)
        print("push 3 (edits):", {k: v for k, v in r.items() if k not in ("log", "pushedGuids")})
        v = B.do_verify(p2)
        print("verify 3:", v["log"][0])
        assert v["ok"], v
        n = m.FrameObj.Count(), m.AreaObj.Count()
        print("ETABS counts (frames, areas):", n)
        assert n == (15, 2), n
        print("SELFTEST OK")
    finally:
        if not KEEP:
            etabs.ApplicationExit(False)


if __name__ == "__main__":
    main()
