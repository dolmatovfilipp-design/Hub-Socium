# RF cities list (people search)

Static curated subset used by Messages people-search city typeahead (``src/data/ru-cities.ts` (JSON mirror: `src/data/ru-cities.json`)`).

- **Source:** manually curated list of large RF cities and regional / republic capitals (beta).
- **Not** an official registry dump; no external geocoding API.
- City filter on `GET /v1/users/search?city=` expects an **exact** match (case-insensitive) against a name from this list.
- To extend: append normalized names to the JSON (title case as shown); keep FE typeahead over the static file only.
