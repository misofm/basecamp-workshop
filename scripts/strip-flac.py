#!/usr/bin/env python3
"""Rewrite FLAC files in place so STREAMINFO is the only metadata block.

Miso masters must be STREAMINFO-only (`miso stems identify` reports streamInfoOnly); ffmpeg
always adds VORBIS_COMMENT and PADDING, and metaflac is not always installed.

    python3 scripts/strip-flac.py path/to/master.flac [...]
"""
import sys

for path in sys.argv[1:]:
    data = open(path, "rb").read()
    if data[:4] != b"fLaC":
        sys.exit(f"{path}: not a FLAC file")
    i, streaminfo = 4, None
    while True:
        header = data[i]
        kind, size = header & 0x7F, int.from_bytes(data[i + 1 : i + 4], "big")
        if kind == 0:
            streaminfo = data[i + 4 : i + 4 + size]
        i += 4 + size
        if header & 0x80:
            break
    if streaminfo is None or len(streaminfo) != 34:
        sys.exit(f"{path}: missing STREAMINFO")
    out = b"fLaC" + bytes([0x80]) + (34).to_bytes(3, "big") + streaminfo + data[i:]
    open(path, "wb").write(out)
    print(f"{path}: STREAMINFO only ({len(data) - len(out)} bytes removed)")
