# Prototypen: vad jag byggde och vad den lärde mig

Det här dokumentet förklarar prototypsteget, hur tekniken fungerar,
och — viktigast — varför prototypens upptäckter visar att en ren
embeddingsökning **inte är en robust lösning**, och vad det motiverar i
den riktiga lösningen.

## Vad jag gjorde: prototyp före bygge

Innan jag byggde den riktiga lösningen byggde jag en medveten miniprototyp:
~1 000 recept (var 173:e rad ur datasetets 173 278), embeddade lokalt,
sökning med brute force-cosine i minnet. Ingen server, ingen databas.

**Varför?** För att mäta i stället för att gissa. Varje arkitekturval i den
riktiga lösningen ska kunna motiveras med ett uppmätt fynd, inte med en
tutorial jag läst.

## Tekniken, så enkelt jag kan förklara den

### 30-sekundersversionen

Jag har byggt en semantisk sökmotor för recept. I stället för att matcha ord
bokstavligt översätter en AI-modell både recepten och sökfrågan till punkter
i ett matematiskt rum, där texter som *betyder* liknande saker hamnar nära
varandra. Sökningen blir då att hitta de recept vars punkter ligger närmast
frågans punkt. Det gör att "krämig kycklinggryta" på svenska hittar
"creamy chicken stew" på engelska — utan att något ord matchar och utan
översättningssteg.

### Byggstenarna

1. **Embeddings** — modellen `multilingual-e5-small` gör om text till en
   vektor med 384 tal, valda så att lika betydelse ger liknande tal.
   Liknelse: koordinater på en karta, fast kartan har 384 dimensioner och
   avstånd betyder betydelseskillnad. Modellen är flerspråkig: svenska och
   engelska texter med samma innebörd hamnar på nästan samma plats —
   det är så språkkravet löses.

2. **Lokal modellkörning** (transformers.js) — modellen körs direkt i
   Node.js på min dator. Gratis, ingen API-nyckel, ingen data lämnar
   maskinen. Trade-off: en liten modell med mätbart sämre kvalitet på
   svenska än engelska (se fynd 2).

3. **Ingest-pipeline** (förarbetet, körs en gång) — 135 MB rådata strömmas
   rad för rad, varje recept städas ("1-1/2 stick (3/4 Cup) Cold Butter" →
   "cold butter") och görs om till en vektor som sparas i ett index.
   Som att bygga registret längst bak i en bok: det tar tid en gång,
   sen slår man upp blixtsnabbt.

4. **Cosine-likhet** (själva sökningen) — frågan görs om till en vektor med
   samma modell, sen mäts vinkeln mot varje receptvektor. Liten vinkel =
   lika betydelse = hög poäng. Viktigt: all intelligens ligger i
   översättningen till vektorer — jämförelsen är ren matematik.

### Embeddingmodell vs LLM — inte samma sak

Båda är transformer-modeller, men med olika jobb: e5 **läser** text och
sammanfattar betydelsen till en punkt (kan inte producera en mening);
en LLM **skriver** text och kan följa instruktioner och hantera logik.
e5-small har ~118 miljoner parametrar, moderna LLM:er hundratals miljarder.

Liknelse: e5 är bibliotekarien som ställer varje bok på rätt hylla och
hittar hyllgrannar på millisekunder. LLM:en är experten vid disken som
förstår vad du *menar* — men aldrig hinner läsa om hela biblioteket för
varje besökare. Rätt arkitektur använder båda i rätt ordning.

## Upptäckterna: därför är lösningen inte robust än

Prototypen fungerar — men fynden visar att ren embeddingsökning inte
räcker som inlämningsbar lösning. Det var själva poängen med att bygga den.

### Fynd 1: 29 % av datasetet har trasiga ingredienslistor

Scraping-fel i källdatat: tastykitchen (67 % trasiga, 66 700 recept) och
epicurious (49 %) innehåller bara mängder ("2 whole 2 whole…"), inga
ingrediensnamn. En lösning som litar blint på `ingredients`-fältet söker
i brus för nästan var tredje recept. **Åtgärd:** fallback på namn +
beskrivning för dessa recept.

### Fynd 2: flerspråkigheten fungerar, men med kvalitetstapp

"creamy chicken stew with mushrooms" → topppoäng 0.874 och träffsäkra
resultat. Samma fråga på svenska → 0.806 och klart sämre träffar.
Den lilla modellen har ett verkligt cross-lingualt gap. **Åtgärd:** större
modell, API-embeddings, eller ett översättningssteg i frågeledet.

### Fynd 3: negationer misslyckas totalt — det allvarligaste fyndet

Frågan `"pasta utan tomat"` gav dessa topplaceringar:

```
0.853  One Pot Pasta          — innehåller tomatoes OCH tomato sauce
0.841  Pasta Salad with Salmon, Tomatoes & Herb Dressing — tomat i namnet
0.840  Bowties with Olives    — "in a tomato sauce"
```

Tre av fem träffar innehåller exakt det användaren bad om att slippa —
och den sämsta träffen fick högst poäng.

**Varför det inte är otur utan systematiskt:** en embedding är en
sammanfattning av vad texten *handlar om*. "Pasta utan tomat" handlar om
pasta och tomat — ordet "utan" är en logisk instruktion som inte får plats
i punkten. Ju mer tomat ett recept har, desto *närmare* frågan hamnar det.

**Varför det inte går att träna bort:** begränsningen sitter i själva
representationen — en enda punkt i rummet kan inte betyda "allt utom X".
En större modell fixar svenskan (fynd 2) men aldrig detta. Lösningen kräver
ett separat logiklager: tolka frågan → `{ include: ["pasta"],
exclude: ["tomato"] }` → hårt filter på resultaten. Det är mitt starkaste
argument för LLM-frågetolkning i den riktiga lösningen.

### Fynd 4: poängen klumpar ihop sig

Allt hamnar kring 0.80–0.87. Cosine-poäng är inte kalibrerade
sannolikheter — de duger till rankning men inte som absolut
relevanströskel. Notera i fynd 3: 0.853 mot 0.840 — inget i siffrorna
avslöjar att förstaträffen är sämst. **Åtgärd:** kalibrering mot
testfrågor om trösklar behövs.

### Fynd 5: brute force skalar inte hela vägen

~2–6 ms för 1 000 recept → uppskattningsvis ~0,5 s för alla 173 278 i
enkeltrådad JS. **Åtgärd:** ANN-index (HNSW, t.ex. via Chroma) eller
optimerad matrisberäkning i den riktiga lösningen.

## Slutsatsen jag drar

Prototypen bevisar att retrieval-kedjan fungerar end-to-end och att
flerspråkig semantisk sökning löser kärnproblemet. Men den bevisar också
att en naiv lösning **inte är robust**: den söker i brus för 29 % av
datat, tappar kvalitet på svenska, svarar med tomatpasta på "utan tomat",
och skalar inte till hela datasetet.

Det är därför den riktiga lösningen designas som hybrid: ett logiklager
som tolkar frågan (negationer, översättning, struktur) framför en
semantisk vektorsökning (betydelse, flerspråkighet, skala) — där varje
komponent gör det den bevisligen är bra på, och varje val kan spåras
tillbaka till ett uppmätt fynd i det här dokumentet.
