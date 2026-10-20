"""Generate architecture.dot with every box and arrow on a fixed grid.

Graphviz renders it with fixed positions (neato -n2), so lines are straight, corners are square
and boxes in a column share one centre line. Coordinates are in points, y pointing up.

    python architecture.py && neato -n2 -Tsvg architecture.dot -o assets/architecture.svg
"""

from pathlib import Path

ARROW = 7  # arrowhead length at arrowsize 0.7
INK, LINE, GREY, GREEN, LABEL = "#33405c", "#55607a", "#8a93a6", "#1f7a4d", "#1f3a7a"

# Columns: return line, main column, right column.
XL, XS, XR = 50, 300, 640
FONT = "Cambria"

nodes = {}  # name -> (x, y, w, h)
out = []


def sub(text):
    return f'<br/><font point-size="9" color="#5b6270">{text}</font>'


def node(name, x, y, w, h, label, **attrs):
    nodes[name] = (x, y, w, h)
    a = {"pos": f"{x},{y}!", "width": w / 72, "height": h / 72, "fixedsize": "true", **attrs}
    body = ", ".join(f'{k}="{v}"' for k, v in a.items())
    out.append(f"  {name} [label=<{label}>, {body}];")


def edge(points, label=None, lp=None, style="solid", color=LINE, fontcolor=LABEL, both=False, align="l"):
    """Straight segments through `points`; the arrow ends exactly on the last point."""
    (x1, y1), (x2, y2) = points[-2], points[-1]
    dx, dy = (x2 > x1) - (x2 < x1), (y2 > y1) - (y2 < y1)
    tip = points[-1]
    pts = points[:-1] + [(x2 - dx * ARROW, y2 - dy * ARROW)]
    start = None
    if both:
        (a1, b1), (a2, b2) = pts[0], pts[1]
        sx, sy = (a2 > a1) - (a2 < a1), (b2 > b1) - (b2 < b1)
        start = pts[0]
        pts[0] = (a1 + sx * ARROW, b1 + sy * ARROW)
    spline = [pts[0]]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        spline += [(ax + (bx - ax) / 3, ay + (by - ay) / 3), (ax + 2 * (bx - ax) / 3, ay + 2 * (by - ay) / 3), (bx, by)]
    pos = " ".join(f"{x:.1f},{y:.1f}" for x, y in spline)
    pos = f"e,{tip[0]},{tip[1]} " + pos
    if start:
        pos = f"s,{start[0]},{start[1]} " + pos
    a = {"pos": pos, "style": style, "color": color, "fontcolor": fontcolor,
         "dir": "both" if both else "forward"}
    if label:
        a["label"] = label
        a["lp"] = f"{lp[0]},{lp[1]}"
    body = ", ".join(f'{k}="{v}"' for k, v in a.items())
    out.append(f'  n{len(out)}a -> n{len(out)}b [{body}];')


def box(name):
    x, y, w, h = nodes[name]
    return {"top": y + h / 2, "bottom": y - h / 2, "left": x - w / 2, "right": x + w / 2, "x": x, "y": y}


# The Render container, drawn first so it sits underneath.
node("render", XS, 507, 310, 572, "", shape="box", style="rounded,dashed", color="#b9c2d0", fillcolor="none")
_rl = XS - 310 / 2 + 12  # left edge of the container, plus padding
node("render_title", _rl + 62, 507 + 572 / 2 - 12, 124, 14,
     '<font point-size="9" color="#5b6270">RENDER  ·  Docker, 512 MB</font>',
     shape="plaintext", style="", labeljust="l")

node("webapp", XS, 862, 270, 42, "<b>MetaProof web app</b>" + sub("React · PWA · served by Vercel · history on device"))
node("api", XS, 725, 260, 70, "<b>FastAPI</b>" + sub("validate · SHA-256 · rate limits"), fillcolor="#eef2f8")
node("uptime", XR, 748, 160, 38, "<b>UptimeRobot</b>" + sub("ping every 5 min"), style="rounded,dashed,filled", color=GREY)
node("github", XR, 702, 160, 38, "<b>GitHub</b>" + sub("code · CI · auto-deploy"), style="rounded,dashed,filled", color=GREY)
node("temp", XS, 610, 190, 42, "<b>Temp file</b>" + sub("private · deleted after analysis"))
node("queue", XR, 610, 140, 50, "<b>Job queue</b>" + sub("Neon Postgres"), shape="cylinder")
node("worker", XS, 500, 190, 42, "<b>Worker thread</b>" + sub("woken by uploads"), fillcolor="#eef2f8")
node("analyzers", XS, 380, 280, 84,
     '<table border="0" cellborder="0" cellspacing="0" cellpadding="1">'
     '<tr><td colspan="3"><b>5 analyzers</b></td></tr>'
     '<tr><td align="left"><font point-size="9.5">Metadata (EXIF, XMP)</font></td><td width="16"></td>'
     '<td align="left"><font point-size="9.5">C2PA credentials</font></td></tr>'
     '<tr><td align="left"><font point-size="9.5">File structure</font></td><td></td>'
     '<td align="left"><font point-size="9.5">Invisible watermark</font></td></tr>'
     '<tr><td colspan="3"><font point-size="9.5">AI detector (CLIP ViT-B/16 + MLP, ONNX)</font></td></tr></table>')
