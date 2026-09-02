# Errors and lessons

- **2026-09-01 — Full probe (32k endpoints) died silently on Windows with exit 127.** Node 24 on Windows hits a libuv assertion (`UV_HANDLE_CLOSING`) under sustained socket churn; 1,500 targets ran fine, 32k did not. The scheduled run lives on a Linux GitHub Actions runner where 14,933 probes took 197 s. Locally, use `npm run probe:smoke` or `--max 1500`.
- **2026-09-01 — x402scan search returns HTTP 500 above `limit=20000`.** Crawl is capped at 20,000; the first cron run crawled zero x402scan rows because the cap was set to 100,000. Paginate if their catalog outgrows the cap.
- **2026-09-01 — Price drift compared `accepts[0]` to `accepts[0]`.** A live 402 can list several payment options in a different order than the directory. The probe now picks the live option on the listed network before comparing amounts, so drift means a real price change, not option reordering.
