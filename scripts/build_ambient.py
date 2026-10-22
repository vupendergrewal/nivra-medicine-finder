"""Build short original background loops. Not part of the site runtime."""

import math
import subprocess
from pathlib import Path

import numpy as np
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "media"
WIDTH, HEIGHT = 640, 360
FPS = 12
SECONDS = 8


def render(path: Path, base, orbs, sweep):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    path.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [
            ffmpeg, "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS),
            "-i", "-",
            "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-crf", "30", "-preset", "veryfast",
            "-movflags", "+faststart",
            str(path),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    yy, xx = np.ogrid[0:HEIGHT, 0:WIDTH]
    frames = FPS * SECONDS
    for index in range(frames):
        t = index / FPS
        image = np.empty((HEIGHT, WIDTH, 3), np.float32)
        image[:] = base
        for orb in orbs:
            cx = WIDTH * (0.5 + 0.34 * math.sin(2 * math.pi * t / SECONDS * orb["fx"] + orb["p"]))
            cy = HEIGHT * (0.5 + 0.30 * math.cos(2 * math.pi * t / SECONDS * orb["fy"] + orb["p"]))
            sigma = orb["r"] * WIDTH
            glow = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma * sigma))
            image += glow[..., None] * orb["color"]
        shift = 0.5 + 0.5 * math.sin(2 * math.pi * t / SECONDS)
        band = np.exp(-((xx / WIDTH - shift) ** 2) / 0.018)
        image += band[..., None] * sweep
        proc.stdin.write(np.clip(image, 150, 255).astype(np.uint8).tobytes())
    proc.stdin.close()
    error = proc.stderr.read().decode("utf-8", "replace")
    if proc.wait() != 0:
        raise SystemExit(error[-2000:])
    print(path.name, path.stat().st_size)


def main():
    render(
        OUT / "section-light.mp4",
        base=(238, 234, 224),
        orbs=[
            {"fx": 1, "fy": 1, "p": 0.4, "r": 0.34, "color": (8, 48, 28)},
            {"fx": 1, "fy": 2, "p": 2.1, "r": 0.26, "color": (36, 18, -8)},
            {"fx": 2, "fy": 1, "p": 4.2, "r": 0.22, "color": (-12, 22, 8)},
        ],
        sweep=(22, 24, 16),
    )
    render(
        OUT / "admin-drift.mp4",
        base=(206, 220, 212),
        orbs=[
            {"fx": 1, "fy": 1, "p": 1.0, "r": 0.36, "color": (-18, 36, 16)},
            {"fx": 2, "fy": 1, "p": 3.4, "r": 0.24, "color": (12, 28, 18)},
            {"fx": 1, "fy": 2, "p": 5.1, "r": 0.2, "color": (-8, -4, 10)},
        ],
        sweep=(10, 22, 16),
    )
    render(
        OUT / "owner-drift.mp4",
        base=(236, 226, 208),
        orbs=[
            {"fx": 1, "fy": 1, "p": 0.2, "r": 0.32, "color": (42, 18, -6)},
            {"fx": 1, "fy": 2, "p": 2.8, "r": 0.28, "color": (6, 40, 14)},
            {"fx": 2, "fy": 1, "p": 4.6, "r": 0.18, "color": (18, 8, -4)},
        ],
        sweep=(28, 16, 6),
    )


if __name__ == "__main__":
    main()
