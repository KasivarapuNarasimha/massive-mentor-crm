# Bundled Inter Latin font

`inter-latin-variable.woff2` is copied unchanged from this application's existing
Next build asset `.next/static/media/e4af272ccee01ff0-s.p.woff2`. Its generated CSS
identified the Latin subset as Inter for all existing 400/500/600/700 weights.
Next's bundled font parser independently identified family Inter and a variable
weight axis of 100–900. The root layout intentionally uses only 400–700, as before.

SHA-256: `c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4`

The font bytes are not regenerated or modified. `next/font/local` retains the
existing `--font-inter` variable and swap behavior while removing a build-time
Google Fonts network dependency. Other scripts continue to use normal fallbacks.

`OFL.txt` is the upstream Inter license retrieved on 2026-10-26 from
https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt.
Upstream: https://github.com/rsms/inter. Keep the license with the font.
