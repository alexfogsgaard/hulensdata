# Redesignplan: redaktionelt dataarkiv

> **Produktbeslutning 2026-07-15:** Denne retning er gældende. PR #2 er fase 1 af redesignet; den bogstavelige Kartoteket-metafor er historisk kontekst, ikke længere styrende informationsarkitektur.

## Brugerproblemer

Den nuværende kartotekmetafor skjuler de vigtigste opgaver bag skuffer, bind og møbelnavne. Forsiden forklarer ikke hurtigt nok, hvad arkivet kan besvare. Virksomhedsprofilen blander identitet, TV-forløb og efterliv i én visuel fortælling, og ukendte værdier fremstår flere steder som tankestreger. Navigationen bruger også interne metaforer som "Protokollen" og "Tavlerne".

## Informationsarkitektur og navigation

Den globale navigation bliver: **Virksomheder, Pitches & aftaler, Investorer, Sæsoner, Arkiv, Analyser**. Søgning er den primære genvej og søger i det statiske snapshot. Forsiden organiseres efter brugerens spørgsmål: find en virksomhed, forstå omfanget, gå til registre og læs dokumenterede hændelser.

Virksomhedsprofilen opdeles i fire tydelige lag:

1. Identitet og dokumenteret status.
2. Pitch og det, der skete på TV.
3. Kronologisk efterliv med generiske eventtyper.
4. Kilder, relationer og metode.

## Designretning

Et roligt, dansk redaktionelt dataarkiv: varm papirbaggrund, mørk tekst, dyb rød accent, klare hairlines og en nøgtern serif/sans-typografi. Arkivkarakteren ligger i præcision, nummerering, kilder og typografi — ikke i imitation af fysiske møbler. Der bruges ingen stor dekorativ hero, gradients, glassmorphism eller informationsløse stempler.

## Bevares

- Vanilla HTML/CSS/JavaScript og DOM-frie render-funktioner.
- Supabase som redaktionel database og `data/arkiv.json` som publiceret snapshot.
- Trykpressen, statiske danske URL'er, canonical URLs, JSON-LD og sitemap.
- Eksisterende datamodel, kilder, confidence og datopræcision.
- De nuværende register-URL'er og legacy query-links.

## Erstattes eller forenkles

- Skuffevæg, kartei, sagsmappe, faneblade og protokol som primær navigation.
- Headerens utydelige statistik og trange desktop-layout.
- Tankestreger for reelt ukendte domæneværdier.
- Forsidens "nyeste deals" som proxy for aktuelle historier; dokumenterede events vises i stedet efter revision/dato.

## Tekniske konsekvenser

- `tools/tryk.mjs` skal levere samme globale header, semantiske sektioner og profilmarkup som de interaktive sider.
- Snapshot'et forbliver eneste normale læsesti. Ingen databaseændring er nødvendig.
- Generiske mapper for eventtype, status og kilder udvides uden branches på virksomhedsnavne.
- Globale datafelter til CVR og virksomhedskilder indlæses i profilmodellen.
- CSS organiseres som tokens, grundelementer, layout, komponenter og responsive regler.

## Implementeringsrækkefølge

1. Fælles workflow og plan.
2. Design-tokens, header, navigation, søgning, fokus og reduceret bevægelse.
3. Forside med søgning, aktuelle snapshot-tal, registre og seneste dokumenterede events.
4. Virksomhedsprofil med identitet, TV-lag, efterliv, kilder og ukendte tilstande.
5. Trykpresseparitet og statiske sider.
6. Build-, link-, browser-, mobil-, tilgængeligheds- og SEO-verifikation.

## Fase 1 — historisk overgangstilstand

Fase 1 redesigner forsiden, den fælles navigation og virksomhedssiderne. Trykpressen, snapshot-arkitekturen, URL-rummet og datamodellen bevares. Investorprofiler, sæsonsider og enkelte registre kan endnu have kartei-, mappe- eller protokolpræg fra den tidligere retning. Det blandede design er en bevidst, midlertidig overgangstilstand — ikke slutresultatet.

Fase 2 samler investorprofiler, sæsonsider, registre og analyser i samme redaktionelle system. Overgangstilstanden afsluttes, når fase-2-PR'en merges; nye komponenter må ikke afhænge af de gamle dekorative klasser.

## Fase 2 — samlet redaktionelt system (implementeret på fase-2-branchen)

Fase 2 harmoniserer de resterende sidetyper med fase 1 uden at ændre produktidentiteten eller arkitekturen. Arbejdet omfatter:

1. Investoroversigt og investorprofiler med tydelig skelnen mellem registrerede TV-aftaler, panelhistorik og ikke-dokumenteret realisering efter udsendelsen.
2. Sæsonsider med pitches, TV-aftaler, ingen-aftaler, panel, virksomheder, dokumenteret efterliv og navigation mellem sæsoner.
3. Redaktionelle registre, hvor konkurs, lukning, exit, ejerskifte og ændrede TV-aftaler beholder deres præcise hændelsestype.
4. Pitchoversigt med almindelige begreber, tastaturbetjente filtre, forståelig sortering og URL-bevaret filtertilstand.
5. Analyser med spørgsmål, enheder, datagrundlag og begrænsninger ved hver graf.
6. Fælles footer, brødkrummer, metadata og fagligt korrekte strukturerede data.

Trykpressen, DOM-frie renderfunktioner, snapshot-læsestien, danske URL'er, Chart.js og databasen bevares. Fase 2 indfører ingen nye domænefakta og ingen databaseændringer.

Alle tidligere forbrugere er migreret. En forbrugsanalyse har verificeret og fjernet de døde kartei-, mappe-, journal-, protokol- og dashboardklasser samt deres ubrugte render-funktioner. Historiske designnoter bevares uændret.

## Kendt kildegrænse

REST-fallbackens `limit=10000` på `sources` kan stadig blive begrænset af Supabase-projektets servermæssige max-rows. Produktion bruger normalt `data/arkiv.json`, og snapshot'et rummer aktuelt cirka 61 kilder, så kompleks pagination er ikke en fase-2-opgave. Indfør pagination, før kildemængden nærmer sig servergrænsen.

## Risici og testkrav

- Flere pitches/deals pr. virksomhed må ikke foldes sammen til én falsk hændelse.
- Ukendt afsnit må aldrig blive `Eundefined`; ukendte tal skal få forklarende tekst.
- Events som exit, konkurs, lukning, ejerskifte, funding og milepæl skal rendres via samme model.
- Kilder uden note og confidence `uncertain` skal stadig være forståelige.
- Header og søgning skal fungere på både rodfiler og dybe statiske URL'er.
- Mobile tabeller skal kunne scrolles uden at skubbe resten af layoutet.
- Gamle query-links, register-URL'er, canonical, JSON-LD, sitemap, 404 og interne links skal kontrolleres før review.
