from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH = 1280
HEIGHT = 760
BG = (10, 13, 20)
TERM_BG = (12, 16, 24)
PANEL_BG = (16, 22, 34)
PANEL_BORDER = (64, 83, 110)
TEXT = (215, 224, 238)
DIM = (136, 151, 175)
ACCENT = (107, 240, 255)
OK = (137, 255, 169)
WARN = (255, 215, 133)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets" / "preview.gif"


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Menlo.ttc",
        "/Library/Fonts/MesloLGS NF Regular.ttf",
        "/Library/Fonts/Courier New.ttf",
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


FONT_14 = load_font(14)
FONT_17 = load_font(17)
FONT_21 = load_font(21)
FONT_27 = load_font(27)


def t(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fill=TEXT, font=FONT_17):
    draw.text(xy, text, font=font, fill=fill)


def box(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, title: str | None = None):
    draw.rounded_rectangle((x, y, x + w, y + h), radius=10, fill=PANEL_BG, outline=PANEL_BORDER, width=2)
    if title:
        t(draw, (x + 18, y + 12), title, fill=ACCENT, font=FONT_21)


def frame(spinner: str, active_step: int, done_steps: int, stage_done: int) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    # Terminal shell
    draw.rounded_rectangle((24, 24, WIDTH - 24, HEIGHT - 24), radius=14, fill=TERM_BG, outline=(45, 58, 78), width=2)

    t(draw, (52, 62), "RepoSherlock v0.1.0", fill=ACCENT, font=FONT_27)
    t(draw, (52, 98), "Drop a repo URL. Get answers fast.", fill=DIM, font=FONT_17)

    # Run plan
    box(draw, 52, 130, WIDTH - 104, 165, "Run Plan")
    t(draw, (76, 172), "Target: https://github.com/octocat/Hello-World")
    t(draw, (76, 200), "LLM: enabled (mandatory)   Provider: openai   Model: gpt-5.2")
    t(draw, (76, 228), "Try-Run: enabled           PR Draft: enabled")
    t(draw, (76, 258), "✓ Starting analysis...", fill=OK)

    # Thinking panel
    box(draw, 52, 320, WIDTH - 104, 220, "Sherlock Thinking")
    steps = [
        "Validating repository target and runtime profile",
        "Planning scan strategy and safe execution path",
        "Preparing architecture, risk, and issue synthesis",
    ]

    y = 362
    for i, step_text in enumerate(steps):
        if i < done_steps:
            t(draw, (74, y), f"✓ {step_text}", fill=OK)
        elif i == active_step:
            t(draw, (74, y), f"▶ {spinner} {step_text}", fill=ACCENT)
        else:
            t(draw, (74, y), f"• {step_text}", fill=DIM)
        y += 34

    if active_step == 2 and done_steps < 3:
        t(draw, (74, 476), "note: parsing modules and collecting risk signals...", fill=DIM, font=FONT_14)

    # Stages
    box(draw, 52, 566, WIDTH - 104, 150, "Stages")
    stages = [
        "[RepoSherlock] A) Ingest done in 812ms",
        "[RepoSherlock] B) Scan + Understand done in 56ms",
        "[RepoSherlock] C) Risk Analysis done in 31ms",
        "[RepoSherlock] D) Actionable Issues done in 7ms",
        "[RepoSherlock] E) Try-Run Sandbox Pass done in 4.2s",
        "[RepoSherlock] F) LLM Polish Pass done in 3.1s",
    ]

    sy = 606
    for idx, line in enumerate(stages):
        if idx < stage_done:
            t(draw, (74, sy), f"✓ {line}", fill=OK, font=FONT_14)
        else:
            t(draw, (74, sy), f"• {line}", fill=DIM, font=FONT_14)
        sy += 18

    t(draw, (WIDTH - 360, HEIGHT - 50), "reposherlock -- analyze <target>", fill=WARN, font=FONT_14)
    return img


def build_frames() -> tuple[list[Image.Image], list[int]]:
    spin = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    frames: list[Image.Image] = []
    durations: list[int] = []

    # step 1
    for i in range(6):
        frames.append(frame(spin[i % len(spin)], active_step=0, done_steps=0, stage_done=0))
        durations.append(70)
    # step 2
    for i in range(6):
        frames.append(frame(spin[i % len(spin)], active_step=1, done_steps=1, stage_done=2))
        durations.append(70)
    # step 3
    for i in range(8):
        frames.append(frame(spin[i % len(spin)], active_step=2, done_steps=2, stage_done=4))
        durations.append(70)

    # final settle
    final = frame("⠿", active_step=2, done_steps=3, stage_done=6)
    for _ in range(8):
        frames.append(final.copy())
        durations.append(90)

    return frames, durations


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames, durations = build_frames()
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
