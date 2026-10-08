# Chitragupt bot (v1): LSI → CKT ID

> ⚠️ Chalane se pehle senior se confirm karo ki Chitragupt pe automation allowed hai.
> Login ID/password kabhi code ya config mein mat likhna. Bot sirf search + read karta hai.

## Ek baar setup (Mac, office network / VPN on)
```bash
cd ~/Documents/peyto-checker/chitragupt_bot
python3 -m pip install playwright pandas openpyxl pyyaml
python3 -m playwright install chromium     # agar Chrome installed hai to ye fail bhi ho to chalega
```

## config.yaml mein 1 cheez bharo
`chitragupt_url:` → Chitragupt ka link (address bar se copy).

## Test chalao (sirf 5 LSI)
```bash
python3 lsi_to_ckt.py --input lsi_list.xlsx
```
1. Chrome khulega → apni **old ID** se login karo
2. Search bar dikhe → terminal mein **Enter**
3. Bot 5 LSI search karega → `lsi_ckt_result.xlsx` banegi
4. `debug_screens/` mein pehli 3 search ke screenshots

## Claude ko kya bhejna hai
- Terminal ka output (copy-paste)
- `lsi_ckt_result.xlsx` mein kya aaya (naam/numbers chhupa ke)
- Agar galat aaya: `debug_screens/` ka 1 screenshot (sensitive cheez blur karke)

Sab sahi aaye to: `--limit 0` lagao, saari LSI chalengi.
