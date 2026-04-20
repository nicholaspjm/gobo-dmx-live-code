# Public fixture library

One JSON file per fixture, any of which can be pulled into the lumen app's
library with one click. Contributions are welcome — open a PR adding your
file here and the automated validator + a human review will gate it.

## File format

```jsonc
{
  "lumenFixture": 1,             // schema version; always 1 today
  "id": "your-fixture-id",       // unique id, [a-z0-9-] only
  "def": {
    "name": "Human-readable name",
    "manufacturer": "Maker",
    "type": "generic",           // or dimmer / rgb / rgba / rgbw /
                                  //    moving-head / strobe
    "channelCount": 38,
    "channels": [
      { "offset": 0, "name": "dim",    "type": "intensity" },
      { "offset": 1, "name": "strobe", "type": "strobe"    },
      { "offset": 2, "name": "pixels",
        "type": "strip",
        "pixelCount": 8,
        "pixelLayout": "rgbw"     // or "rgb"
      }
      // … one entry per DMX channel
    ]
  }
}
```

Channel `type` is one of `intensity`, `color`, `position`, `strobe`,
`control`, `generic`, `strip`. Built-in fixture ids (`generic-dimmer`,
`generic-rgbw`, `moving-head-basic`, etc.) can't be reused — the
validator will reject a PR that tries.

## Writing a fixture by exporting from the app

Easiest path:

1. Define the fixture in the editor with `defineFixture('your-id', {…})`
2. Run it (Ctrl+Enter)
3. Open the **library** panel, find it under *Defined this session*, click
   **export** — you'll get the file ready to drop in here.

## Limits

Strictly enforced by the validator on every PR:

| Field | Limit |
|---|---|
| `id` | 1-64 chars, `[a-z0-9-]+`, no collision with built-ins |
| `name` | 1-128 chars |
| `manufacturer` | 1-64 chars |
| `channelCount` | 1-512 |
| `channels` array | ≤ 128 entries |
| Strip `pixelCount` | 1-512 |
| Total strip DMX channels | ≤ 512 |

No unknown fields anywhere. Strict string types.
