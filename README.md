# Pivovar sklad

Interní mobilní webová aplikace pro evidenci hotového piva, výdejů a vratných sudů.

## Aktuální lokální verze

- Eviduje PETky, plné sudy a prázdné vratné sudy v kusech.
- Umožňuje naskladnění, výdej odběrateli a vrácení sudu.
- Počítá aktuální stav skladu z historie pohybů.
- Hlídá nevrácené sudy podle odběratele a velikosti.
- Sortiment lze doplňovat přímo v aplikaci, například o PET 0,5 l nebo další druh piva.
- Data ukládá do `localStorage` tohoto prohlížeče.

Lokální data se zatím nesdílejí mezi telefony ani počítači. Při napojení na Supabase se zachovají stejné obrazovky a skladové pohyby se přesunou do sdílené databáze.

## Spuštění

```bash
npm install
npm run dev
```

Kontrola produkčního sestavení:

```bash
npm run build
npm run lint
```

## Další krok

Před nasazením pro více lidí vytvořit Supabase projekt, přidat přihlášení uživatelů a nahradit lokální úložiště sdílenou databází s realtime synchronizací.
