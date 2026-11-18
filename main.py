"""Copy the finished front page into the contest output directory."""

import os
from pathlib import Path
from shutil import copyfile


def main():
    destination = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    destination.mkdir(parents=True, exist_ok=True)
    artwork = Path(__file__).resolve().with_name("entry.png")
    copyfile(artwork, destination / "entry.png")


if __name__ == "__main__":
    main()
