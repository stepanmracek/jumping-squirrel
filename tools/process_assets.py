"""Turn the photographed drawings in assets/ into transparent game sprites.

Writes game/sprites/*.png and game/sprite-data.js (sprite sizes + tree branch
platforms detected from the drawings). Run from the repo root:

    python3 tools/process_assets.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets"
OUT = ROOT / "game" / "sprites"

# target size of the longest side of the exported sprite (px)
TARGET = {"squirrel": 360, "tree": 900, "nut": 128, "leaf": 128, "bird": 160, "umbrella": 240, "sun": 300, "moon": 200, "trees": 1200, "tree-bg": 260, "owl": 240, "bunny": 240, "grass-tuft": 200}


def ink_mask(rgb: np.ndarray, sat_thresh: float) -> np.ndarray:
    """Pixels that are coloured crayon rather than paper."""
    rgb = rgb.astype(np.int16)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    # paper colour differs between photos, so estimate it from the border
    border = np.concatenate([sat[:10].ravel(), sat[-10:].ravel(), sat[:, :10].ravel(), sat[:, -10:].ravel()])
    paper_sat = np.median(border)
    return (sat - paper_sat) > sat_thresh


def morph(mask: Image.Image, size: int, op: str) -> Image.Image:
    f = ImageFilter.MaxFilter(size) if op == "dilate" else ImageFilter.MinFilter(size)
    return mask.filter(f)


def fill_holes(mask: Image.Image) -> Image.Image:
    """Fill enclosed holes (eyes, belly, paper specks inside crayon)."""
    w, h = mask.size
    padded = Image.new("L", (w + 2, h + 2), 0)
    padded.paste(mask, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128)
    arr = np.array(padded)[1:-1, 1:-1]
    return Image.fromarray(np.where(arr == 128, 0, 255).astype(np.uint8))


def label_components(mask: np.ndarray):
    """4-connected component labels and the size of each component."""
    h, w = mask.shape
    labels = np.zeros(mask.shape, dtype=np.int32)
    sizes = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if labels[y0, x0]:
            continue
        label = len(sizes) + 1
        labels[y0, x0] = label
        stack, size = [(y0, x0)], 0
        while stack:
            y, x = stack.pop()
            size += 1
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = label
                    stack.append((ny, nx))
        sizes.append(size)
    return labels, sizes


def largest_components(mask: np.ndarray, keep_ratio: float = 0.02) -> np.ndarray:
    """Drop small specks: keep components bigger than keep_ratio of the largest."""
    labels, sizes = label_components(mask)
    if not sizes:
        return mask
    biggest = max(sizes)
    keep = [i + 1 for i, s in enumerate(sizes) if s >= biggest * keep_ratio]
    return np.isin(labels, keep)


def crayon_strength(rgb: np.ndarray, blur: float) -> np.ndarray:
    """How much more colourful than the local paper each pixel is."""
    sat = rgb.astype(np.int16)
    sat = Image.fromarray((sat.max(axis=2) - sat.min(axis=2)).astype(np.uint8))
    w, h = sat.size
    # median over a window much wider than a trunk ~ local paper colour
    paper = sat.resize((max(w // 40, 1), max(h // 40, 1)), Image.BILINEAR).filter(ImageFilter.MedianFilter(9))
    paper = np.array(paper.filter(ImageFilter.GaussianBlur(2)).resize((w, h), Image.BILINEAR), dtype=np.float32)
    return np.array(sat.filter(ImageFilter.GaussianBlur(blur)), dtype=np.float32) - paper


def crayon_mask(rgb: np.ndarray, weak: float, strong: float) -> np.ndarray:
    """Mask for lightly-pressed crayon (the trees).

    A single threshold either eats the pale parts of a trunk or picks up the
    paper's lighting gradient. Instead: compare against the paper colour
    measured over a wide neighbourhood, smooth away the crayon grain, and keep
    faint pixels only where they connect to clearly coloured ones.
    """
    diff = crayon_strength(rgb, 3)
    labels, _ = label_components(diff > weak)
    seeds = np.unique(labels[(diff > strong) & (labels > 0)])
    return np.isin(labels, seeds)


def cutout(path: Path, kind: str, sat_thresh: float, close: int, grow: int, keep_ratio: float = 0.02,
           pencil: bool = False) -> Image.Image:
    im = Image.open(path).convert("RGB")
    # work at reduced resolution: plenty for masks and much faster
    scale = min(1.0, 1200 / max(im.size))
    if scale < 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    rgb = np.array(im)
    ink = crayon_mask(rgb, 7, 20) if kind == "tree" else ink_mask(rgb, sat_thresh)
    if pencil:
        # also keep pencil details (legs, whiskers) drawn outside the colour
        ink = ink | pencil_mask(im)[1]
    mask = Image.fromarray((ink * 255).astype(np.uint8))
    mask = morph(morph(mask, close, "dilate"), close, "erode")
    mask = fill_holes(mask)
    mask = morph(mask, 3, "erode")  # remove 1px noise
    small = mask.resize((mask.width // 4, mask.height // 4), Image.NEAREST)
    keep = largest_components(np.array(small) > 0, keep_ratio)
    keep_img = Image.fromarray((keep * 255).astype(np.uint8)).resize(mask.size, Image.NEAREST)
    keep_img = morph(keep_img, 9, "dilate")
    mask = Image.fromarray(np.minimum(np.array(mask), np.array(keep_img)))
    if grow:
        mask = morph(mask, grow, "dilate")  # include pencil outline
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))

    rgba = im.convert("RGBA")
    rgba.putalpha(mask)
    bbox = mask.point(lambda v: 255 if v > 40 else 0).getbbox()
    rgba = rgba.crop(bbox)
    t = TARGET[kind]
    s = t / max(rgba.size)
    return rgba.resize((round(rgba.width * s), round(rgba.height * s)), Image.LANCZOS)


def pencil_mask(im: Image.Image):
    """Pencil lines: how much darker than the local paper each pixel is, and a
    mask of the clear strokes (faint pixels kept where they touch clear ones)."""
    lum = Image.fromarray(np.array(im, dtype=np.float32).mean(axis=2).astype(np.uint8))
    w, h = lum.size
    paper = lum.resize((w // 40, h // 40), Image.BILINEAR).filter(ImageFilter.MedianFilter(9))
    paper = np.array(paper.filter(ImageFilter.GaussianBlur(2)).resize((w, h), Image.BILINEAR), dtype=np.float32)
    dark = paper - np.array(lum.filter(ImageFilter.GaussianBlur(1)), dtype=np.float32)
    labels, _ = label_components(dark > 14)
    seeds = np.unique(labels[(dark > 35) & (labels > 0)])
    return dark, np.isin(labels, seeds)


def moon_cutout(path: Path) -> Image.Image:
    """Pencil-outlined moon: everything inside the outline is the moon."""
    im = Image.open(path).convert("RGB")
    s = 1000 / max(im.size)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    _, lines = pencil_mask(im)
    lines = morph(Image.fromarray((lines * 255).astype(np.uint8)), 5, "dilate")
    disk = fill_holes(lines)
    keep = largest_components(np.array(disk) > 0, 0.5)
    alpha = Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    rgba = im.convert("RGBA")
    rgba.putalpha(alpha)
    rgba = rgba.crop(alpha.point(lambda v: 255 if v > 40 else 0).getbbox())
    # the paper is greyish in the photo; make the moon glow a little
    a = rgba.getchannel("A")
    rgba = ImageEnhance.Brightness(rgba.convert("RGB")).enhance(1.25).convert("RGBA")
    rgba.putalpha(a)
    t = TARGET["moon"]
    return rgba.resize((t, round(rgba.height * t / rgba.width)), Image.LANCZOS)


def split_columns(img: Image.Image, height: int) -> list[Image.Image]:
    """Split a sheet of drawings side by side at empty columns."""
    a = np.array(img.getchannel("A")) > 40
    cols = a.any(axis=0)
    parts, x = [], 0
    while x < len(cols):
        if cols[x]:
            x0 = x
            while x < len(cols) and cols[x]:
                x += 1
            if x - x0 > 20:
                part = img.crop((x0, 0, x, img.height))
                part = part.crop(part.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox())
                parts.append(part.resize((round(part.width * height / part.height), height), Image.LANCZOS))
        else:
            x += 1
    return parts


def grass_parts(path: Path):
    """grass.png: plants standing on a hatched band of grass. Only the plants are
    used (cut off at the top of the band), keeping their relative sizes."""
    im = Image.open(path).convert("RGB")
    im = im.resize((2000, round(im.height * 2000 / im.width)), Image.LANCZOS)
    rgb = np.array(im)
    mask = crayon_mask(rgb, 7, 20) | pencil_mask(im)[1]    # pencil: the dark stem
    h = mask.shape[0]
    top = int(0.815 * h)                                   # top of the band, measured

    # plants: everything above the band
    plants = Image.fromarray((mask[:top] * 255).astype(np.uint8))
    plants = fill_holes(morph(morph(plants, 7, "dilate"), 7, "erode"))
    small = plants.resize((plants.width // 4, plants.height // 4), Image.NEAREST)
    keep = largest_components(np.array(small) > 0, 0.05)
    keep = Image.fromarray((keep * 255).astype(np.uint8)).resize(plants.size, Image.NEAREST)
    alpha = Image.fromarray(np.minimum(np.array(plants), np.array(morph(keep, 9, "dilate"))))
    alpha = morph(alpha, 3, "dilate").filter(ImageFilter.GaussianBlur(1.2))
    sheet = im.crop((0, 0, im.width, top)).convert("RGBA")
    sheet.putalpha(alpha)
    a = np.array(alpha) > 40
    cols = a.any(axis=0)
    spans, x = [], 0
    while x < len(cols):
        if cols[x]:
            x0 = x
            while x < len(cols) and cols[x]:
                x += 1
            spans.append([x0, x])
        else:
            x += 1
    # the blades of one tuft are separate thin strokes: join a thin span to its
    # neighbour when the gap is small (whole plants stay apart)
    merged = [spans[0]]
    for sp in spans[1:]:
        last = merged[-1]
        thin = min(last[1] - last[0], sp[1] - sp[0]) < 70
        if thin and sp[0] - last[1] < 60:
            last[1] = sp[1]
        else:
            merged.append(sp)
    parts = []
    for x0, x1 in merged:
        if x1 - x0 > 30:
            part = sheet.crop((x0, 0, x1, sheet.height))
            parts.append(part.crop(part.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()))
    k = TARGET["grass-tuft"] / max(pt.height for pt in parts)
    tufts = [pt.resize((round(pt.width * k), round(pt.height * k)), Image.LANCZOS) for pt in parts]

    return tufts


def split_birds(path: Path) -> list[Image.Image]:
    """birds.png holds three pencil gulls stacked vertically: wings up, mid,
    down. Cut each out as one frame of a wing-flap animation."""
    im = Image.open(path).convert("RGB")
    s = 1400 / max(im.size)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    dark, mask = pencil_mask(im)
    h = mask.shape[0]
    mask = np.array(morph(Image.fromarray((mask * 255).astype(np.uint8)), 5, "dilate")) > 0
    # soft pencil alpha, in a single graphite colour (no paper fringe)
    alpha = (np.clip((dark - 6) / 35, 0, 1) * mask * 255).astype(np.uint8)

    # birds are separated by empty rows
    rows = mask.any(axis=1)
    bands, y = [], 0
    while y < h:
        if rows[y]:
            y0 = y
            while y < h and rows[y]:
                y += 1
            if y - y0 > 20:
                bands.append((y0, y))
        else:
            y += 1
    frames = []
    for y0, y1 in bands:
        a = Image.fromarray(alpha[y0:y1])
        bbox = a.getbbox()
        a = a.crop(bbox)
        frame = Image.new("RGBA", a.size, (58, 56, 54, 0))
        frame.putalpha(a)
        t = TARGET["bird"]
        frames.append(frame.resize((t, round(frame.height * t / frame.width)), Image.LANCZOS))
    return frames


def umbrella_grip(img: Image.Image):
    """Where the paw holds the handle (just above the hook), as fractions."""
    a = np.array(img.getchannel("A")) > 128
    h, w = a.shape
    y = int(h * 0.85)
    xs = np.nonzero(a[y])[0]
    return {"grip": [round(float(xs.mean()) / w, 4), round(y / h, 4)]}


def tree_platforms(img: Image.Image):
    """Find the trunk and horizontal branches; return branch top surfaces.

    Coordinates are fractions of the sprite width/height so the game can
    scale trees freely.
    """
    a = np.array(img.getchannel("A")) > 128
    h, w = a.shape
    cols = a.sum(axis=0)
    # trunk = contiguous columns that are filled for most of the height
    trunk_cols = np.nonzero(cols > h * 0.55)[0]
    tx0, tx1 = int(trunk_cols.min()), int(trunk_cols.max())
    # per-row horizontal extent outside the trunk
    branches = []
    for side in ("left", "right"):
        region = a[:, :tx0] if side == "left" else a[:, tx1 + 1:]
        row_fill = region.sum(axis=1)
        is_branch = row_fill > w * 0.08
        y = 0
        while y < h:
            if not is_branch[y]:
                y += 1
                continue
            y0 = y
            while y < h and is_branch[y]:
                y += 1
            y1 = y
            if y1 - y0 < 8:
                continue
            band = region[y0:y1]
            xs = np.nonzero(band.any(axis=0))[0]
            if side == "left":
                bx0, bx1 = int(xs.min()), tx1
            else:
                bx0, bx1 = tx0, tx1 + 1 + int(xs.max())
            # the top surface: median of first filled row across the branch
            span = a[y0:y1, bx0:bx1] if side == "right" else a[y0:y1, bx0:tx0]
            tops = [np.argmax(span[:, i]) for i in range(span.shape[1]) if span[:, i].any()]
            top = y0 + int(np.median(tops))
            branches.append({
                "side": side,
                "x0": round(bx0 / w, 4),
                "x1": round(bx1 / w, 4),
                "y": round(top / h, 4),
                "thick": round((y1 - y0) / h, 4),
            })
    branches.sort(key=lambda b: b["y"])
    return {"trunk": [round(tx0 / w, 4), round((tx1 + 1) / w, 4)], "branches": branches}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data = {}
    settings = {
        # kind: (saturation threshold, closing size, outline grow)
        "squirrel": (45, 7, 7),
        "tree": (22, 9, 3),
        "nut": (40, 7, 3),
        "leaf": (35, 5, 5),
        "umbrella": (40, 9, 15),
        "sun": (30, 5, 3, 0.001),     # keep every thin ray
        "trees": (35, 9, 9),
        "owl": (35, 7, 5, 0.02, True),
        "bunny": (25, 7, 5, 0.02, True),
    }
    for path in sorted([*SRC.glob("*.png"), *SRC.glob("*.jpg")]):
        name = path.stem
        if name == "birds":
            for i, frame in enumerate(split_birds(path), 1):
                frame.save(OUT / f"bird-{i}.png", optimize=True)
                data[f"bird-{i}"] = {"w": frame.width, "h": frame.height}
                print(f"bird-{i}", data[f"bird-{i}"])
            continue
        if name == "moon":
            img = moon_cutout(path)
            img.save(OUT / "moon.png", optimize=True)
            data["moon"] = {"w": img.width, "h": img.height}
            print("moon", data["moon"])
            continue
        if name == "grass":
            for i, tuft in enumerate(grass_parts(path), 1):
                tuft.save(OUT / f"grass-{i}.png", optimize=True)
                data[f"grass-{i}"] = {"w": tuft.width, "h": tuft.height}
                print(f"grass-{i}", data[f"grass-{i}"])
            continue
        if name == "trees-bg":
            sheet = cutout(path, "trees", *settings["trees"])
            for i, tree in enumerate(split_columns(sheet, TARGET["tree-bg"]), 1):
                tree.save(OUT / f"tree-bg-{i}.png", optimize=True)
                data[f"tree-bg-{i}"] = {"w": tree.width, "h": tree.height}
                print(f"tree-bg-{i}", data[f"tree-bg-{i}"])
            continue
        kind = name.split("-")[0]
        img = cutout(path, kind, *settings[kind])
        img.save(OUT / f"{name}.png", optimize=True)
        entry = {"w": img.width, "h": img.height}
        if kind == "tree":
            entry.update(tree_platforms(img))
        if kind == "umbrella":
            entry.update(umbrella_grip(img))
        data[name] = entry
        print(name, entry)
    js = "// generated by tools/process_assets.py — do not edit\nconst SPRITE_DATA = " + json.dumps(data, indent=1) + ";\n"
    (ROOT / "game" / "sprite-data.js").write_text(js)


if __name__ == "__main__":
    main()
