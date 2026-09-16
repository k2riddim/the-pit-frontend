# Card fonts

The three static faces `src/render.ts` hands to resvg (docs/05 §3), each with its OFL licence beside it:

| file | face | job on the cards | source |
|---|---|---|---|
| `GochiHand-Regular.ttf.bin` | Gochi Hand 400 | the shout: one headline, fighter names, "world peace" | google/fonts `ofl/gochihand/GochiHand-Regular.ttf` |
| `Nunito-Black.ttf.bin` | Nunito 900 (static instance) | the talker: labels, badges, every sentence | google/fonts `ofl/nunito/Nunito[wght].ttf`, instanced at `wght=900` |
| `JetBrainsMono-Bold.ttf.bin` | JetBrains Mono 700 | the receipt: IQ, ranks, money, time | JetBrains/JetBrainsMono `fonts/ttf/JetBrainsMono-Bold.ttf` |

Every file is a plain TrueType font. The `.ttf.bin` suffix is only there for the bundlers: wrangler and the
vitest workers pool both ship `**/*.bin` as a Data module (an `ArrayBuffer`) with no configuration at all,
whereas a `.ttf` would need a `rules` entry in `wrangler.jsonc`. Strip the suffix to open one in a font editor.

resvg ignores the weight axis of a variable font (every weight renders as the default instance), which is
why Nunito is shipped as a static Black instance and not as `Nunito[wght].ttf`.

## Regenerating

```bash
cd engine/assets/fonts
curl -sL -o GochiHand-Regular.ttf.bin "https://github.com/google/fonts/raw/main/ofl/gochihand/GochiHand-Regular.ttf"
curl -sL -o OFL-GochiHand.txt          "https://github.com/google/fonts/raw/main/ofl/gochihand/OFL.txt"
curl -sL -o JetBrainsMono-Bold.ttf.bin "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Bold.ttf"
curl -sL -o OFL-JetBrainsMono.txt      "https://github.com/JetBrains/JetBrainsMono/raw/master/OFL.txt"
curl -sL -o Nunito-Variable.ttf        "https://github.com/google/fonts/raw/main/ofl/nunito/Nunito%5Bwght%5D.ttf"
curl -sL -o OFL-Nunito.txt             "https://github.com/google/fonts/raw/main/ofl/nunito/OFL.txt"
pip install fonttools
fonttools varLib.instancer --update-name-table Nunito-Variable.ttf wght=900 -o Nunito-Black.ttf.bin
rm Nunito-Variable.ttf
```

`--update-name-table` makes the instance call itself "Nunito Black" (family "Nunito", subfamily "Black",
`OS/2.usWeightClass` 900) — `test/render.test.ts` checks the table, and that no `fvar` table is left.
