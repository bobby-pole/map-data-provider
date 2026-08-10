# Demo dostawcy

Niniejszy przewodnik prezentuje zaimplementowany wielodomenowy pakiet dostawcy dla wszystkich 9 wymaganych domen G-004 (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`) w obszarze `rybnik_60km` w czasie od trzech do pięciu minut. Wykorzystuje on zatwierdzony cache oraz dane offline (fixtures); nie wymaga on dostępu na żywo do usług Overpass ani WMS.

Obecna wersja generuje eksport kompatybilny ze downstream application. Wczytanie tego eksportu do repozytorium downstream application pozostaje osobnym zadaniem integracyjnym.

## Przygotowanie

Zainstaluj zależności i uruchom pełny proces quality gate raz:

```bash
(cd backend && uv sync --locked --dev)
(cd backend-node && npm install --package-lock=false)
(cd frontend && npm install --package-lock=false)
./scripts/verify_provider.sh
```

Uruchom dostawcę (provider) w jednym terminalu:

```bash
cd backend-node
npm run dev
```

Poniższe przykłady wykorzystują `curl` oraz `jq` względem `http://127.0.0.1:3001`.

## 1. Potwierdzenie wprowadzonej granicy dostawcy — 20 sekund

```bash
curl -sS http://127.0.0.1:3001/api/health | jq
```

Oczekiwany kształt:

```json
{
  "status": "ok",
  "service": "map-data-quality-provider",
  "version": "0.1.0"
}
```

Publiczne API to Node/Express/TypeScript. Python pozostaje narzędziem do przetwarzania danych geoprzestrzennych oraz prototypem FastAPI.

## 2. Pobieranie buforowanej warstwy energetycznej Rybnika — 30 sekund

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/layers/power \
  | jq '{
      aoi_id: .metadata.aoi_id,
      domain: .metadata.domain,
      source: .metadata.source,
      feature_count: .metadata.feature_count,
      readiness: .metadata.readiness
    }'
```

Ten punkt końcowy (endpoint) w trybie tylko do odczytu udostępnia zatwierdzoną i zweryfikowaną pamięć podręczną bez skutków ubocznych związanych z ekstrakcją danych. Jest to bezpieczna metoda na powtarzalną prezentację pełnego migawki (snapshot) dla Rybnika.

## 3. Inspekcja zwartej prezentacji mapy offline — 45 sekund

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/presentations/power \
  | jq '{
      aoi_id,
      domain,
      archive: {format: .archive.format, size_bytes: .archive.size_bytes, min_zoom: .archive.min_zoom, max_zoom: .archive.max_zoom},
      layers: [.layers[] | {artifact_id, source_layer, feature_count, attribution}]
    }'
```

Odpowiedź to zwarte metadane, a nie pełne kolekcje GeoJSON. Lokalny podgląd MapLibre używa jego `archive_url` wraz z HTTP byte range, aby odczytywać tylko wymagane kafelki MVT z PMTiles. Pełne endpointy domain-pack i GeoJSON pozostają ścieżką danych/eksportu.

Aktualna zatwierdzona migawka zawiera 23 604 publiczne obiekty energetyczne w trzech warstwach GeoJSON. `power.supports` jest ograniczonym fixture dowodowym OSM, a nie kompletnym inwentarzem supportów AOI. Jej archiwum PMTiles jest pochodnym, sprawdzonym artefaktem prezentacyjnym; liczniki i rozmiar archiwum należy traktować jako specyficzne dla migawki.

## 4. Wykazanie, dlaczego KIUT/GESUT pozostaje jedynie punktem odniesienia — 45 sekund

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/sources \
  | jq '.sources[]
      | select(.id == "kiut_gesut_wms")
```

Rejestr identyfikuje KIUT/GESUT WMS jako rastrowy punkt odniesienia wizualnego, a nie własną analityczną geometrię dostawcy. Dostawca nie generuje danych GeoJSON na podstawie obrazów WMS i nie oznacza ich jako przydatnych do symulacji.

## 5. Przeglądanie problemów i podglądu mapy — 60–90 sekund

Wyświetl wygenerowane dowody wraz z odrębnym stanem weryfikacji ludzkiej:

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/issues \
  | jq '.issues[] | {id, rule_id, source_type, severity, review}'
```

