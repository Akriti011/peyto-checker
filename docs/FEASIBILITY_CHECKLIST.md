# Live feasibility checklist (15 min, office laptop)

Office laptop milte hi (ya senior ke system pe, unki permission se) yeh check karo.
**Kuch copy ya save nahi karna**, sirf haan/na aur format note karna hai.

## 0. OLM login
- [ ] Chitragupt / CFM / PuTTY / LightSoft sab OLM ID se login hote hain? (haan)
- [ ] OTP har login pe aata hai ya din mein ek baar?
- [ ] OTP SMS pe aata hai ya authenticator app pe?
- [ ] Chitragupt ke login page pe user / password / OTP box ke `id` kya hain? (Inspect se)
- [ ] Manager OK: "apni OLM ID se khud login karke read-only automation chala sakti hoon?"

## A. Chitragupt
- [ ] F12 → Network tab kholo → ek LSI search karo
- [ ] Koi request dikhi jiska Response mein CKT ID hai? (haan / na)
- [ ] Agar haan: uska URL pattern kaisa hai? (jaise `/api/search?lsi=...`, number hata ke likho)
- [ ] Login ke baad hi chalta hai? Login page pe user/password box ke `id` kya hain? (Inspect se)
- [ ] CKT ID kis format mein hoti hai? (jaise `SIFY-T1843438`, sirf pattern)

## B. PuTTY / SSH
- [ ] PuTTY seedha node pe jaata hai ya pehle kisi jump server pe?
- [ ] T3 ya T4 kaise decide hota hai?
- [ ] Node ka model kya hai? (login banner / `show version` pehli line: Cisco / Juniper / Nokia / Huawei)
- [ ] Exact command kya chalati ho?
- [ ] Output mein CKT ID kis line mein aati hai? (format, real value nahi)

## C. NMS (LightSoft)
- [ ] L2VPN Service List ya koi report **Export to CSV/Excel** hoti hai?
- [ ] Export ke column headers kya hain? (sirf header names)
- [ ] Ring / topology ka bhi export milta hai?
- [ ] NMS team se poochna: NBI / northbound API enabled hai kya?

## D. Access (manager se)
- [ ] Chitragupt read-only service account mil sakta hai?
- [ ] T3/T4 nodes ke liye read-only SSH account?
- [ ] Ek internal VM (Linux, Docker) jahan tool chal sake?

## E. Preflight (jab tool office machine pe ho)
```bash
cd backend && python -m connectors.preflight --lsi <ek real LSI>
```
Saare PASS = live ke liye ready. Screenshot manager ko dikhana.
