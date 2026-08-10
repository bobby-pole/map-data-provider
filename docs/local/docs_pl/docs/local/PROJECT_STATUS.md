# Status projektu

Ostatnia aktualizacja: 2026-08-10

## Aktualny stan (snapshot)

- Aktywny cel: Brak; cele `G-003`, `G-004` i `G-005` są osiągnięte.
- Bieżący kamień milowy: przygotowanie wdrożenia portfolio.
- Aktywny ticket: Brak.
- Ostatni ukończony ticket: `MDQ-042 - Deliver District-Heating Domain Pack`.
- Następny ticket bezpieczny pod względem zależności: `MDQ-052 - Deploy Read-Only Portfolio Demo on VPS`.
- Przygotowany follow-up: `MDQ-052 - Deploy Read-Only Portfolio Demo on VPS` (`G-006`, niezależny od release traina domen G-004).
- Blokady: Brak.

## Dowody wydania (Release evidence)

- 2026-08-10 - Ukończono `MDQ-042`: dostarczono opcjonalny pakiet domeny `rybnik_60km/district_heating` oparty na fixture'ach dla Celu `G-005`. `district-heating-osm/v1` rozdziela jawne źródła ciepła, obiekty wymienników i linie sieci; elektrownia/generator wymaga jawnego dowodu wytwarzania albo źródła ciepła, zaś ogólne obiekty przemysłowe i rurociągi są wykluczane. Fixture publikuje publiczną warstwę zerową `district_heating.lines` z `readiness=needs_source`, pochodne punkty inspekcji, dowody luki źródłowej i prywatny rekord referencyjny KIUT WMS. Domena jest zarejestrowana w publikacji cache/domain-pack, ograniczonym odświeżeniu OSM runtime, schematach Node API/eksportu i podglądzie MapLibre. Testy backendowe, Node, frontend oraz offline'owa bramka dostawcy przechodzą pomyślnie; frontend zachowuje istniejące, niepowodujące błędu ostrzeżenie Vite o rozmiarze chunka.

