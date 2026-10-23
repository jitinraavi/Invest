# One Invest — Global Wealth, Trading & Credit Super-App (Singapore HQ)

**One Invest** is a borderless, unified financial super-app headquartered in **Singapore** and designed around the **Monetary Authority of Singapore (MAS)** regulatory framework (**Capital Markets Services Licence CMS101482** & **Major Payment Institution Licence PS20200815**).

## Core Modules Implemented

1. **🌐 Universal Multi-Asset Global Investment Marketplace (`tab-markets`)**
   - Invest in **Global Equities** (`NVDA`, `AAPL`, `D05.SI` on SGX, `RELIANCE.NS` on NSE, `ASML.AS` on Euronext, `7203.T` on TSE, `AZN.L` on LSE).
   - **Global ETFs** (`SPY` US Domiciled vs. `CSPX.L` UCITS PRIIPs-compliant ETF).
   - **Global Sovereign & Corporate Bonds** (`UST-10Y` US Treasury, `SGS-6M` Singapore T-Bill, `IGB-10Y` India G-Sec FAR, `BUND-10Y` German Bund).
   - **Cross-Border Bank Fixed Deposits (FDs)** (`FD-DBS-SG` SDIC insured, `FD-JPM-US` FDIC insured, `FD-HDFC-IN` GIFT City/India, `FD-BARC-UK` FSCS protected).

2. **📈 Professional Global Trading Terminal — Options & Futures Desk (`tab-trading`)**
   - Live interactive HTML5 Canvas DMA chart with multi-exchange ticker switching.
   - Global Options (`CBOE`) and Index/Commodity Futures (`CME Globex`, `SGX / NSE IX GIFT Nifty`, `COMEX Gold`).
   - 1-Click **"Close & Auto-Sweep Profit"** on open derivative positions.

3. **🔄 Seamless Capital Recirculation — Zero-Friction Profit Auto-Sweep (`tab-reinvest`)**
   - Realized trading profits and idle cash are automatically split and invested into **Sovereign Bonds**, **High-Yield Global Fixed Deposits**, and **Global Equities** with **T+0 internal ledger settlement** (no external bank off-ramp delays).

4. **🏦 Integrated Credit & Lombard Lending Suite (`tab-loans`)**
   - **Securities-Backed Line of Credit (SBLOC / Lombard Loan)** under MAS CMS Product Financing: dynamically calculates borrowing power across Stocks (65–75% LTV), Bonds (90% LTV), and Fixed Deposits (85–90% LTV).
   - **Embedded Partner Bank Term Loans** (5.20% APR instant disbursement into the multi-currency cash pool).
   - **Immutable Double-Entry Ledger** logging every transaction in real time.

5. **🛡️ Dynamic Multi-Jurisdiction RegTech & KYC Engine + Wholesale FX Wallet (`tab-regtech`)**
   - Live jurisdiction simulator in the top bar:
     - **🇸🇬 Singapore (`SG`)**: Singpass / MyInfo KYC, CRS + W-8BEN, and mandatory **MAS Customer Knowledge Assessment (CKA/CAT) Quiz** before unlocking Options & Futures.
     - **🇮🇳 India (`IN`)**: DigiLocker + PAN + Aadhaar OTP KYC, tracks the **$250,000/FY RBI Liberalised Remittance Scheme (LRS)** cap, and automatically gates overseas leveraged derivatives per **RBI FEMA** guidelines.
     - **🇪🇺 European Union (`EU`)**: eIDAS KYC, enforces **ESMA 5:1 retail equity leverage caps**, and automatically blocks non-UCITS US ETFs (`SPY`) while unlocking UCITS equivalents (`CSPX.L`) under **PRIIPs KID** rules.
     - **🇺🇸 United States (`US`)**: Plaid IDV + SSN + **IRS Form W-9**, and enforces the **FINRA Pattern Day Trader (PDT) $25,000 rule**.
     - **🇦🇪 UAE (`AE`)**: UAE PASS KYC, 0% local capital gains tracking, and Reverse Solicitation compliance mode.
     - **🚫 Sanctioned Jurisdiction (`KP`)**: Triggers an immediate **OFAC / FATF Geo-IP Perimeter Block**.

## Quick Start

Open `index.html` directly in any modern browser, or start a local server:

```bash
npm start
```
