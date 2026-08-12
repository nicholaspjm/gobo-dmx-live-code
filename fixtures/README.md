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
`control`, `generic`, `strip`. The built-in ids — `dim`, `rgb`, `rgbw`,
`rgba`, `dim-rgb`, `dim-rgbw`, `moving-head-basic`, `moving-head-spot`,
`strobe` — can't be reused; the validator will reject a PR that tries.
Their pre-0.2 `generic-*` spellings still resolve as aliases, so don't
claim one of those either: the validator doesn't currently catch it, but
a fixture named `generic-rgbw` would shadow the alias and confuse
everyone's scenes. Pick a manufacturer-and-model id.

## Writing a fixture by exporting from the app

Define it in the editor with `defineFixture('your-id', {…})`, run it, then
use the **library** panel's *share* (opens a pre-filled PR) or *export*
(downloads `your-id.lumen-fixture.json` — rename it to `your-id.json`, the
validator rejects any other filename). Full contribution flow in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Limits

Strictly enforced by the validator on every PR:

| Field | Limit |
|---|---|
| `id` | 1-64 chars, `[a-z0-9-]+`, no collision with built-ins |
| `name` | 1-128 chars |
| `manufacturer` | 1-64 chars |
| `channelCount` | 1-512 |
| `channels` array | ≤ 128 entries |
| Channel `name` | 1-32 chars |
| Strip `pixelCount` | 1-512 |
| Total strip DMX channels | ≤ 512 |

No unknown fields anywhere. Strict string types.
