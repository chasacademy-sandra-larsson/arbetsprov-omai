# Prototyp: semantisk receptsökning i minnet

> Detta är **förstudien**. Den pedagogiska genomgången av fynden finns i
> [`../PROTOTYP.md`](../PROTOTYP.md) och den riktiga lösningen i [`../api/`](../api/).

Miniprototyp för att förstå retrieval-pipelinen innan riktiga lösningen byggs.
~1 000 recept (var 173:e rad ur datasetet), embeddade med `multilingual-e5-small`
via transformers.js, brute force-cosine i minnet. Ingen server, ingen vektordatabas.

## Körning

```bash
npm install
npm run ingest                      # samplar, rensar, embeddar (~40 s, laddar ner modell första gången)
npm run search -- "krämig kycklinggryta"
```

## Fynd (2026-08-18)

1. **29 % av datasetet har trasiga ingredienslistor** — scraping-fel i källdatat:
   tastykitchen (67 % trasiga, 66 700 recept) och epicurious (49 %) innehåller bara
   mängder ("2 whole 2 whole…"), inga ingrediensnamn. Hantering: falla tillbaka på
   namn + beskrivning för dessa. Måste hanteras och dokumenteras i riktiga lösningen.

2. **Flerspråkigheten fungerar men med kvalitetstapp.** "creamy chicken stew with
   mushrooms" → topppoäng 0.874 och träffsäkra resultat. Samma fråga på svenska →
   0.806 och klart sämre träffar. e5-small har ett verkligt cross-lingualt gap;
   argument för större modell (e5-base/large), API-embeddings, eller ett
   översättningssteg i frågeledet.

3. **Negationer misslyckas totalt.** "pasta utan tomat" → förstaträffen är "One Pot
   Pasta" med både tomater och tomatsås. Embeddings ser "tomat" som närhet, inte
   "utan" som uteslutning. Starkaste argumentet för LLM-frågetolkning → hårda
   exclude-filter i riktiga lösningen.

4. **Poängen klumpar ihop sig** (~0.80–0.87 för allt). Cosine-poäng från e5 är inte
   kalibrerade sannolikheter — de duger till rankning men inte som absolut
   "relevanströskel" utan egen kalibrering mot testfrågor.

5. **Brute force räcker långt men inte hela vägen.** ~2–6 ms för 1 000 recept →
   uppskattningsvis ~0,5 s för alla 173 278 i enkel-trådad JS. Motiverar
   ANN-index (HNSW via t.ex. Chroma) i riktiga lösningen — eller åtminstone
   optimerad matrisberäkning.

## Strategi för den riktiga lösningen

**Tolkning av uppgiften:** retrieval, inte generation — semantisk sökning i de
173 278 befintliga recepten (R:et i RAG utan G:et). Svaret är alltid ett
existerande recept. Uppgiftstexten kan missläsas som receptgenerering; tolkningen
motiveras av att (1) verbet är "söka", (2) kravet lyder "svara med receptet"
i bestämd form, (3) ett dataset på 173k recept signalerar att retrieval är
uppgiften. Generation väljs bort: hallucinationsrisk utan värde när svaret
redan finns i samlingen.

**Arkitektur — hybrid sökning i två separata pipelines:**

1. *Ingest (offline, en gång):* streama NDJSON → rensa/normalisera
   ingrediensfritext → fallback namn + beskrivning för de 29 % trasiga →
   embedda med flerspråkig modell → indexera i Chroma (Docker, stödsystem).
2. *Sökväg (online, per anrop):* Express-API tar fritext och/eller
   ingredienslista → embedda frågan med samma modell → vektorsökning topp-K →
   boost/filter på faktiska ingrediensträffar → returnera recept.

**AI-komponenter och motiv (till dokumentationskravet):**

- *Flerspråkiga embeddings* löser språkkravet geometriskt — inget
  översättningssteg behövs. Fynd 2 visar dock kvalitetstapp för svenska med
  e5-small → modellval är ett öppet beslut.
- *LLM-frågetolkning* (lutar åt ja): fritext → strukturerat
  `{include, exclude, description}`. Motiveras av fynd 3 — embeddings klarar
  inte negationer. Graceful degradation: fallerar LLM:en går frågan rakt till
  embeddingen, och flerspråkigheten fungerar ändå.
- *Medvetna bortval:* ingen chunking (ett recept = ett naturligt dokument),
  ingen generation (se tolkningen), ev. ingen reranking. Bortvalen dokumenteras
  med motivering — det visar förståelse, inte snålhet.

**Stack:** TypeScript + Express (vana och produktivitet), transformers.js för
lokala embeddings, Chroma i Docker. Dokumentationen ska samtidigt argumentera
att Python/FastAPI vore starkast för AI-ekosystemet — valet är medvetet.
Chroma motiveras med fynd 5 (brute force ≈ 0,5 s vid full skala).

**Öppna beslut:** embeddingmodell (större e5 lokalt vs API), LLM i frågeledet
ja/nej och vilken, samt viktningen mellan ingrediensmatchning och semantik.

## Filer

- `src/embedder.ts` — modell + cosine; notera e5:s obligatoriska `query:`/`passage:`-prefix
- `src/ingest.ts` — offline-pipelinen: sampla → rensa → embedda → spara `data/index.json`
- `src/search.ts` — online-pipelinen: embedda frågan → cosine mot alla → topp 5
