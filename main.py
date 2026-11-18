"""Copy the finished poster into the make.fun output directory."""

import os
from pathlib import Path
from shutil import copyfile


def main():
    filename = "entry.png"
    source = Path(__file__).resolve().with_name(filename)
    target_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    target_dir.mkdir(parents=True, exist_ok=True)
    copyfile(source, target_dir / filename)


if __name__ == "__main__":
    main()
