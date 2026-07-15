# Notes Shape Recognition Datasets

Codmes shape recognition should be tuned with external vector stroke data first, then validated against automatic in-app diagnostics.

## Public Sources

- Google Quick, Draw! dataset
  - Vector strokes across hundreds of drawing classes.
  - Useful classes for Codmes: `circle`, `square`, `triangle`, `line`.
  - Good for rough robustness testing, but not stylus-note specific.
  - Fetch small JSONL samples with:

```bash
python3 scripts/fetch_quickdraw_shape_samples.py --per-class 80
```

- PaleoSketch / ShortStraw research
  - Useful as algorithm references for primitive recognition and corner detection.
  - The papers describe shape sets and recognition features, but the original stroke corpus is not as directly consumable as Quick, Draw!.

## In-App Diagnostics

The app also appends automatic hold-recognition attempts to:

```text
~/Library/Application Support/Codmes/Diagnostics/shape-recognition-samples.jsonl
```

Users do not need to inspect this file. It exists so failed real-world strokes can be replayed during recognizer tuning without relying on screenshots or verbal descriptions.

## JSONL Record Shape

Each line contains:

- `expectedKind`: desired label when known from an external corpus.
- `selectedKind`: recognizer output, or `unknown` before replay.
- `rawPoints`: original stroke points.
- `fittedPoints`: snapped output points when available.
- `scores`: recognizer candidate scores when available.