- 2026-08-08 - Ukończono `MDQ-044`: dostarczono pakiet weryfikacji wydania i demo wieloźródłowego dla Celu `G-004`. Zjednoczono `./scripts/verify_provider.sh` jako pojedynczą bramkę weryfikującą wszystkie 9 domen (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`), zintegrowano 6 sondaży błędów (odrzucanie nie-wolnych źródeł, zakaz redystrybucji WMS jako wektora, błędne kontrakty, przestarzałe dowody, uszkodzone pakiety oraz błędne zapytania eksportowe), uzgodniono przepływ CI (`.github/workflows/provider-verification.yml`), zarejestrowano pomiary skali (171 372 obiekty, 144,8 MB GeoJSON) i zaktualizowano dokumentację. Pełna weryfikacja przeszła pomyślnie: 193 testy Python, 51 testów Node, 19 testów frontend, 6 sondaży błędów, smoke check i poprawne buildy.

- 2026-08-07 - Ukończono `MDQ-043`: dostarczono wielodomenowy workflow dla żądań AOI i eksportu. Dodano endpoint `GET /api/aoi/:aoiId/export` zwracający strukturę `provider_multi_domain_export/v2` z filtrowaniem domen, weryfikacją uprawnień do publicznego eksportu oraz podpiętym kontekstem zgłoszonych uwag (issues). Dodano przycisk pobierania JSON w interfejsie podglądu. Weryfikacja zaliczona: 46 testów Node i 19 testów frontend.

- 2026-08-07 - Ukończono `MDQ-040`: dostarczono oparte na fixture'ach i ograniczonym AOI warstwy obiektów przemysłowych OSM, terenów przemysłowych i kontekstu budynków z jawną semantyką. Dodano kontekst wojskowy przy użyciu klas BDOT10k `OT_PTKM_A` oraz danych OSM. Rozwiązano problemy conflation dla cache legacy. `industrial-osm/v2`, `geo_pipeline/industrial/v2` i `geo_pipeline/runtime/v13` poprawnie separują warstwy, wymuszają wymagane identyfikatory i z sukcesem publikują paczkę domeny v2 wraz z metadanymi porównawczymi. Weryfikacja przeszła: 192 testy Python, 45 Node, 19 frontend oraz udane smoke checki UI.

- 2026-08-07 - Rozpoczęto `MDQ-040`: weryfikacja akwizycji pakietu domeny przemysłowej. Skorygowano propagację właściwości fixture OSM, aby spełnić wymagania kontraktu GeoJSON dotyczące wyciągania z dziedziczonego cache'u i normalizacji.

- 2026-08-07 - Ukończono `MDQ-039`: dostarczono oparte na fixture'ach i ograniczonym AOI obiekty/rurociągi kanalizacyjne OSM z jawną semantyką sewer/wastewater, pochodnymi punktami inspekcji, kanalizacją KIUT jako overlayem wyłącznie referencyjnym oraz widocznymi ograniczeniami kompletności źródła. `sewer-osm/v2`, `geo_pipeline/sewer/v2` i `geo_pipeline/runtime/v12` odrzucają infrastrukturę ogólną, wodną, gazową, deszczową i drenażową, unieważniają niebezpieczne wyniki oraz publikują paczkę domeny v2 i prezentację PMTiles. Pełna weryfikacja providera przeszła: 188 testów Python, 45 Node, 19 frontend, smoke check i oczekiwany contract-failure probe. Jedyną obserwacją z builda jest istniejące, niepowodujące błędu ostrzeżenie Vite o rozmiarze chunka.

- 2026-08-07 - Ukończono korektę semantyki `MDQ-037`: `water-osm/v2` i `geo_pipeline/water/v2` pobierają i normalizują wyłącznie jawną semantykę wody. Ogólne rurociągi i pompownie bez tagów water, w tym reprezentacje gazu i kanalizacji, są odrzucane. `geo_pipeline/runtime/v10` unieważnia przestarzałe wyniki runtime; dowód źródłowy water zapisuje regułę wykluczenia; a opis runtime power pochodzi z kanonicznego zapytania live. Pełna weryfikacja providera przeszła: 181 testów Python, 45 Node, 19 frontend, smoke check i oczekiwany contract-failure probe. Jedyną obserwacją z builda jest istniejące, niepowodujące błędu ostrzeżenie Vite o rozmiarze chunka.

- 2026-08-07 - Korygowanie `MDQ-037`: wcześniejsze zapytanie water przyjmowało ogólnych kandydatów `man_made=pipeline` i `man_made=pumping_station`, ponieważ profil tagów OSMnx stosuje semantykę OR. `water-osm/v2` pobiera teraz wyłącznie jawne tagi wody, normalizator wymaga `pumping=water` lub `substance=water` dla pompowni oraz `substance=water` dla ogólnej geometrii rurociągu, a `geo_pipeline/runtime/v10` unieważnia przestarzałe wyniki. Korekta tworzy także profil API power z kanonicznego zapytania live, aby zapobiec dryfowi deklaracji.

- 2026-08-07 - Ukończono `MDQ-038`: dostarczono oparte na fixture'ach i ograniczonym AOI obiekty/rurociągi gazowe OSM z jawną semantyką gazową, pochodnymi punktami inspekcji, gazem KIUT jako overlayem wyłącznie referencyjnym oraz widocznymi ograniczeniami kompletności źródła. `gas-osm/v2` wraz z `geo_pipeline/runtime/v9` odrzucają ogólne nieoznaczone rurociągi/zawory, unieważniają przestarzałe wyniki i pokazują w widoku przygotowania AOI liczbę kandydatów OSM, zaakceptowanych obiektów analitycznych i pochodnych punktów inspekcji. Pełna weryfikacja providera przeszła: 180 testów Python, 45 Node, 19 frontend, smoke check i oczekiwany contract-failure probe. Jedyną obserwacją z builda jest istniejące, niepowodujące błędu ostrzeżenie Vite o rozmiarze chunka.

- 2026-08-07 - Poprawiono obserwowalność runtime `MDQ-038` po tym, jak udane żądanie OSM mogło być mylone z niezmienionymi danymi renderowanymi. `geo_pipeline/runtime/v9` unieważnia wpisy stanu bez liczników i zwraca dla każdego odświeżonego wyniku liczbę kandydatów OSM, zaakceptowanych obiektów analitycznych i pochodnych punktów inspekcji; zacommitowane fixture'y zachowują jawnie niedostępne liczniki. Widok przygotowania pokazuje teraz te liczniki i wybrany promień koła. Weryfikacja ukierunkowana przeszła: 20 testów Python dla gazu/runtime, 45 testów Node oraz 19 testów frontendu, w tym build i lint.

- 2026-08-06 - Rozpoczęto `MDQ-038`: skorygowano profil pobierania OSM dla gazu po tym, jak preview ujawnił minimalny fixture kontraktowy. `gas-osm/v2` pobiera jawne tagi substancji gazowej i zaworów bez szerokiego zapytania `man_made=pipeline`, wymaga `substance=gas` dla zaworów, unieważnia tożsamość cache gazu v1 i zachowuje widoczne ograniczenie fixture'a do czasu udostępnienia datowanej migawki źródłowej całego AOI. Worker runtime waliduje teraz każdy gotowy wynik względem jego dokładnie wygenerowanego `artifact_aoi_id`, zamiast względem statycznego fixture'a Rybnika. Interfejs AOI rozróżnia świeży hit lokalnego cache od nowego pobrania OSM, a przy błędzie jawnie informuje, że migawka nie została opublikowana i zachowano dotychczas wyświetlaną mapę. Weryfikacja ukierunkowana przeszła: 19 testów Python dla gazu/runtime, 45 testów Node oraz 19 testów frontendu (w tym build i lint). Pełny skrypt dostawcy pozostaje oczekujący, ponieważ jego istniejący duży test pakietu energii nie zakończył się w tym środowisku wykonawczym.

- 2026-08-04 - Ukończono `MDQ-037`: dostarczono oparty na fixture'ach pakiet domenowy `rybnik_60km/water` z niezależnie odpytywanymi kategoriami ujęć/stacji wód, rurociągów oraz cieków wodnych OSM, wyznaczonymi punktami inspekcji reprezentatywnej dla geometrii niepunktowej, prywatnymi dowodami źródeł/kontekstu oraz jawnymi ograniczeniami kontekstu topograficznego BDOT10k. Zaktualizowano odświeżenie live workera i wersję klucza pipeline do `geo_pipeline/runtime/v7`. Weryfikacja przeszła: 172 testów Python, 43 Node i 17 frontend; smoke check oraz oczekiwany contract-failure probe.

- 2026-08-04 - Ukończono `MDQ-036`: dostarczono oparty na fixture'ach pakiet domenowy `rybnik_60km/bridges` z niezależnie odpytywanymi kategoriami mostów, wiaduktów i przejść OSM, wyznaczonymi punktami inspekcji reprezentatywnej dla geometrii niepunktowej, prywatnymi dowodami źródeł/kontekstu oraz jawnymi ograniczeniami kontekstu topograficznego BDOT10k. Zaktualizowano odświeżenie live workera i wersję klucza pipeline do `geo_pipeline/runtime/v6`. Weryfikacja przeszła: 170 testów Python, 43 Node i 17 frontend; smoke check oraz oczekiwany contract-failure probe.

- 2026-08-04 - Rozszerzono `MDQ-052` z wdrożenia statycznego VPS do ticketu dotyczącego cyklu życia artefaktów oraz mierzonej wydajności podglądu. Repozytorium zachowa wyłącznie kompaktowe fixture kontraktowe i logikę generowania/bootstrapu; pełne migawki źródeł AOI, GeoJSON, domain packi i PMTiles zostaną przeniesione do montowanego storage artefaktów zweryfikowanego checksumą. MDQ pozostaje dostawcą online dla przyszłego demo Steel Sentinel, natomiast Steel Sentinel odpowiada za oddzielny workflow pobierania i retencji kafelków/danych obiektowych offline w `SS-INT-001`.

- 2026-08-04 - Poprawiono renderowanie `MDQ-053`: kompaktowe PMTiles zachowują teraz znormalizowane `road_class`, więc MapLibre może renderować i filtrować drogi Major, Secondary, Local oraz Service zamiast odrzucać wszystkie drogi filtrem. `transport-osm/v3` unieważnia dotknięte wyniki runtime, a podgląd stale pokazuje numeryczny zoom obok instrukcji dla małego zoomu. Weryfikacja przeszła: 168 testów Python, 43 Node i 17 frontend; smoke check oraz oczekiwany contract-failure probe.


- 2026-08-02 - Ukończono `MDQ-031`: dodano wersjonowane, deterministyczne dowody porównań dla kwalifikowanych wektorów energii. Stabilne ID są preferowane, a ograniczone porównanie geometrii i `asset_type` jest wykonywane wyłącznie dla porównywalnych rekordów; wyniki konfliktu, braku odpowiednika i niejednoznaczności są przekazywane jako ustrukturyzowane issue oraz ograniczenia readiness bez łączenia obiektów. WMS, material manual-review i odrzucone źródła są jawnie nieporównywalne.

- 2026-08-02 - Ukończono `MDQ-030`: dodano datowany, cache-only raport dostępności źródeł i pokrycia AOI dla wszystkich zarejestrowanych źródeł, z oddzielnymi stanami dostępności, pokrycia, obiektów, świeżości, uprawnień i actionable source gaps. Endpoint Node i preview odczytują wyłącznie zatwierdzony raport; opcjonalne probe’y live są odizolowane od bramki offline.

- 2026-08-02 - Ukończono `MDQ-028`: dodano deterministyczny adapter ASCII Grid NMT/NMPT z checksumami rastra natywnego/przetworzonego, clippingiem EPSG:2180 bez resamplingu, walidacją CRS/rozdzielczości/nodata/AOI oraz oznaczonym kontekstem pochodnym `terrain_sample_points/v1`. Artefakty natywnych rasterów są teraz odrzucane przy publicznym eksporcie wektorowym.

- 2026-08-02 - Ukończono `MDQ-027`: dodano adapter WMS wysokorozdzielczej ortofotomapy Geoportalu oparty na fixture’ach i niezależny przełącznik referencyjny Leaflet; udostępnia opublikowane pokrycie, bezpieczeństwo stałego endpointu/warstwy i jawny brak daty/rozdzielczości metadanych bez eksportu obrazów, wektoryzacji ani pobierania. Zaakceptowany review manual-seed jest zacommitowany jako niezmieniony stan review, a nie provenance.

- 2026-08-02 - Ukończono `MDQ-026`: dodano adapter referencyjny KIUT WMS oparty na fixture’ach i przełączniki Leaflet dla sześciu warstw uzbrojenia z allow-listy, z jawnymi stanami available/uncovered/unsupported-scale/service-unavailable oraz bez eksportu obrazów analitycznych.

- 2026-08-02 - Rozpoczęto `MDQ-027`: weryfikacja metadanych oficjalnego wysokorozdzielczego WMS ortofotomapy Geoportalu i dodanie deskryptora preview typu fixture-first, wyłącznie referencyjnego.

- 2026-08-02 - Ukończono `MDQ-025`: dodano ograniczony adapter BDOT10k typu fixture-first dla GPKG/GeoParquet, zweryfikowane klasy schematu 2021, odczyty ograniczone AOI w CRS źródła, clipping EPSG:4326, manifesty checksum artefaktów, pochodzenie i jawny dryf schematu/artefaktu.

- 2026-08-02 - Rozpoczęto `MDQ-025`: implementacja adaptera BDOT10k typu fixture-first dla zweryfikowanych bieżących pobrań klas `OT_*` w GPKG/GeoParquet. GetFeatureInfo WMS pozostaje wyłącznie odkrywaniem paczek, a nie API obiektów.

- Wszystkie tickety z `G-001` mają status `Done`, posiadając specyficzne dla nich specyfikacje, plany i dowody weryfikacji.
- Pull Requesty (PRs) do cyklu wydawniczego od #3 do #16 zostały scalone z `main` z oddzielnych gałęzi zgodnie z kolejnością zależności.
- `./scripts/verify_provider.sh` przechodzi pomyślnie na `main`; PRy #15 i #16 przeszły również wspólną bramkę GitHub Actions.
- Kolejne wydanie dostawcy (provider) jest zdefiniowane w `G-004`, `MDQ-018` do `MDQ-040` oraz `MDQ-043` do `MDQ-044`; `MDQ-041` i `MDQ-042` to prace warunkowe w ramach `G-005`, natomiast integracja konsumenta Steel Sentinel pozostaje na poziomie zewnętrznym.

## Ostatnie postępy

- 2026-08-03 - Ukończono `MDQ-048`: dodano ograniczoną warstwę wsporników energetycznych OSM, ścisłą projekcję inspekcyjnych tagów OSM, deterministyczną kartografię napięć oraz pojedynczy inspektor MapLibre zasilany zwalidowanym endpointem szczegółów jednego obiektu. Generowanie MVT wsporników rozpoczyna się od zoomu 12 dla wież, portali i słupów użytkowych oraz od zoomu 14 dla zwykłych słupów; przy mniejszym zoomie przeglądarka nie dostaje pełnego zestawu wsporników. Pełna bramka offline przeszła: 140 testów Python, 37 Node i 12 frontend.

- 2026-08-02 - Ukończono `MDQ-047`: z publicznego pakietu domeny energii wyprowadzono deterministyczne warstwy MVT w lokalnym archiwum PMTiles z zakresem zoomu 7–14, walidacją checksum/provenance oraz ograniczonymi odczytami HTTP Range. Podgląd inspekcyjny MapLibre pobiera zwarte metadane prezentacji i wyłącznie widoczne zakresy kafli; kanoniczny GeoJSON/eksport pozostaje niezmieniony, a KIUT/ortofoto pozostają zewnętrznymi nakładkami WMS wyłącznie referencyjnymi. Benchmark fixture: bazowy pełny GeoJSON 29 732 815 B wobec ponownie używalnego archiwum PMTiles 13 811 248 B adresującego 5 608 kafli; początkowy odczyt mapy nie ładuje już 23 592 obiektów do JavaScript. Bramka offline, testy i kontrola w przeglądarce przeszły pomyślnie.

- 2026-08-02 - Rozpoczęto `MDQ-047`: wdrożenie artefaktu prezentacyjnego offline MVT/PMTiles i podglądu dostawcy MapLibre, z zachowaniem pełnego GeoJSON jako kanonicznego artefaktu danych/eksportu oraz WMS jako nakładki wyłącznie referencyjnej.

- 2026-08-02 - Ukończono `MDQ-032`: zmigrowano demonstrację energii dla Rybnika do wieloźródłowego pakietu domenowego z publicznymi warstwami linii i obiektów OSM, prywatnymi dowodami OSM i punktami reprezentatywnymi oraz provenance KIUT WMS zachowanym wyłącznie jako nieeksportowalna referencja walidacyjna. Bramka offline przeszła: 137 testów Python, 34 Node oraz 8 frontendu.

- 2026-08-02 - Rozpoczęto `MDQ-032`: ukończenie pionowego fragmentu energii dla Rybnika jako wieloźródłowego domain packa z zachowanym dowodem źródłowym OSM, przyciętymi warstwami analitycznymi, punktami reprezentatywnymi oraz provenance KIUT wyłącznie referencyjnego.

- 2026-08-02 - Ukończono `MDQ-024`: dodano adapter PRG WFS/GML oparty na fixture’ach, allow-listę A01–A03 i K01–K07, ustrukturyzowane stany źródła, pochodzenie EPSG:2180 oraz ograniczone przycinanie; kanoniczna weryfikacja pozostaje offline.

- 2026-08-02 - Ukończono `MDQ-029`: dodano ustrukturyzowany ewaluator dopuszczalności darmowych źródeł przed pobraniem OSM i importem cache, wymuszono go na granicach cache analitycznego/publicznego pakietu domeny oraz udowodniono offline wyniki dla darmowej rejestracji, referencji, źródeł płatnych, umownych i prawnie niejasnych.

- 2026-08-02 - Rozpoczęto `MDQ-029`: dodawanie uniwersalnej bramki kwalifikacji darmowych źródeł przed adapterami PRG, BDOT10k, KIUT, ortofotomapy oraz NMT/NMPT w release train G-004.

- 2026-08-02 - Ukończono `MDQ-045`: zrefaktoryzowano preview Leaflet do zwartego inspektora mapy/warstwy/obiektu, pozostawiono review problemów zwinięte, zachowano granicę API v2 i zweryfikowano wybór rzeczywistego obiektu w przeglądarce.

- 2026-08-02 - Rozpoczęto `MDQ-045`: uproszczenie Leaflet provider preview do zwartego workflow mapy, warstwy i inspekcji obiektu przed kolejnym adapterem źródłowym.

- 2026-08-01 - Ukończono `MDQ-023`: dodano odczyty i eksporty Node v2 ograniczone manifestem, zachowano ograniczoną zgodność power v1 oraz przekształcono nieoperacyjny preview na przełączniki, liczniki, popupy, atrybucję i ograniczenia sterowane manifestem. Ścieżka generyczna ponownie waliduje pochodzenie i wyklucza artefakty ograniczone/referencyjne.

- 2026-08-01 - Rozpoczęto `MDQ-023`: zastąpienie dosłownej powłoki providera power/Rybnik zwalidowanymi odczytami domain-pack v2, bezpiecznym polityką eksportem i nieoperacyjnym preview sterowanym manifestem.

- 2026-08-01 - Ukończono `MDQ-022`: zarejestrowano adapter workera power i wersjonowany katalog zapytań OSM, etapowano wynik fixture/live i atomowo opublikowano pakiet domeny v2 przy zachowaniu zgodności v1; scalono jako PR #21 po przejściu wspólnego checka GitHub Actions.

- 2026-08-01 - Ukończono `MDQ-021`: zakwalifikowano role OSM, PRG, BDOT10k, ortofotomapy i NMT/NMPT z datowanymi dowodami pierwotnymi; zachowano KIUT jako tylko referencyjny oraz wskazano luki wektorów użyteczności.

- 2026-08-01 - Rozpoczęto `MDQ-021`: zapisywanie datowanych dowodów źródeł pierwotnych i jawnych decyzji o rolach źródeł przed adapterami.

- 2026-08-01 - Ukończono `MDQ-020`: dodano deterministyczne rozwiązywanie koła i zatwierdzonej referencji PRG `provider_aoi/v1`, bezpieczne klucze cache oraz alias zgodności Rybnik bez dostępu do PRG na żywo.

- 2026-08-01 - Rozpoczęto `MDQ-020`: definiowanie deterministycznej geometrii AOI, tożsamości i bezpiecznych kluczy cache przed ogólnymi adapterami lub trasami API v2.

- 2026-08-01 - Ukończono `MDQ-019`: dodano manifest native-artifact domain-pack v2, sprawdzanie integralności/polityki eksportu i pakiet zgodności Rybnik power przy zachowaniu czytników v1.

- 2026-08-01 - Ukończono `MDQ-018`: zastąpiono rejestr źródeł v1 przenośną semantyką `source_registry/v2`, zarejestrowano wymagane rodziny źródeł, zachowano kompatybilność cache power i API Node v1 oraz zweryfikowano parytet Python/TypeScript offline.
- 2026-08-01 - Rozpoczęto `MDQ-018`: definiowanie wersjonowanego rejestru wielu źródeł i kontraktu publicznej dystrybucji przed cache v2, parametryzowanymi AOI lub adapterami źródeł.

- 2026-07-17 - Zdefiniowano granice produktu dostawcy, docelową architekturę hybrydową oraz narrację portfelową Mapbox.
- 2026-07-17 - Ukończono `OPS-001`: dodano trwałe cele (durable goals), status wykonania, decyzje oraz instrukcje dotyczące autonomicznego wykonywania ticketów.
- 2026-07-17 - Ukończono `OPS-002`: ujednolicono wyniki w modelu `Now / Next / Later`, zależności ticketów oraz gotowość; dodano prace nad regułami jakości i mapą drogową przeglądu zgłoszeń (issue-review).
- 2026-07-17 - Ukończono `MDQ-001`: dodano 14 testów offline, ustandaryzowano Python 3.14.4, zaktualizowano bazę FastAPI/Uvicorn/HTTPX2 i usunięto ostrzeżenia o przestarzałych funkcjach frameworka (deprecation warnings).
- 2026-07-17 - Oddzielono publiczną dokumentację dostawcy Steel Sentinel od lokalnego kontekstu portfela i wykonania.
- 2026-07-21 - Rozpoczęto `MDQ-002`: definiowanie ujednoliconych statusów walidacji oraz semantyki gotowości uwzględniającej źródła.
- 2026-07-21 - Ukończono `MDQ-002`: ujednolicono aliasy statusów walidacji, udostępniono gotowość katalogu i metryki, usunięto błędy typu false-positive dla poprawnych raportów oraz dodano pokrycie offline dla źródeł OSM, manualnych i referencyjnych.
- 2026-07-21 - Rozpoczęto `MDQ-003`: definiowanie klasyfikacji źródeł, pewności (confidence), ograniczeń oraz przydatności do symulacji dla wpisów w katalogu.
- 2026-07-21 - Ukończono `MDQ-003`: dodano typ źródła, pewność, ograniczenia i przydatność do symulacji do wpisów w katalogu; wskazano KIUT/GESUT WMS jako wyraźną warstwę referencyjną (reference overlay); zaktualizowano kontrakt TypeScript oraz publiczną dokumentację architektury.
- 2026-07-21 - Rozpoczęto `MDQ-005`: definiowanie kontraktu warstwy GeoJSON należącej do dostawcy Steel Sentinel przed pracami nad cache i Node-providerem.
- 点2026-07-21 - Ukończono `MDQ-005`: dodano wersjonowany normalizator i walidator GeoJSON należący do dostawcy, reprezentatywny fixture kontraktu dla Rybnika, testy schematu offline oraz publiczną dokumentację kontraktu.
- 2026-07-22 - Rozpoczęto `MDQ-016`: definiowanie reguł jakości danych uwzględniających źródła i wersję oraz dowodów błędów przed pracami nad układem cache.
- 2026-07-22 - Ukończono `MDQ-016`: dodano wersjonowane, uwzględniające źródła reguły jakości z wyraźną stosowalnością i wynikami; błędy API zawierają teraz dowody reguł, a ustrukturyzowana ważność (severity) informuje o gotowości.
- 2026-07-22 - Rozpoczęto `MDQ-004`: tworzenie układu artefaktów AOI/domeny opartego na zasadzie "cache-first" dla warstwy sieci elektroenergetycznej Rybnika.
- 20ط2026-07-22 - Ukończono `MDQ-004`: zatwierdzono pełny, znormalizowany cache linii energetycznych Rybnika wraz z rekordami pochodzenia (provenance) i gotowości, a także walidację odczytu cache offline.
- 2026-07-22 - Rozpoczęto `MDQ-006`: budowa szkieletu warstwy usługi dostawcy Node/Express/TypeScript w oparciu o ukończony kontrakt file-cache.
- 2026-07-22 - Ukończono `MDQ-006`: dodano niezależnie uruchamialny szkielet usługi Node/Express/TypeScript z endpointem health sprawdzanym przez Zod, separacją route/service/type oraz odizolowanymi testami API.
- 2026-07-22 - Rozpoczęto `MDQ-013`: definiowanie przenośnego rejestru źródeł i reguł pochodzenia przed udostępnieniem przez Node providera składowanych artefaktów i źródeł.
- 2026-07-22 - Ukończono `MDQ-013`: dodano przenośny rejestr źródeł dla OSM, danych manualnych oraz KIUT/GESUT WMS; pochodzenie analitycznego cache jest teraz walidowane, a publiczne reguły atrybucji/warstwy referencyjnej zostały udokumentowane.
- 2026-07-22 - Rozpoczęto `MDQ-007`: udostępnianie wyłącznie zweryfikowanych lokalnych artefaktów cache i rejestru źródeł poprzez API Node providera.
- 2026-07-22 - Ukończんでも `MDQ-007`: dodano typowane, tylko do odczytu trasy Node dla warstw w cache, gotowości oraz rekordów źródeł z walidowanymi odpowiedziami o błędach i bez efektów ubocznych przy ekstrakcji.
- 2026-07-22 - Ukończono `MDQ-017`: dodano trwały magazyn przeglądu zgłoszeń (issue-review) należący do dostawcy, cykl życia i bezpieczne przed konfliktami API Node, sprawdzanie snapshotów wygenerowanych dowodów oraz nieoperacyjny panel podglądu.
- 2026-07-22 - Ukończono `MDQ-014`: ujednolicono weryfikację Python, Node i frontend w jednej bramce offline; dodano kontrolowaną próbę awarii kontraktu oraz workflow GitHub Actions dla poprawnych pull requestów.
- 2026-07-22 - Ukończono `MDQ-015`: opublikowano zweryfikowane pod kątem endpointu, 3–5 minutowe demo dostawcy, skorygowano narrację o eksporcie jednej warstwy, udokumentowano rozróżnienie OpenInfraMap i sfinalizowano treść do prywatnego CV/rozmowy kwalifikacyjnej.
- 2026-07-22 - Przygotowano proponowaną mapę drogową `G-004` opartą na priorytecie źródeł i wielu domenach: natywne kontrakty źródeł, parametryzowane AOI, adaptery PRG/BDOT10k/KIUT/ortofotomapa/NMT, bramkę dopuszczalności wyłącznie dla darmowych źródeł, dziewięć wymaganych pionowych wycinków domenowych oraz zweryfikowany eksport wielodomenowy; telekomunikacja i ciepłownictwo pozostają jako prace warunkowe w ramach `G-005`.

## Zasady aktualizacji statusu

- Ten plik ma być krótkim, bieżącym podsumowaniem; nie kopiuj tutaj całego backlogu.
- Aktualizuj go w momencie rozpoczęcia, ukończenia lub faktycznego zablokowania ticketa.
- Rejestruj postępy dopiero wtedy, gdy istnieją pliki lub dowody weryfikacji.
- Do statusów na poziomie ticketów używaj `docs/local/tickets.md`, a do statusów na poziomie wyników (outcomes) – `docs/local/GOALS.md`.
