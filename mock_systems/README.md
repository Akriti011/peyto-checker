# Fake Airtel systems (demo mode only)

Ye folder **nakli** Chitragupt, nakli T3/T4 MPLS nodes chalata hai taaki Peyto Checker
ka poora flow bina office network ke dikhaya ja sake. Saara data synthetic hai
(`backend/sample_data/` se banta hai). Isme koi real Airtel data nahi hai.

```bash
python -m mock_systems.run_mocks
```

| System | Address | Login |
|---|---|---|
| Fake Chitragupt | http://127.0.0.1:8101 | koi bhi user / `demo` |
| Fake T3 node (202.123.x.x jaisa) | `ssh 127.0.0.1 -p 2201` | koi bhi user / `demo` |
| Fake T4 node (116.119.x.x jaisa) | `ssh 127.0.0.1 -p 2202` | koi bhi user / `demo` |

Demo ke liye jaan-boojh ke:
- aakhri 2 LSI Chitragupt mein **nahi** milti, sirf SSH node pe milti hain (PuTTY fallback dikhane ke liye)
- LSI `9999999` kahin nahi milti (Manual Check row dikhane ke liye)

Live mode mein ye folder use hi nahi hota.
