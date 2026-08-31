# Map Data Provider

Świadomy-źródeł dostawca danych geoprzestrzennych dla Steel Sentinel v2 i innych klientów GIS.

Głównym celem jest przygotowanie zaufanych, świadomych-źródeł danych infrastrukturalnych dla [Steel Sentinel v2](../steel-sentinel-v2) dla wybranych obszarów zainteresowania. Projekt udostępnia warstwy infrastruktury oparte na OSM, zbuforowane migawki danych, metadane źródeł, raporty walidacji, oceny wiarygodności i interfejsy API warstw mapowych przez reużywalny kontrakt dostawcy.

## Licencja

To repozytorium portfolio udostępnia kod źródłowy, lecz nie jest oprogramowaniem open source. Kod objęty jest licencją [PolyForm Strict 1.0.0](./LICENSE): dozwolone jest użycie niekomercyjne i edukacyjne; redystrybucja, modyfikacja i użycie komercyjne są zabronione. [Wyjątek oceny portfolio](./PORTFOLIO_EVALUATION_EXCEPTION.md) dodatkowo pozwala potencjalnym pracodawcom i rekruterom na inspekcję, klonowanie i lokalne uruchomienie projektu wyłącznie w celu oceny kandydatury Roberta Lachety. Licencja dotyczy oryginalnego kodu, dokumentacji i fixture'ów przeglądowych stworzonych przez projekt. Dane osób trzecich zachowują własne warunki; zob. [Licencjonowanie danych i atrybucja](./DATA_LICENSES.md).

## Czym jest ten projekt

Map Data Provider przygotowuje analityczne warstwy mapowe z dostępnych źródeł publicznych dla obszaru zainteresowania i domeny infrastruktury. Normalizuje je do stabilnego kontraktu, buforuje migawki do odtwarzalnych dem, waliduje geometrię i atrybuty oraz eksponuje metadane gotowości dla odbiorców.

Repozytorium skupia się na warstwie dostawcy upstream: pobieraniu, buforowaniu, walidacji, ocenianiu i wyjaśnianiu warstw infrastruktury zanim użyje ich Steel Sentinel v2 lub inny klient GIS.

Główne odpowiedzialności:

- Przygotowanie warstw infrastruktury dla AOI.
- Pobieranie OSM/Overpass i buforowane migawki.
- Normalizacja GeoJSON dla klientów GIS.
- Atrybucja źródeł, wiarygodność i metryki gotowości.
- Źródła WMS w stylu KIUT/GESUT jako nakładki referencyjne gdzie dostępne.
- Warstwy seed jako jawnie nieautorytatywne dane przeglądowe.
- Kontrakty API dla konsumentów danych mapowych.

## Główny konsument: Steel Sentinel v2

Steel Sentinel v2 jest głównym konsumentem tego dostawcy. Map Data Provider przygotowuje i dokumentuje produkt danych; Steel Sentinel v2 konsumuje go w swoim własnym repozytorium aplikacji. Kontrakt dostawcy pozostaje reużywalny dla innych klientów GIS.

```text
Map Data Provider
  -> pobieranie i przetwarzanie AOI i domeny
  -> wektory oparte na OSM
  -> zbuforowane migawki
  -> walidacja i wiarygodność
  -> raporty gotowości
  -> eksport GeoJSON/API dla odbiorców

Steel Sentinel v2
  -> mapa, analiza lub produkt danych
  -> konsumuje dane wyjściowe świadome-źródeł
```

Zamierzony kontrakt pozwala Steel Sentinel v2 żądać warstw infrastruktury dla wybranego AOI bez posiadania zapytań Overpass, reguł tagowania specyficznych dla źródeł, ograniczeń KIUT/WMS, logiki buforowania czy gotowości danych.

## Przepływ demo dostawcy

