# Migrationsmappe — endnu uden SQL-baseline

Der må ikke tilføjes historiske placeholder-migrationer her. Repository'et har
navne og versionsnumre for 16 eksternt registrerede migrationer, men ikke deres
komplette, reviewede SQL-legemer.

Før første `.sql`-fil tilføjes, skal baseline-gaten i
`docs/database-migrations-recovery.md` være opfyldt. Derefter gælder:

- filnavn: `YYYYMMDDHHMMSS_beskrivende_navn.sql`;
- opret filen med `supabase migration new <navn>`;
- én logisk schema-/privilegeændring pr. migration;
- ingen credentials, produktionsdata eller private researchartefakter;
- RLS, policies og grants skal behandles som separate sikkerhedslag;
- migrationen skal kunne køres på et tomt, isoleret lokalmiljø;
- `supabase db reset --linked` må aldrig bruges mod produktion.