Opcjonalnie uruchom podgląd React w innym terminalu:

```bash
cd frontend
npm run dev
```

Otwórz `http://localhost:5173`. Podgląd MapLibre rysuje publiczne dane energetyczne z lokalnego archiwum PMTiles na domyślnie włączonym podkładzie OpenStreetMap. Podkład jest wyłącznie kontekstem wizualnym online: wyłącz go, aby sprawdzić lokalny widok PMTiles, i nie oczekuj go offline. Linie energetyczne mają deterministyczne kolory napięć; przełącz osobną warstwę Power supports i przejdź do zoomu 12 dla wież, portali i słupów użyteczności albo 14 dla zwykłych słupów. Kliknij widoczny obiekt, aby sprawdzić źródło, poziom ufności, ograniczenia i zwalidowane tagi źródłowe OSM w jednym panelu inspektora. Przełączniki KIUT i ortofotomapy pozostają opcjonalnymi zewnętrznymi referencjami WMS i nie są dostępne offline. Wygenerowane dowody reguł pozostają oddzielone od utrwalonych decyzji ludzkich i nigdy nie nadpisują statusu gotowości.

## 6. Eksport wielodomenowej paczki dostawcy — 30 sekund

Pobierz skonsolidowany ładunek eksportowy dla wszystkich 9 obsługiwanych domen (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`):

```bash
curl -sS "http://127.0.0.1:3001/api/aoi/rybnik_60km/export?domains=power,emergency,public,transport,bridges,water,gas,sewer,industrial" \
  | jq '{
      export_version,
      aoi_id,
      domain_outcomes: [.domain_outcomes[] | {domain, status, has_domain_pack}],
      domain_pack_count: (.domain_packs | length),
      issue_count: (.issues | length)
    }'
```

Odpowiedź spełnia kontrakt `provider_multi_domain_export/v2`. Izoluje awarie domen w postaci struktury `domain_outcomes`, filtruje publiczne pakiety GeoJSON, dołącza zweryfikowane uwagi pasujące do żądanych domen oraz deduplikuje żądane parametry domenowe.

## 7. Zamknięcie z granicą systemu — 20 sekund

Zaprezentowana ścieżka to:

```text
AOI/multi-domain request
  -> cache-first provider orchestration we wszystkich 9 domenach
  -> normalizowany GeoJSON z OSM i BDOT10k
  -> walidacja, provenance, confidence i readiness
  -> pochodna prezentacja mapy MVT/PMTiles
  -> wyjaśnialne dowody uwag i stan przeglądu
  -> eksport provider_multi_domain_export/v2
```

To repozytorium zarządza tym procesem przepływu danych upstream. Eksport jest gotowy dla klienta kompatybilnego ze downstream application, jednak niniejsza wersja nie zapewnia faktycznego wykorzystania danych w innych repozytoriach.

## Opcjonalnie: demonstracja odświeżania pamięci podręcznej po głównej prezentacji

Punkt końcowy orkiestracji jest celowo oddzielony od dostępu do warstwy tylko do odczytu:

```bash
curl -sS -X POST http://127.0.0.1:3001/api/aoi/requests \
  -H 'content-type: application/json' \
  -d '{"aoi_id":"rybnik_60km","domain":"power"}' \
  | jq '{aoi: .aoi.id, domain, result, cache_status, feature_count: .metadata.feature_count}'
```

W przypadku migawki (snapshot) nie starszej niż 24 godziny zwracany jest `result: "cache"`. W przypadku starszej lub brakującej migawki uruchamiany jest worker Python z jego offline fixture i zwracany jest `result: "refresh"`; proces ten zastępuje lokalną pamięć podręczną mniejszym artefaktem fixture. Ten krok należy wykonać dopiero po zaprezentowaniu zatwierdzonej migawki zawierającej 16 505 cech. W obecnym przepisie pracy żadna z tych ścieżek nie wywołuje usługi Overpass w trybie live.