1. Uruchom offline weryfikację dostawcy i uruchom Node/Express API.
2. Żądaj zbuforowanych warstw dla dowolnej z dziewięciu wymaganych domen lub opcjonalnych domen `telecom` i `district_heating` (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`, `telecom`, `district_heating`) przez read-only endpointy API lub eksport wielodomenowy (`GET /api/aoi/:aoiId/export?domains=...`).
3. Sprawdź otagowane-źródłem GeoJSON, metadane, wyniki domeny i rekordy gotowości.
4. Porównaj analityczne, manualne i tylko-referencyjne klasyfikacje źródeł.
5. Sprawdź wygenerowane dowody problemów, stan przeglądu ludzkiego i metadane obiektów w podglądzie deweloperskim.
6. Wyeksportuj `provider_multi_domain_export/v2` dla Steel Sentinel v2 i innych klientów GIS.

Śledź [3–5 minutowe demo dostawcy](./docs/demo.md) dla dokładnych komend i reprezentatywnych wyników.

## Scenariusz demonstracyjny

```text
Scenariusz: Steel Sentinel v2 żąda świadomych-źródeł wielodomenowych warstw infrastruktury

Steel Sentinel v2 żąda dowolnego podzbioru dziewięciu wymaganych domen (power, emergency, public,
transport, bridges, water, gas, sewer, industrial) i opcjonalnych domen telecom i district-heating
dla AOI Rybnik.
Map Data Provider zwraca zbuforowane, znormalizowane warstwy analityczne z ich metadanymi,
wynikami domeny i rekordami gotowości.
Dostawca eksponuje atrybucję źródeł, liczby obiektów, status walidacji, wiarygodność i znane ograniczenia.
Jego rejestr źródeł odróżnia dane manualne i referencje WMS KIUT/GESUT od wektorów analitycznych.
Zwrócony pakiet warstw jest gotowy dla Steel Sentinel v2; integracja po stronie konsumenta pozostaje w tamtym repozytorium.
```

To scenariusz przygotowania danych-dostawcy w pierwszej kolejności. Steel Sentinel v2 pozostaje odpowiedzialny za konsumowanie wynikowego produktu danych.

## Stos technologiczny

- Provider API: Node.js, Express, TypeScript
- Worker geoprzestrzenny: Python 3.14, OSMnx, GeoPandas, Shapely
- Frontend: React, TypeScript, Vite, MapLibre GL JS i PMTiles podgląd deweloperski
- Dane geoprzestrzenne: kanoniczne artefakty GeoJSON oparte na OSM, pochodne archiwa prezentacji MVT/PMTiles, zbuforowane migawki i nakładki referencyjne
- Narzędzia danych: katalog warstw, problemy z jakością danych, raporty walidacji, metadane źródeł, model wiarygodności i gotowości

## Kierunek architektury

Dostawca używa hybrydowej architektury serwisowej:

```text
Klient GIS / Przeglądarka
       │
       ▼
Node.js Express Provider (REST API + strumieniowanie PMTiles + statyczne zasoby SPA)
       │
       ▼
Python Geospatial Worker (OSMnx / GeoPandas / Shapely / PMTiles CLI)
```

Ten podział jest celowy. Node/Express/TypeScript odpowiada za REST API, orkiestrację cache, walidację żądań i kontrakty TypeScript. Python pozostaje warstwą przetwarzania, ponieważ ekosystem OSM/geoprzestrzenny wokół OSMnx, GeoPandas i Shapely jest mocniejszy do ekstrakcji, przycinania i walidacji geometrii.

Zob. [dokumentację architektury](./docs/architecture.md) dla aktualnego projektu dostawcy, kontraktów i granic API.

## Dlaczego to nie jest klon OpenInfraMap

[OpenInfraMap](https://openinframap.org/about) to widok infrastruktury zmapowanej w OpenStreetMap. To repozytorium rozwiązuje inny problem: przygotowuje produkt danych dostawcy z zakresem AOI. Normalizuje obiekty OSM do wersjonowanego kontraktu dostawcy, zachowuje proweniencję, waliduje jakość danych, rejestruje wiarygodność/gotowość i decyzje przeglądowe oraz eksportuje reprodukowalny pakiet warstw dla innej aplikacji.

Podgląd deweloperski jest powierzchnią inspekcji dla tego przepływu dostawcy, a nie próbą reprodukcji globalnej mapy bazowej infrastruktury ani doświadczenia kartograficznego OpenInfraMap.

## Zakres produktu

Podstawowe możliwości dostawcy:

- Ustawienia AOI MapLibre z selekcją punkt/promień lub ograniczonymi polskimi wyborami administracyjnymi, w tym deterministyczną unią powiatów i gmin z etykietami PRG.
- Skatalogowane profile runtime AOI dla dziewięciu wymaganych domen plus opcjonalne `telecom` i `district_heating`. Telecom rozróżnia jawnie oznakowane wieże/maszty, obiekty i linie; ciepłownictwo rozróżnia jawnie oznakowane elektrociepłownie, wymienniki ciepła i linie sieciowe. Brakujące linie pozostają widocznymi lukami źródłowymi, podczas gdy KIUT telecom i ciepłownictwo są tylko-referencyjne. Istniejące pakiety fixture Rybnik pozostają jawnym fallback'iem demo; niedostępne dane AOI są raportowane jako luka źródłowa, nigdy jako puste wektory analityczne.
- Katalog warstw ze źródłem, typem geometrii, AOI, liczbą obiektów, wiarygodnością i metadanymi dostępu.
- Zbuforowane artefakty warstw opartych na OSM, dzięki czemu normalne odczyty nie zależą od dostępności Overpass na żywo.
- Świadome-źródeł metryki walidacji i gotowości, które sprawiają, że ograniczenia danych są widoczne zamiast ukryte.
- Wyjaśnialne problemy z jakością danych i trwały przepływ pracy stanu przeglądowego.
- Stabilny kontrakt API/eksport dla klientów GIS.
- Podgląd deweloperski MapLibre z lokalnymi odczytami zakresu PMTiles, przełącznikami warstw i inspekcją obiektów.
- Dokumentacja wyjaśniająca wektory OSM, nakładki referencyjne KIUT/GESUT, ziarna manualne i weryfikację QGIS.

## Lokalne środowisko deweloperskie

### Pełne lokalne demo Rybnik

Pełna migawka Rybnik jest celowo poza Git. Skopiuj zweryfikowany bundle raz do ignorowanego katalogu `.local-demo-bundle/`, a następnie uruchom dostawcę względem tego katalogu:

```bash
./scripts/pull_local_demo_bundle.sh \
  root@VPS:/home/deploy/map-data-provider/data/bundle/rybnik_35km
pnpm run demo:local
```

W drugim terminalu uruchom frontend jak zwykle:

```bash
pnpm --dir frontend run dev
```

`pnpm run demo:local` ustawia `MDQ_PREPARED_ROOT` na zweryfikowany lokalny bundle i uruchamia API w trybie `local_bounded`. Pozwala na istniejące ograniczone przepływy pracy punkt/promień i PRG do przygotowania przez operatora; nie wystawiaj tego trybu na publicznym hoście. Jeśli obecny jest tylko częściowy cache, podgląd jawnie wymienia brakujące podstawowe domeny zamiast prezentować to jako kompletne demo Rybnik.

Bundle musi być wyprodukowany przez bieżący `scripts/prepare_demo.sh`: zawiera teraz checksum-walidowany `snapshot_manifest.json` wiążący wszystkie opublikowane pakiety domen. Zbuduj ponownie bundle sprzed MDQ-057 tym poleceniem przed importem lub wdrożeniem; API i bootstrap kontenera celowo odrzuca starszy bundle bez tego rekordu publikacji.

Z uruchomionym API użyj drugiego terminala do wygenerowania reprodukowalnego, datowanego raportu pomiarowego API/PMTiles/worker:

```bash
pnpm run measure:demo
```

Raport zawiera 100 żądań na każdy główny endpoint, opóźnienie p50/p95/p99, rozmiary odpowiedzi zakresu PMTiles, wyniki rewalidacji ETag i izolowane metryki przygotowania fixture workera. Zob. [pomiary dostawy](./docs/performance_baseline.md) dla dokładnej metody i granic interpretacji. Gdy jego datowany JSON jest zacommitowany i wdrożony z pasującym zewnętrznym bundle'm, podgląd eksponuje zwarty wynik przez ikonę szyny **Delivery evidence** i linkuje do surowego raportu.

Serwis Node provider:

```bash
cd backend-node
pnpm install
pnpm run dev
```

Frontend:

```bash
cd frontend
pnpm run dev
```

Otwórz `http://localhost:5173`.

## Endpointy Node provider

- `GET /api/health`
- `GET /api/metrics/delivery`
- `GET /api/metrics/delivery/raw`
- `GET /api/aoi/catalog`
- `POST /api/aoi/catalog/boundary`
- `POST /api/aoi/runtime-requests/preflight`
- `POST /api/aoi/runtime-requests`
- `POST /api/aoi/runtime-jobs`
- `GET /api/aoi/runtime-jobs/:jobId`
- `POST /api/aoi/requests` (stara ścieżka kompatybilności `rybnik_35km/power`)
- `GET /api/aoi/:aoiId/layers`
- `GET /api/aoi/:aoiId/layers/:domain`
- `GET /api/aoi/:aoiId/readiness`
- `GET /api/aoi/:aoiId/sources`
- `GET /api/aoi/:aoiId/source-availability`
- `GET /api/aoi/:aoiId/issues`
- `PATCH /api/aoi/:aoiId/issues/:issueId/review`
- `GET /api/aoi/:aoiId/domain-packs`
- `GET /api/aoi/:aoiId/domain-packs/:domain`
- `GET /api/aoi/:aoiId/export?domains=...`
- `GET /api/aoi/:aoiId/presentations`
- `GET /api/aoi/:aoiId/presentations/:domain`
- `GET /api/aoi/:aoiId/presentations/:domain/features/:sourceId`
- `GET /api/aoi/:aoiId/presentations/:domain/features/:sourceId/circuits`
- `GET /api/aoi/:aoiId/presentations/:domain/circuits/:circuitId`
- `GET /api/aoi/:aoiId/presentations/:domain/archive` (wymaga nagłówka HTTP `Range`)

Dowody problemów są generowane przez wersjonowane reguły jakości i pozostają oddzielone od persystowanej ludzkiej decyzji przeglądowej. Aktualizacje przeglądowe obsługują `open -> acknowledged -> resolved | accepted | ignored`; zniekształcone lub nieprawidłowe przejścia zwracają `422`, podczas gdy nieaktualne równoczesne aktualizacje zwracają `409` i muszą być ponowione ze świeżo załadowanego stanu.

Ścieżka runtime Node akceptuje punkt/promień `provider_aoi_request/v2` lub wybór administracyjny plus żądane kategorie. Wyprowadza deterministyczną tożsamość żądania/cache, koalescuje równoważne lokalne żądania i reużywa świeży lokalny wynik runtime przez 24 godziny.

## Wdrożenie produkcyjne i demo na żywo

Map Data Provider jest wdrożony jako pojedynczy wieloetapowy kontener za instancją VPS Nginx Proxy Manager pod adresem **`maplab.robertlacheta.pl`**.

### Polityka akwizycji runtime

`MDQ_RUNTIME_MODE` jest autorytatywna i działa fail-closed: brakująca wartość oznacza `disabled`, a nieznana wartość zatrzymuje serwis podczas uruchamiania. Obsługiwane wartości to `disabled`, `demo_fixed_aoi`, `local_bounded` i `trusted`.

- `disabled` — serwuje tylko przygotowane dane. Jest to wartość domyślna fail-closed; nie włącza żadnej akwizycji.
- `demo_fixed_aoi` — publiczne ustawienie VPS opisane poniżej. Eksponuje wyłącznie jeden stały, skoalescowany endpoint akwizycji; każde inne żądanie akwizycji lub wymuszenia odświeżenia jest odrzucane z typowaną odpowiedzią `demo_aoi_restricted` (HTTP 403).
- `local_bounded` — przeznaczony dla maszyny dewelopera/operatora. Zachowuje istniejące ograniczone guardy punkt/promień i PRG do przygotowywania danych wejściowych Steel Sentinel. Nie wystawiaj tego trybu na publicznym hoście.
- `trusted` — dla nieinternetowej integracji operatora/serwisu. Wymaga `MDQ_TRUSTED_ACQUISITION_TOKEN` jako tokena bearer skonfigurowanego poza przeglądarką; nie jest to tryb demo publicznego.

Wszystkie akwizycje pozostają cache-first, a kanoniczne równoważne joba są koalescowane. Świeże zbuforowane wyniki są reużywane przez 24 godziny; częściowe wyniki pozostają jawnym dowodem źródłowym per-domena, a każda migawka jest datowana źródłowo, nigdy nie jest twierdzeniem o stanie infrastruktury na żywo lub kompletności.

- **Kontrolowana akwizycja demo**: Produkcja używa `MDQ_RUNTIME_MODE=demo_fixed_aoi` i eksponuje tylko `POST /api/aoi/demo-acquisitions/rybnik_gmina_demo`. Serwer ustala AOI na PRG Rybnik gmina (`gmina_2473011`) i profile na `power`, `emergency`, `public` i `transport`; nie akceptuje ani koordynat, ani wybranego przez klienta profilu lub opcji wymuszenia odświeżenia. Ogólne endpointy runtime zwracają typowane `demo_aoi_restricted` (HTTP 403).
- **Jawna polityka runtime**: `GET /api/aoi/runtime-capabilities` deklaruje aktywną politykę. `disabled` jest domyślnym fail-closed; `local_bounded` włącza istniejący ograniczony lokalny przepływ pracy; `trusted` dodatkowo wymaga tokena bearer skonfigurowanego poza przeglądarką.
- **Przygotowane migawki i dostępność**: `GET /api/aoi/snapshots` wyświetla tylko checksum-walidowane publikacje operatora. `POST /api/aoi/availability` akceptuje ograniczony okrąg lub wybór PRG i zwraca `ready`, `partial_coverage`, `not_prepared`, `queued`, `running` lub `failed`; nieidentyczne geometryczne nakładanie się jest celowo nigdy nie reklamowane jako pełne pokrycie. Normalne odczyty PMTiles, szczegółów obiektów i eksportu używają wyłącznie opublikowanego lokalnego pakietu i nigdy nie wywołują Overpass ani Python.
- **Dowód akwizycji runtime**: Przed oznaczeniem nowo pobranego AOI jako opublikowanego, pipeline zapisuje `acquisition_evidence.json` obok jego przygotowanego pakietu. `GET /api/aoi/:aoiId/metrics/acquisition` zwraca jego datę źródłową, liczby per-domena, walidację, czas przygotowania i wersję pipeline'u (lub typowane `404` gdy dowód nie istnieje). Frontend oznacza to jako dowód proweniencji/jakości, nie benchmark dostawy.
- **Provider API**: Node.js 22 Express provider serwuje wszystkie trasy REST, odczyty zakresu PMTiles i zasoby frontendowe SPA.
- **Silnik geoprzestrzenny**: Python 3.14 + `uv` worker CLI obsługuje offline przygotowanie danych i bootstrap uruchamiania.
- **Zewnętrzna migawka**: Pełna migawka Rybnik jest operatorsko-przygotowanym, checksum-zweryfikowanym bundle'm demo, nie danymi commitowanymi do Git. Kontener waliduje i atomowo promuje ją do przygotowanego magazynu przed obsługą żądań.
- **Granica runtime**: Publiczne demo może zademonstrować jedno skoalescowane, cache-first stałe żądanie. Dowolna akwizycja AOI pozostaje lokalna/tylko-operatorska, więc odwiedzający nie mogą zamienić VPS w otwarty proxy Overpass.
- **Przewodnik wdrożenia**: Zob. [docs/deployment.md](docs/deployment.md) dla Nginx Proxy Manager/Cloudflare, konfiguracji katalogów i instrukcji rollback.

## Weryfikacja

Zainstaluj obsługiwane zależności raz:

```bash
(cd backend && uv sync --locked --dev)
pnpm install
```

Następnie uruchom kanoniczną offline bramę jakości z katalogu głównego repozytorium:

```bash
pnpm run verify:provider
```

`pnpm install` konfiguruje śledzony natywny Git hook w `.githooks/`. Przed każdym `git push`, ten hook `pre-push` uruchamia szybsze sprawdzenia `pnpm run verify:pre-push`; pełna brama `pnpm run verify:provider` dodatkowo uruchamia pakiet testów Python i kontrolowane sondy niepowodzeń. Żadna brama nie odpytuje na żywo Overpass ani serwisów WMS.

GitHub Actions uruchamia równoważne komponenty weryfikacyjne równolegle dla każdego pull request i push do `main`: pakiet Python i smoke check, kontrolowane negatywne sondy oraz testy Node/frontend, buildy i sprawdzenia lintu. Weryfikacja aplikacji pozostaje offline po instalacji zależności i nie odpytuje na żywo Overpass ani serwisów WMS.

Brama uruchamia również sześć kontrolowanych negatywnych sond obejmujących migawki kontraktów, źródła niebezpłatne, eksport wektora WMS, stary dowód, zniekształcone pakiety domen i zniekształcone zapytania eksportu. Każda sonda celowo dostarcza nieprawidłowe dane wejściowe i oczekuje ich odrzucenia; nieoczekiwana akceptacja kończy się niepowodzeniem całej bramy.

Komendy na poziomie komponentów są dostępne do diagnostyki:

```bash
(cd backend && uv run --offline pytest -q -W error && uv run --offline python tests/smoke_check.py)
pnpm run verify:node
pnpm run verify:frontend
```

Worker Python może być również ćwiczony bezpośrednio z offline fixture:

```bash
cd backend
uv run --offline python -m geo_pipeline.worker --aoi rybnik_35km --domain power --input fixture
uv run --offline python -m geo_pipeline.worker --aoi rybnik_35km --domain emergency --input fixture
uv run --offline python -m geo_pipeline.worker --aoi rybnik_35km --domain public --input fixture
```

## Dlaczego to ma znaczenie dla narzędzi danych mapowych

Produkcyjne dane mapowe są niekompletne, heterogeniczne, zależne od źródeł i nierówne w różnych lokalizacjach. Ten projekt pokazuje praktyczny przepływ pracy przekształcania surowych publicznych danych mapowych w reużywalny kontrakt dostawcy: oznaczanie źródeł, zbuforowane migawki, walidację, metadane, wiarygodność, raporty gotowości i API warstw mapowych dla klientów GIS.

Kluczowa wartość produktu to przenośność. Klient GIS może być skierowany na nowy AOI i żądać warstw infrastruktury, podczas gdy dostawca eksponuje czy dane OSM są użyteczne, niekompletne lub nieodpowiednie dla zadeklarowanego zastosowania.

## Atrybucja danych i nakładki referencyjne

Dystrybuowane warstwy oparte na OSM zachowują informację [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) i [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Każdy publiczny pakiet domeny oparty na OSM zawiera informację w `licenses/openstreetmap-odbl.md`, rejestruje ją w manifeście i zachowuje swój endpoint zapytania OSM, wersję zapytania, wersję pipeline'u i znacznik czasu migawki obok warstwy. Zob. [Licencjonowanie danych i atrybucja](./DATA_LICENSES.md) dla granicy całego repozytorium.

KIUT/GESUT jest przechowywany jako OGC WMS wizualna nakładka referencyjna. Obrazy WMS nie są domyślnie konwertowane do GeoJSON ani używane jako dane wejściowe analityczne. Jeśli przyszły produkt wyświetla lub redystrybuuje nakładkę, musi zachować atrybucję GUGiK/KIUT i najpierw zweryfikować aktualne metadane serwisu i warunki dystrybucji.

## Prezentacja mapy i użycie offline

Pełne artefakty `provider_geojson/v1` pozostają kanonicznymi produktami cache, walidacji i eksportu. Celowo nie są ścieżką odczytu mapy podglądu deweloperskiego dla aktualnej prezentacji `rybnik_35km` z 52 976 obiektami zasilania lub rozdzielonych-źródłowo artefaktów emergency. Dostarczona migawka Rybnik zawiera 6 796 linii, 2 379 zasobów i 43 801 podpór; te liczby są specyficzne dla migawki. Jest dystrybuowana jako zewnętrzny, checksum-zweryfikowany bundle demo zamiast jako cache repozytorium. Worker wyprowadza tylko manifest-zatwierdzone publiczne warstwy analityczne do MVT i pakuje je w sprawdzonym archiwum PMTiles `provider_map_presentation/v1`. Node zwraca kompaktowe metadane prezentacji i zakresy bajtów HTTP; MapLibre czyta lokalne archiwum bez zdalnego żądania danych wektorowych.

Prezentacja power ma oddzielne warstwy linii energetycznych, zasobów energetycznych i ograniczonych podpór energetycznych. Kolory linii zasilania używają deterministycznych kubełków napięcia. Warstwa podpór niesie klasy OSM `tower`, `pole`, `portal` i `utility_pole` gdzie obecne w dostarczonej migawce źródłowej; wieże, portale i słupy użytkowe są generowane od zoomu 12, podczas gdy zwykłe słupy od zoomu 14.

Prezentacja emergency używa czterech jawnych kategorii OSM — szpital, straż pożarna, policja i pogotowie/ratownictwo. Poligony OSM pozostają w swojej oryginalnej geometrii i mają towarzyszącą warstwę punktów inspekcji.

Prezentacja public ma oddzielne warstwy OSM administracji, edukacji, poczty i społeczności/społecznej, plus powiązane punkty inspekcji dla oryginalnej geometrii nie-punktowej.

To umożliwia publiczną inspekcję wektorową offline po zamontowaniu przygotowanej migawki lub bootstrapie z zewnętrznego bundle'u demo. Podgląd oferuje również domyślnie włączoną rasterową mapę bazową OpenStreetMap do wizualnego kontekstu online; jest wyraźnie oddzielona od danych dostawcy, może być wyłączona i jest niedostępna offline.

## Interoperacyjność QGIS

Wygenerowane artefakty GeoJSON w operatorsko-przygotowanej migawce (dla produkcji `data/prepared/rybnik_35km/`) można otwierać w QGIS do ręcznej inspekcji geometrii, atrybutów, zachowania CRS i kompletności warstw. Duża migawka jest celowo poza Git; zob. [przewodnik wdrożenia](docs/deployment.md) dla przygotowania bundle'u i magazynowania. QGIS jest używany jako referencja walidacji GIS, podczas gdy sam produkt pozostaje webową aplikacją narzędzi danych.

## Użyteczne inspiracje

- QGIS: model warstw, atrybuty, geometrie, CRS i manualna inspekcja GIS.
- GeoServer / usługi OGC: rozróżnienie między GeoJSON, WMS, WFS, kafelkami wektorowymi i metadanymi serwisu.
- MapLibre GL JS i PMTiles: zaimplementowany model odczytu podglądu WebGL/kafelka-wektorowego dla dużych, zbuforowanych publicznych warstw wektorowych.
- OpenCTI/MISP konceptualnie: modelowanie źródeł, wiarygodności, relacji i stanu przeglądowego, bez przyjmowania zakresu cyberzagrożeń.
