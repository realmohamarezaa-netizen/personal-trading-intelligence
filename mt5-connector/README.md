# MT5 Connector — Personal Trading Intelligence

## What it is

`sync.py` is a **local, read-only bridge** between your MetaTrader 5 terminal and the Personal Trading Intelligence dashboard. It connects to the MT5 terminal installed on the same Windows machine via the official `MetaTrader5` Python package, merges raw deals into per-position trades, and pushes them (together with account info, balance/equity snapshot and deposit/withdrawal cashflows) to the dashboard's local API. **No cloud, no orders** — the script only reads; it never places, modifies or closes any order.

## Prerequisites

- **Windows** (the `MetaTrader5` package is Windows-only)
- **MetaTrader 5 terminal** installed, running and **logged in** to your account
- **Python 3.10 – 3.12, 64-bit** — during installation tick **"Add python.exe to PATH"**

## Install

```bat
cd mt5-connector
pip install -r requirements.txt
```

## Run

```bat
:: 1) Sanity check — connects and prints a summary, sends nothing
python sync.py --test

:: 2) One-shot sync of the last 180 days into the dashboard
python sync.py --days 180

:: 3) Watch mode — keep syncing every 60 seconds (Ctrl+C to stop)
python sync.py --watch 60
```

Optional auto-login (otherwise the terminal's current login is used):

```bat
python sync.py --login 12345678 --password "your-password" --server "BrokerLive-Server"
```

## Data flow

```
MT5 Terminal (Windows, logged in)
        |  read-only IPC (MetaTrader5 package)
        v
     sync.py  (this connector)
        |  POST JSON: account + trades + cashflows + snapshot
        v
http://127.0.0.1:3000/api/mt5/sync   (Next.js API route)
        |  Prisma upsert by positionId
        v
      SQLite  (db/custom.db)
        |
        v
    Dashboard UI (overview, analytics, journal)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `initialize() failed` | The terminal is not running or no account is logged in. Start MT5 and log in manually first. (You do **not** need to enable "Allow algorithmic trading" — this connector is read-only.) |
| `(−6) Terminal not authorized` | Pass `--login`, `--password` and `--server` so the script logs in by itself; double-check the server name (copy it exactly from the terminal's login dialog). |
| `8009` / `4014` errors | Terminal IPC/authorization hiccup: restart the MT5 terminal, make sure only one sync instance runs at a time, and update the package with `pip install -U MetaTrader5`. |
| `pip install MetaTrader5` fails on Linux/macOS | The package (and its pywin32 dependency chain) is **Windows-only**. Run the connector on the Windows machine where the terminal lives. |
| HTTP errors / empty dashboard | Make sure the dashboard is running at `http://127.0.0.1:3000`, then re-run `python sync.py --test`. |
| Very large position tickets rejected | The dashboard stores position IDs as 32-bit integers; tickets above 2,147,483,647 (rare) cannot be synced. |

---

## راهنمای فارسی (Persian guide)

این ابزار یک پل **محلی و فقط-خواندنی** بین ترمینال متاتریدر ۵ و داشبورد «هوش معاملاتی شخصی» است. اسکریپت از طریق پکیج رسمی `MetaTrader5` به ترمینال نصب‌شده روی همان سیستم وصل می‌شود، معاملات خام (Deals) را به معاملهٔ هر پوزیشن تبدیل می‌کند و آن‌ها را به‌همراه اطلاعات حساب، موجودی/اکوییتی و واریز/برداشت‌ها به API داشبورد ارسال می‌کند. **هیچ ابری در کار نیست و هیچ معامله‌ای باز، بسته یا تغییر داده نمی‌شود.**

### پیش‌نیازها

- **ویندوز** (پکیج `MetaTrader5` فقط روی ویندوز نصب می‌شود)
- **ترمینال MetaTrader 5** نصب‌شده، در حال اجرا و **لاگین‌شده**
- **پایتون ۳.۱۰ تا ۳.۱۲ نسخهٔ ۶۴ بیتی** — هنگام نصب گزینهٔ **"Add python.exe to PATH"** را تیک بزنید

### نصب

```bat
cd mt5-connector
pip install -r requirements.txt
```

### اجرا

```bat
:: ۱) تست اتصال — فقط خلاصه چاپ می‌شود، چیزی ارسال نمی‌شود
python sync.py --test

:: ۲) همگام‌سازی یک‌بارهٔ ۱۸۰ روز اخیر
python sync.py --days 180

:: ۳) حالت مانیتورینگ — همگام‌سازی خودکار هر ۶۰ ثانیه (توقف با Ctrl+C)
python sync.py --watch 60
```

لاگین خودکار (اختیاری):

```bat
python sync.py --login 12345678 --password "رمز-حساب" --server "BrokerLive-Server"
```

### نکات عیب‌یابی

- خطای `initialize() failed` یعنی ترمینال باز نیست یا لاگین نیست؛ اول ترمینال را باز و لاگین کنید. (نیازی به فعال‌کردن «Allow algorithmic trading» نیست.)
- خطای `−6` (Terminal not authorized): پارامترهای `--login` و `--password` و `--server` را بدهید و نام سرور را دقیقاً مطابق ترمینال بنویسید.
- خطاهای `8009` یا `4014`: ترمینال را ری‌استارت کنید، فقط یک نسخه از اسکریپت را اجرا کنید و پکیج را با `pip install -U MetaTrader5` به‌روز کنید.
- اگر پکیج روی لینوکس/مک نصب نشد: این پکیج فقط مخصوص ویندوز است؛ اسکریپت را روی همان سیستم ویندوزیِ ترمینال اجرا کنید.
