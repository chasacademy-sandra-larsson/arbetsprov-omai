# Recept-API — semantisk receptsökning

REST-API som söker recept på **ingredienser och/eller en fritextbeskrivning,
på valfritt språk**, och svarar med recepten på engelska. Sökningen är
semantisk: "krämig kycklinggryta" hittar "Creamy Chicken Stew" utan att
något ord matchar.

Arkitekturvalen bygger på en mätande förstudie — se [`../PROTOTYP.md`](../PROTOTYP.md).
Hänvisningar till "fynd N" nedan pekar dit.

## Start

**Beroenden:** Node.js ≥ 20, Docker. **Valfritt:** en Anthropic API-nyckel
(utan nyckel fungerar allt, men frågetolkningen degraderar — se
[Robusthet](#robusthet)).

```bash
cd api
npm install
docker compose up -d chroma   # stödsystem: Chroma (vektordatabas) på port 8000
cp .env.example .env          # fyll i ANTHROPIC_API_KEY (rekommenderas)

npm run ingest                # engångskörning: indexera alla recept (~1,5–2 h)
npm start                     # API:t på http://localhost:3000
```

Alternativt körs hela stacken (API + Chroma) i Docker, som vid molndeployen:
`docker compose up -d --build` — då behövs varken npm eller lokal Node.

Ingesten läser `../20170107-061401-recipeitems.json` (173 278 recept, NDJSON),
är **idempotent och resumbar** — avbryts den fortsätter en omstart där den
var — och kan rökköras på en delmängd: `npm run ingest -- --limit=2000`.
Indexet sparas i Docker-volymen `chroma-data/` och överlever omstarter.

## API

### `POST /search`

```json
{
  "query": "pasta utan tomat",
  "ingredients": ["kyckling", "citron"],
  "maxResults": 5
}
```

| Fält | Typ | Regler |
|---|---|---|
| `query` | string | fritext på valfritt språk, 1–500 tecken |
| `ingredients` | string[] | 1–30 ingredienser på valfritt språk |
| `maxResults` | number | 1–20, default 5 |

Minst ett av `query`/`ingredients` krävs. Svar:

```json
{
  "original": "pasta utan tomat",
  "interpreted": {
    "description": "simple pasta dish",
    "include": ["pasta"],
    "exclude": ["tomato"],
    "interpretedBy": "llm"
  },
  "results": [
    {
      "recipe": { "name": "Simple Summer Pasta", "ingredients": "...", "url": "..." },
      "score": 0.99,
      "matchedIngredients": ["pasta"]
    }
  ]
}
```

`recipe` är hela originalobjektet ur datasetet (engelska). `interpreted`
visar hur frågan tolkades — medvetet exponerat för felsökning och transparens.
`score` duger till rankning men är ingen kalibrerad relevans (fynd 4).

Felsvar: `400` med fältvisa detaljer vid ogiltig indata, `503` med åtgärdbar
text om Chroma inte är igång/ingestad, `404` med hjälptext för okända routes.

**Exempel (curl):**

```bash
# Fritext på svenska — negation blir hårt exclude-filter
curl -X POST http://localhost:3000/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "pasta utan tomat", "maxResults": 3}'

# Bara ingredienser, på svenska
curl -X POST http://localhost:3000/search \
  -H 'Content-Type: application/json' \
  -d '{"ingredients": ["kyckling", "citron", "vitlök"]}'

# Fritext + ingredienser kombinerat, på engelska
curl -X POST http://localhost:3000/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "creamy stew", "ingredients": ["chicken", "mushrooms"]}'
```

### `GET /health`

Status, antal indexerade recept och aktivt tolkningsläge (`llm`/`fallback`).

```bash
curl http://localhost:3000/health
```

Testverktyg utan HTTP: `npm run search -- "pasta utan tomat"`.

## Arkitektur

Två pipelines, delade endast via embeddingmodellen och Chroma:

```
INGEST (offline, en gång)          SÖKNING (online, per anrop)
NDJSON, 173 278 recept             fråga (valfritt språk)
  │ streamas radvis                  │
  ▼                                  ▼
zod-validering ──ogiltiga──▶ räknas  LLM-tolkning (Claude Haiku) ──fel──▶ rå fråga (fallback)
  │                                  │  {description(en), include, exclude}
  ▼                                  ▼
rensning av ingrediensfritext      embedda description        [e5-small, "query:"]
  │  fallback namn+beskrivning       │
  │  för ~29 % trasiga (fynd 1)      ▼
  ▼                                Chroma: vektorsök topp-50 + $not_contains(exclude)
embedda [e5-small, "passage:"]       │
  │                                  ▼
  ▼                                klientfilter: exclude mot RÅ-receptet
Chroma (cosine, HNSW)                │
                                     ▼
                                   omranka: likhet + 0,05 × include-träffar → topp N
```

Nyckelval:

- **Retrieval, inte generation.** Uppgiften tolkas som sökning i de 173 278
  befintliga recepten (verbet är "söka", svaret är "receptet" i bestämd form).
  Generation väljs bort: hallucinationsrisk utan värde när svaret finns i samlingen.
- **Exclude i två lager.** Chromas `$not_contains` filtrerar billigt i databasen;
  klientlagret dubbelkollar mot rå-receptets namn + ingredienser och fångar det
  serverfiltret missar (skiftläge, text som rensningen strippat, t.ex.
  parentesinnehåll).
- **Semantik och logik separerade.** Embeddingen svarar på "vad handlar rätten
  om"; include/exclude hanteras som filter och boost. Fynd 3 visar varför:
  embeddings kan inte uttrycka negation.

## AI-komponenter och motiv

*(kravet "dokumentera vilka aspekter av AI du använt och varför")*

**1. Flerspråkiga embeddings — `multilingual-e5-small`, lokalt via transformers.js.**
Recept och frågor projiceras i samma vektorrum oavsett språk; det är så
språkkravet löses utan översättningssteg i grundflödet. Modellen kör lokalt →
granskaren behöver ingen nyckel för kärnfunktionen. Trade-off: e5-small har ett
mätt cross-lingualt kvalitetstapp för svenska (fynd 2: 0.874 → 0.806) — det
kompenseras av att LLM-steget översätter frågan till engelska, så gapet träffar
bara fallback-vägen. En större modell (e5-base/large) eller API-embeddings
hade minskat gapet till priset av timmars ingest respektive nyckelkrav.

**2. LLM-frågetolkning — Claude Haiku via Anthropic-API:t.**
Fritext på valfritt språk → strukturerad plan `{description, include, exclude}`
på engelska, via forcerat verktygsanrop med `strict: true` (garanterat
schemagiltig utdata, ingen parsning av fritext). Motivet är fynd 3: embeddings
misslyckas totalt med negationer ("pasta utan tomat" gav tomatpasta som
förstaträff i prototypen) eftersom en vektor sammanfattar vad texten *handlar
om* — "utan" är logik och får ingen plats i punkten. Det går inte att träna
bort med större embeddingmodell; det kräver ett logiklager. LLM:en löser
samtidigt översättning och tolkar kulinarisk intention ("vegetarisk" →
exclude kött/fisk). LLM-utdata behandlas som opålitlig indata: zod-valideras
och normaliseras trots strict-garantin.

**3. Vektordatabas — Chroma (Docker) med HNSW-index.**
Prototypens brute force-sökning uppmättes till ~2–6 ms för 1 000 recept →
~0,5 s för hela datasetet (fynd 5). HNSW ger approximativ närmaste-granne-sökning
i millisekunder oavsett skala, plus persistens och dokumentfilter.

**4. Medvetna bortval.**
*Generation* (se Arkitektur). *Chunking* — ett recept är ett naturligt
sammanhållet dokument; att dela det tillför inget. *Reranking-modell* — den
enkla boost-omrankningen räcker för topp-5-kvaliteten i utvärderingen; en
cross-encoder hade adderat latens och beroenden för marginell vinst i detta
dataset.

**Kalibrerade värden.** Ingrediensboosten 0,05 per träff är vald med
`npm run eval` (planen hålls konstant, endast vikten varieras):
0 → 3/5, 0,03 → 4/5, **0,05 → 5/5**, 0,10 → 5/5 fullmatchade i topp 5.
Lägsta värde med full träff valdes — 0,10 riskerar att lexikala träffar kör
över semantiken (3 träffar = +0,3, mer än hela poängspridningen).

## Robusthet

- **Graceful degradation:** utan API-nyckel (eller vid timeout/nätfel/429)
  loggas en varning och frågan går rå till den flerspråkiga embeddingen —
  sökningen svarar alltid, med dokumenterat kvalitetstapp i stället för fel.
  `interpretedBy` i svaret visar vilken väg som togs.
- **Validering vid gränserna:** zod-scheman för både API-indata (fältvisa
  400-fel) och det scrapade datasetet (ogiltiga rader räknas och hoppas över,
  ~8 % av raderna).
- **Resumbar ingest:** stabila ID:n (`_id.$oid`) + befintlighetskontroll per
  batch — en kraschad körning fortsätter där den var, utan omembeddning.
- **Latensbudget:** LLM-anropet har timeout (10 s) och max 1 retry innan
  fallback; embeddingmodellen värms upp vid serverstart.

**Kända begränsningar** (avsiktligt dokumenterade):

- ~29 % av datasetets recept har trasiga ingredienslistor från scrapingen
  (fynd 1; enbart mängder, inga namn — värst tastykitchen 67 %). För dessa
  bär namn + beskrivning söktexten, och exclude-filtret kan inte verifiera
  ingredienser som inte står i texten ("Pasta Puttanesca" med trasig lista
  passerar ett tomatfilter).
- Exclude-matchningen är substräng på engelska ingrediensnamn: "milk"
  utesluter även "buttermilk" (konservativt åt rätt håll för allergier),
  men synonymer/hyperonymer expanderas inte utöver vad LLM:en anger.
- LLM-tolkningen är icke-deterministisk: samma fråga kan ge lätt olika planer
  mellan anrop. Systempromptens exempel styr mot konservativa exclude
  (upptäckt: "mjölk" ≠ "mjöl" krävde explicit instruktion).
- I fallback-läget gäller prototypens fynd 2: svenska frågor fungerar men
  rankar sämre än engelska.

## Molndeploy

En live-instans kör på en Hetzner-VPS (CPX22: 2 vCPU, 4 GB RAM):
**http://204.168.246.42:3000** — t.ex. `GET /health` eller curl-exemplen ovan
mot den adressen. Deployen är exakt samma docker compose som lokalt
(`docker compose up -d --build`), med det lokalt byggda Chroma-indexet
uppladdat till servern (ingen om-ingest) och API-nyckeln i serverns `.env`.

## Tester

```bash
npm test        # 18 enhetstester (rensning, fallback-kontrakt, API-validering) — inga stödsystem krävs
npm run eval    # golden-frågor mot riktiga stacken + boost-kalibrering — kräver Chroma + ingest (+ nyckel)
```

Evalen asserterar bl.a. att negationsfrågor aldrig returnerar den uteslutna
ingrediensen och att svensk/engelsk formulering av samma fråga ger samma träffar.

## Stackval

TypeScript + Express valdes för produktivitet och typsäkerhet genom hela
kedjan (zod-scheman delar typer med koden). Det ärliga motargumentet: Python
med FastAPI hade gett störst AI-ekosystem (sentence-transformers, LangChain,
utvärderingsverktyg) och är fältets lingua franca — för ett team med
AI-tyngdpunkt vore det sannolikt rätt val. Här är helheten viktigare:
transformers.js, Chroma-klienten och Anthropic-SDK:n täcker behoven fullt ut,
och spårbarheten typ-nivå från API-kontrakt till datamodell väger tungt för
robusthetskriteriet.
