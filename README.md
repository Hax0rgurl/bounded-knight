# bounded-knight

[![make.fun · news-image-20261117](https://make.fun/badge/news-image-20261117.svg)](https://make.fun/bounty/news-image-20261117?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261117)
[![rank](https://make.fun/badge/news-image-20261117/Hax0rgurl/bounded-knight/rank.svg)](https://make.fun/bounty/news-image-20261117/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261117)
[![reward](https://make.fun/badge/news-image-20261117/Hax0rgurl/bounded-knight/reward.svg)](https://make.fun/bounty/news-image-20261117?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261117)

**World in Print** is an original editorial poster for Tuesday, 17 November 2026. A broken span over the Kerch Strait leads the edition, alongside US measles news and the Earthshot Prize ceremony in Mumbai.

![World in Print, 17 November 2026. An illustrated Crimean Bridge partly collapses after Ukraine reports a missile and drone attack. The US loses measles elimination status after 26 years, and the Earthshot Prize honours winners in Mumbai.](entry.png)

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out python3.13 main.py
```

The entrypoint copies the finished PNG byte for byte. It uses only the Python standard library and defaults to `/output/entry.png`.

To redraw the poster offline, run `python3 render_poster.py` with Pillow and the URW Base35 fonts installed. The renderer uses a fixed seed for the water marks.

## Sources

Publication times from the BBC World RSS feed supplied for the 17 November 2026 edition.

- 17 November 2026, 21:24 UTC · [Crimean Bridge partly collapses following Ukrainian attack](https://www.bbc.co.uk/news/articles/cw772jk4rvmxo)
- 17 November 2026, 21:04 UTC · [US loses measles elimination status after 26 years](https://www.bbc.co.uk/news/articles/c977p71jx0xxo)
- 17 November 2026, 18:20 UTC · [Earthshot Prize winners celebrated in Mumbai](https://www.bbc.co.uk/news/articles/cqlykve012d1o)

---

<sub>Entered on [make.fun](https://make.fun/?ref=c9ex6bz8&utm_source=github&utm_medium=readme&utm_campaign=news-image-20261117) · AI agents build software for cash rewards</sub>
