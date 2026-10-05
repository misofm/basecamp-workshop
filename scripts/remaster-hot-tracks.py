#!/usr/bin/env python3
"""Lower the gain of not-yet-stored masters whose true peak is above the target.

The miso transcoder refuses masters whose AAC renditions would exceed its true-peak /
decoded-sample ceiling, and several ElevenLabs renders peak at or above 0 dBFS. This
re-renders those masters from the original ElevenLabs PCM with a plain gain reduction
(no limiting, so dynamics are untouched) and triangular dither back to 16 bit, strips
the FLAC to STREAMINFO, records the change in generation.json, and clears the track's
entry in masters.json so store-media.ts recomputes its ids.

    python3 scripts/remaster-hot-tracks.py [--target -2.0] [--dry-run]
"""
import json, os, re, subprocess, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
target = float(sys.argv[sys.argv.index("--target") + 1]) if "--target" in sys.argv else -2.0
dry = "--dry-run" in sys.argv
catalog = json.load(open(os.path.join(root, "catalog/catalog.json")))


def true_peak(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    summary = out[out.rindex("True peak:"):]
    return float(re.search(r"Peak:\s+(-?[0-9.]+|-inf) dBFS", summary).group(1))


for rel in catalog["releases"]:
    folder = f"{rel['artist']}-{rel['slug']}"
    base = os.path.join(root, "releases", folder)
    masters_path = os.path.join(base, "masters.json")
    masters = json.load(open(masters_path)) if os.path.exists(masters_path) else {"tracks": {}}
    gen_path = os.path.join(base, "generation.json")
    gen = json.load(open(gen_path))
    changed = False
    for i, track in enumerate(rel["tracks"]):
        key = f"{i + 1:02d}-{track['slug']}"
        if masters.get("tracks", {}).get(key, {}).get("streamingTranscode"):
            continue  # already on Walrus; never change a stored or published master
        flac = os.path.join(base, "assets/tracks", key, "master.flac")
        tp = true_peak(flac)
        if tp <= target:
            continue
        gain = round(target - tp, 1)
        print(f"{folder}/{key}: true peak {tp:+.1f} dBTP -> gain {gain:+.1f} dB")
        if dry:
            continue
        pcm = os.path.join(root, "catalog/out/audio", rel["slug"], f"{track['slug']}.pcm")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "44100", "-ac", "2",
                        "-i", pcm, "-af", f"volume={gain}dB,aresample=osf=s16:dither_method=triangular",
                        "-map_metadata", "-1", "-c:a", "flac", "-compression_level", "8", flac], check=True)
        subprocess.run(["python3", os.path.join(root, "scripts/strip-flac.py"), flac], check=True, capture_output=True)
        for g in gen["tracks"]:
            if g["track"] == track["slug"]:
                g["mastering"] = {"gainDb": gain, "sourceTruePeakDbtp": tp, "targetTruePeakDbtp": target,
                                  "reason": "miso transcoder true-peak ceiling", "dither": "triangular"}
        masters.get("tracks", {}).pop(key, None)
        changed = True
    if changed:
        json.dump(gen, open(gen_path, "w"), indent=2)
        open(gen_path, "a").write("\n")
        if os.path.exists(masters_path):
            json.dump(masters, open(masters_path, "w"), indent=2)
            open(masters_path, "a").write("\n")
