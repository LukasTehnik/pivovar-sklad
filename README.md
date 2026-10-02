# Pivovar sklad

Interní mobilní webová aplikace pro evidenci hotového piva, výdejů a vratných sudů.

## Sdílená verze se Supabase

- Eviduje PETky, plné sudy a prázdné vratné sudy v kusech.
- Umožňuje naskladnění, výdej odběrateli a vrácení sudu.
- Počítá aktuální stav skladu z historie pohybů.
- Hlídá nevrácené sudy podle odběratele a velikosti.
- Sortiment lze doplňovat přímo v aplikaci, například o PET 0,5 l nebo další druh piva.
- Uživatelé se přihlašují e-mailem a heslem.
- Stav skladu i pohyby se synchronizují v reálném čase mezi zařízeními.
- Pohyby se zapisují atomicky, takže nelze vydat stejný kus dvakrát.

## Nastavení Supabase

1. V Supabase spusť SQL z `supabase/migrations/20261002_initial_inventory.sql`.
2. Zkopíruj `.env.example` do `.env.local`.
3. Vyplň URL projektu a **publishable key** z nastavení projektu. Nikdy nepoužívej service role key.
4. V Authentication povol e-mailové přihlášení. První správce si může vytvořit účet přímo v aplikaci.

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
