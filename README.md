![OMAI](bilder/omai_F46B63.png)

# ARBETSPROV - Recept

## Uppgift
Din uppgift är att bygga ett REST-baserat API som kan söka efter recept, givet ett antal ingredienser eller en beskrivning av vad man vill laga. 

Till din hjälp finns en receptsamling i JSON-format 20170107-061401-recipeitems.json.zip.

Här är ett exempel:
```json
{
   "_id": {
       "$oid": "54f3bb3696cc622a52715210"
   },
   "name": "Coconut fish curry",
   "ingredients": "2 red chillies\npinch dried chilli\n2 tbsp vegetable oil\n½ lemon\nhandful fresh coriander\n2 tbsp vegetable oil\n½ onion\n1 garlic\n1 handful peeled and chopped sweet potato\n1 tsp curry powder\n1 tsp cumin\n85g/3oz cod or pollack\n½ tin coconut milk\n1 handful baby spinach\n½ lime\n, to taste salt\n2 tbsp chopped fresh coriander",
   "url": "http://www.bbc.co.uk/food/recipes/coconutfishcurry_89979",
   "ts": {
       "$date": 1425259318950
   },
   "cookTime": "PT30M",
   "source": "bbcfood",
   "recipeYield": "Serves 1",
   "prepTime": "PT30M"
}
```

## Krav
- Det ska tydligt framgå hur programmet startas, vilka beroenden den har och eventuella stödsystem
- API:ets ska kunna hantera indata på flera språk men behöver bara svara med receptet på engelska
- Dokumentera vilka aspekter av AI du använt och varför
- Godkända programmeringspråk är: Java, C#, JavaScript/TypeScript, Python

## Leverans
- Zip-fil med källkod och dokumentation eller - 
- länk till ett Github repo.
- Om du gjort en lösning deployad i molnet en länk till tjänsten

## Utvärderingskriterier
- Kodkvalitet 
- Lösningens robusthet
- Arkitektur
- Användningen av AI-teknologier

Lycka till!
