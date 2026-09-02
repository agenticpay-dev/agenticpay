# agenticpay

Trzy fakty, które kosztowały więcej niż jedno sprawdzenie. Każdy ma czym go
obalić, więc nie wierz im na słowo, jeśli coś się nie zgadza.

## Merge do main nie wdraża produkcji

Hostowany facilitator na Heroku (`agentpay-facilitator`) deployuje się ręcznie:
`git push heroku main:main`. Prod potrafił z tego powodu stać trzy miesiące za
mainem. Sprawdź: `heroku releases -n 1 -a agentpay-facilitator` i porównaj SHA
z `git log -1 main`. (2026-09-02)

## Brak sieci w `/supported` bywa poprawny

Facilitator mierzy saldo fee payera i ogłasza tylko sieci, na których faktycznie
zapłaci opłatę. Mainnet jest dziś wstrzymany, bo fee payer ma tam 0 SOL. To nie
jest awaria. Sprawdź: `GET /` zwraca `feePayerReadiness` z saldem per sieć, a
logi startowe piszą `[fee payer] <sieć>: READY|WITHHELD`. (2026-09-02)

## Kody odrzucenia z `@x402/svm` wychodzą na drucie

`packages/facilitator/test/svm-scheme-compliance.test.ts` przypina je co do
znaku, a `/verify` zwraca je klientowi. Bump `@x402/svm` potrafi je przemianować
(2.24.0 dodał prefiks `invalid_exact_svm_`), więc bump i poprawka testów muszą
wejść jednym commitem. Sprawdź: `src/exact/facilitator/errors.ts` w paczce.
(2026-09-02)