node("hf", XR, 380, 160, 40, "<b>Hugging Face Hub</b>" + sub("detector weights"), style="rounded,dashed,filled", color=GREY)
node("engine", XS, 265, 200, 42, "<b>Evidence engine</b>" + sub("weighs findings → verdict"), fillcolor="#eef2f8")
node("reports", XS, 150, 230, 52, "<b>Reports</b>" + sub("Neon Postgres · verdicts, findings"), shape="cylinder")
node("vectors", XR, 150, 170, 52, "<b>Embeddings</b>" + sub("pgvector · HNSW index"), shape="cylinder")

R_EDGE = box("render")["right"]
W, A, U, G, T, Q, K, Z, H, E, R, V = (box(n) for n in
    ["webapp", "api", "uptime", "github", "temp", "queue", "worker", "analyzers", "hf", "engine", "reports", "vectors"])

# Main workflow, numbered in order; the main column is one straight line.
edge([(XS, W["bottom"]), (XS, A["top"])], "1  upload image\\l8  poll · get report\\l", (XS + 54, 817), both=True)
edge([(XS, A["bottom"]), (XS, T["top"])], "2  stream + hash", (XS + 42, 662))
qx = A["right"] - 18
edge([(qx, A["bottom"]), (qx, Q["y"]), (Q["left"], Q["y"])], "3  enqueue", ((R_EDGE + Q["left"]) / 2, Q["y"] + 9))
edge([(XS, T["bottom"]), (XS, K["top"])], "read", (XS + 16, 555), style="dashed")
edge([(Q["x"], Q["bottom"]), (Q["x"], K["y"]), (K["right"], K["y"])], "4  claim job", (Q["x"] - 90, K["y"] + 9))
edge([(XS, K["bottom"]), (XS, Z["top"])], "5  run each", (XS + 34, 450))
edge([(XS, Z["bottom"]), (XS, E["top"])], "6  findings", (XS + 32, 312))
edge([(XS, E["bottom"]), (XS, R["top"])], "7  save verdict", (XS + 42, 210))
dx = Z["right"] - 20
edge([(dx, Z["bottom"]), (dx, V["y"]), (V["left"], V["y"])], "embedding", (dx + 34, 196))
edge([(R["left"], R["y"]), (XL, R["y"]), (XL, A["y"]), (A["left"], A["y"])], "read report", (XL + 33, 440),
     style="dashed", color=GREEN, fontcolor=GREEN)

# Deployment, build-time and monitoring links.
edge([(U["left"], U["y"]), (A["right"], U["y"])], "HEAD /api/health", (U["left"] - 50, U["y"] + 8),
     style="dashed", color=GREY, fontcolor="#5b6270")
edge([(G["left"], G["y"]), (A["right"], G["y"])], "deploy", (G["left"] - 50, G["y"] + 8),
     style="dashed", color=GREY, fontcolor="#5b6270")
edge([(H["left"], H["y"]), (Z["right"], H["y"])], "at build time", (H["left"] - 47, H["y"] + 8),
     style="dashed", color=GREY, fontcolor="#5b6270")

# Edges in -n2 mode still need endpoints; tiny invisible nodes stand in for them.
ends = []
for line in out:
    if "->" in line:
        a, b = line.split(" -> ")[0].strip(), line.split(" -> ")[1].split(" ")[0]
        ends += [a, b]

dot = ["// Generated by architecture.py; edit that file, not this one.",
       "digraph MetaProof {",
       '  graph [splines=true, bgcolor="white", pad="0.1", outputorder="nodesfirst"];',
       f'  node [shape=box, style="rounded,filled", fillcolor="white", color="{INK}", penwidth=1.2, '
       f'fontname="{FONT}", fontsize=11, margin="0.04,0.02"];',
       f'  edge [penwidth=1.15, arrowsize=0.7, fontname="{FONT}", fontsize=9.5];']
dot += [l for l in out if "->" not in l]
dot += [f'  {e} [shape=point, width=0, height=0, style=invis, label="", pos="{XS},500"];' for e in ends]
dot += [l for l in out if "->" in l]
dot.append("}")
Path(__file__).with_name("architecture.dot").write_text("\n".join(dot) + "\n", encoding="utf-8")
print("architecture.dot written")
