// ============================================================================
// ONE INVEST — Core Super-App Engine, RegTech Policy Evaluator & Ledger
// Headquarters: Singapore (MAS CMS101482 & MPI PS20200815)
// ============================================================================

(function () {
  const DATA = window.ONE_INVEST_DATA;

  // Application State
  const state = {
    activeJurisdiction: 'SG',
    investorClass: 'RETAIL', // 'RETAIL' | 'ACCREDITED'
    sgCkaPassed: false, // MAS Customer Knowledge Assessment for SIPs (Options/Futures)
    assetFilter: 'ALL',
    activeChartSymbol: 'NVDA',

    // Multi-Currency Cash Wallet Balances (Native Currency Units)
    wallet: {
      USD: 8450.00,
      SGD: 4200.00,
      INR: 165000.00,
      EUR: 1150.00,
      GBP: 450.00,
      JPY: 85000.00,
      AED: 1200.00
    },

    // Auto-Sweep Profit Recirculation Rules (Must sum to 100%)
    sweepRules: {
      bond: 40,
      fd: 35,
      stock: 25
    },

    totalSweptProfitsUsd: 8420.00,
    lombardLoanDrawnUsd: 2500.00,
    embeddedBankLoanUsd: 0.00,

    // Clone initial holdings & derivative positions
    holdings: JSON.parse(JSON.stringify(DATA.initialHoldings)),
    derivativePositions: JSON.parse(JSON.stringify(DATA.initialDerivativePositions)),

    // Double-entry immutable ledger entries
    ledger: [
      {
        time: '00:32:10 SGT',
        op: 'AUTO_PROFIT_SWEEP',
        accounts: 'DR: Asset Custody (UST-10Y / FD-JPM) | CR: Realized Trading Pool',
        amount: '+$1,850.00'
      },
      {
        time: '00:24:45 SGT',
        op: 'SBLOC_LOMBARD_DRAW',
        accounts: 'DR: Client Cash Wallet (USD) | CR: MAS CMS Lombard Facility',
        amount: '+$2,500.00'
      },
      {
        time: '00:15:02 SGT',
        op: 'KYC_W8BEN_CERTIFIED',
        accounts: 'Singpass MyInfo + IRS Form W-8BEN & IRAS CRS Logged',
        amount: 'VERIFIED'
      }
    ],

    // Chart historical series
    chartSeries: [131.2, 132.0, 131.6, 133.1, 134.0, 133.4, 134.9, 135.8, 135.2, 136.4, 137.1, 136.8, 137.9, 138.6]
  };

  // ==========================================================================
  // CURRENCY & PORTFOLIO VALUATION HELPERS
  // ==========================================================================
  function toUsd(amount, currency) {
    const rateObj = DATA.fxRates[currency];
    if (!rateObj) return amount;
    return amount / rateObj.rate;
  }

  function fromUsd(amountUsd, currency) {
    const rateObj = DATA.fxRates[currency];
    if (!rateObj) return amountUsd;
    return amountUsd * rateObj.rate;
  }

  function formatCurrency(amount, currency = 'USD') {
    const rateObj = DATA.fxRates[currency] || DATA.fxRates.USD;
    return `${rateObj.symbol}${Number(amount).toLocaleString('en-US', {
      minimumFractionDigits: currency === 'JPY' ? 0 : 2,
      maximumFractionDigits: currency === 'JPY' ? 0 : 2
    })}`;
  }

  function getTotalWalletCashUsd() {
    let total = 0;
    for (const [curr, bal] of Object.entries(state.wallet)) {
      total += toUsd(bal, curr);
    }
    return total;
  }

  function getPortfolioMetrics() {
    let totalMarketValueUsd = 0;
    let totalMaxLombardUsd = 0;

    state.holdings.forEach((h) => {
      const asset = DATA.assets.find((a) => a.id === h.assetId);
      if (!asset) return;
      const unitUsd = toUsd(asset.price, asset.currency);
      const valUsd = unitUsd * h.units;
      totalMarketValueUsd += valUsd;
      totalMaxLombardUsd += valUsd * (asset.ltvPct / 100);
    });

    const derivUnrealizedUsd = state.derivativePositions.reduce((acc, p) => acc + p.unrealizedPnlUsd, 0);
    const cashUsd = getTotalWalletCashUsd();
    const netWorthUsd = totalMarketValueUsd + cashUsd + derivUnrealizedUsd - state.lombardLoanDrawnUsd - state.embeddedBankLoanUsd;

    return {
      totalMarketValueUsd,
      totalMaxLombardUsd,
      derivUnrealizedUsd,
      cashUsd,
      netWorthUsd
    };
  }

  function addLedgerEntry(op, accounts, amount) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + ' SGT';
    state.ledger.unshift({ time: timeStr, op, accounts, amount });
    renderLedger();
  }

  function showToast(title, message) {
    const area = document.getElementById('toastArea');
    if (!area) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<div style="font-weight:700; color:#34d399; margin-bottom:0.2rem;">${title}</div><div style="color:#cbd5e1;">${message}</div>`;
    area.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 4500);
  }

  // ==========================================================================
  // OPA REGTECH ENGINE: ASSET & DERIVATIVE ELIGIBILITY EVALUATION
  // ==========================================================================
  function evaluateAssetEligibility(asset) {
    const policy = DATA.jurisdictions[state.activeJurisdiction];
    if (!policy) return { allowed: true, reason: 'Allowed' };

    if (policy.sanctioned) {
      return { allowed: false, reason: 'Blocked: OFAC/FATF Sanctioned Jurisdiction' };
    }

    // EU MiFID II / PRIIPs rule: Block non-UCITS US ETFs without a PRIIPs KID for Retail investors
    if (policy.blockNonUcitsEtfs && state.investorClass === 'RETAIL' && asset.category === 'ETF' && !asset.priipsKid) {
      return {
        allowed: false,
        reason: 'PRIIPs Lock: Non-UCITS US ETF without KID (Use CSPX.L UCITS instead)'
      };
    }

    return {
      allowed: true,
      reason: policy.enforceLrsLimit
        ? `RBI LRS Eligible ($${(policy.lrsAnnualCapUsd - policy.lrsUsedUsd).toLocaleString()} Cap Rem.)`
        : 'OPA Verified • Instant Settlement'
    };
  }

  function evaluateDerivativesAccess() {
    const policy = DATA.jurisdictions[state.activeJurisdiction];
    if (policy.sanctioned) {
      return { allowed: false, gateType: 'SANCTIONED', message: 'Sanctioned Jurisdiction' };
    }
    if (!policy.allowOptionsFutures && state.investorClass === 'RETAIL') {
      return {
        allowed: false,
        gateType: 'INDIA_FEMA_LOCK',
        message: 'Under RBI FEMA & Liberalised Remittance Scheme (LRS) regulations, Indian retail residents are prohibited from trading overseas leveraged derivatives (Options & Futures). Cash Global Equities, Sovereign Bonds, and Global Fixed Deposits remain unlocked.'
      };
    }
    if (policy.requireCkaForDerivatives && !state.sgCkaPassed && state.investorClass === 'RETAIL') {
      return {
        allowed: false,
        gateType: 'SG_MAS_CKA_QUIZ',
        message: 'MAS Notice SFA 04-N12 requires Singapore retail investors to complete the Customer Knowledge Assessment (CKA / CAT) before trading Specified Investment Products (Options & Futures).'
      };
    }
    return {
      allowed: true,
      gateType: 'UNLOCKED',
      message: policy.enforcePdtRule
        ? `FINRA Pattern Day Trader (PDT) Rule Active: ${policy.pdtDayTradesUsed}/${policy.pdtMaxWithout25k} Day Trades used (Portfolio Net Worth > $25,000 satisfies FINRA equity requirement).`
        : 'Direct Market Access (DMA) Unlocked for Global Options & Futures.'
    };
  }

  // ==========================================================================
  // RENDER FUNCTIONS
  // ==========================================================================
  function renderTopAndPolicyBanners() {
    const policy = DATA.jurisdictions[state.activeJurisdiction];
    const sanctionedOverlay = document.getElementById('sanctionedOverlay');
    if (policy.sanctioned) {
      sanctionedOverlay.classList.add('active');
    } else {
      sanctionedOverlay.classList.remove('active');
    }

    document.getElementById('activeKycBadge').textContent = `⚡ KYC: ${policy.kycProvider.split('+')[0].trim()}`;
    document.getElementById('activeTaxBadge').textContent = `📄 Tax: ${policy.taxForms[0] || 'Verified'}`;

    document.getElementById('policyBannerTitle').textContent =
      `${policy.flag} Active Jurisdiction Policy: ${policy.name} — ${policy.regulator} (${state.investorClass})`;
    document.getElementById('policyBannerDesc').textContent = policy.policyRuleSummary;

    const actionsContainer = document.getElementById('policyBannerActions');
    actionsContainer.innerHTML = '';

    if (policy.enforceLrsLimit) {
      const pct = Math.min(100, Math.round((policy.lrsUsedUsd / policy.lrsAnnualCapUsd) * 100));
      actionsContainer.innerHTML = `
        <span class="badge badge-warn">🇮🇳 RBI LRS Used: $${policy.lrsUsedUsd.toLocaleString()} / $250,000 (${pct}%)</span>
      `;
    } else if (policy.blockNonUcitsEtfs) {
      actionsContainer.innerHTML = `
        <span class="badge badge-opa">🇪🇺 PRIIPs KID Filter Active (US SPY Blocked → UCITS CSPX.L Unlocked)</span>
      `;
    } else if (policy.requireCkaForDerivatives && !state.sgCkaPassed) {
      actionsContainer.innerHTML = `
        <button type="button" class="btn btn-accent btn-sm" onclick="window.OneInvestApp.openCkaQuiz()">
          📝 Pass MAS CKA Quiz to Unlock Options
        </button>
      `;
    } else if (policy.enforcePdtRule) {
      actionsContainer.innerHTML = `
        <span class="badge badge-custody">🇺🇸 FINRA PDT Status: Equity &gt; $25k Verified (${policy.pdtDayTradesUsed}/3 Day Trades)</span>
      `;
    }

    if (policy.reverseSolicitationNotice) {
      actionsContainer.innerHTML += `
        <span class="badge badge-custody">🌐 Cross-Border Reverse Solicitation Mode</span>
      `;
    }
  }

  function renderKpis() {
    const m = getPortfolioMetrics();
    document.getElementById('kpiNetWorth').textContent = formatCurrency(m.netWorthUsd, 'USD');
    document.getElementById('kpiCashPool').textContent = formatCurrency(m.cashUsd, 'USD');
    document.getElementById('kpiSweptProfits').textContent = formatCurrency(state.totalSweptProfitsUsd, 'USD');
    const availableCredit = Math.max(0, m.totalMaxLombardUsd - state.lombardLoanDrawnUsd);
    document.getElementById('kpiCreditAvailable').textContent = formatCurrency(availableCredit, 'USD');
    document.getElementById('kpiLoanSub').textContent =
      `Active Lombard Drawn: ${formatCurrency(state.lombardLoanDrawnUsd, 'USD')} @ 4.45% APR`;
  }

  function renderGlobalAssets() {
    const tbody = document.getElementById('globalAssetsTbody');
    if (!tbody) return;

    const filtered = DATA.assets.filter((a) => state.assetFilter === 'ALL' || a.category === state.assetFilter);
    tbody.innerHTML = filtered.map((asset) => {
      const elig = evaluateAssetEligibility(asset);
      const isUp = asset.changePct >= 0;
      const moveBadge = asset.category === 'FD' || asset.category === 'BOND'
        ? `<span class="text-up font-mono">${asset.yieldPct.toFixed(2)}% APY/YTM</span>`
        : `<span class="${isUp ? 'text-up' : 'text-down'} font-mono">${isUp ? '▲ +' : '▼ '}${asset.changePct.toFixed(2)}%</span> <span style="color:var(--text-secondary); font-size:0.76rem;">(Div ${asset.yieldPct}%)</span>`;

      const statusHtml = elig.allowed
        ? `<div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
             <button type="button" class="btn btn-primary btn-sm" onclick="window.OneInvestApp.openInvestModal('${asset.id}')">
               + Invest / Buy
             </button>
             <span style="font-size:0.74rem; color:var(--text-secondary);">${elig.reason}</span>
           </div>`
        : `<div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
             <span class="badge badge-danger">🔒 ${elig.reason}</span>
           </div>`;

      return `
        <tr>
          <th scope="row">
            <div style="display:flex; align-items:center; gap:0.55rem;">
              <span style="font-size:1.2rem;">${asset.flag}</span>
              <div>
                <div style="font-weight:700;">${asset.ticker} — ${asset.name}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary); font-weight:400;">${asset.description}</div>
              </div>
            </div>
          </th>
          <td><span class="badge badge-custody">${asset.subType}</span></td>
          <td>${asset.exchange} (${asset.country})</td>
          <td class="font-mono">${formatCurrency(asset.price, asset.currency)}</td>
          <td>${moveBadge}</td>
          <td class="font-mono text-accent">${asset.ltvPct}% LTV</td>
          <td>${statusHtml}</td>
        </tr>
      `;
    }).join('');
  }

  function renderDerivativesDesk() {
    const policy = DATA.jurisdictions[state.activeJurisdiction];
    document.getElementById('leverageCapBadge').textContent =
      `Max Equity Leverage: ${policy.maxEquityLeverage}:1 | FX: ${policy.maxFxLeverage}:1`;

    const gateEval = evaluateDerivativesAccess();
    const gateBox = document.getElementById('derivativesRegTechGate');

    if (gateEval.gateType === 'INDIA_FEMA_LOCK') {
      gateBox.innerHTML = `
        <div class="gate-lock-box">
          <div style="font-weight:700; color:#f87171;">🇮🇳 RBI FEMA &amp; LRS Regulatory Restriction Active</div>
          <p style="font-size:0.83rem; color:var(--text-secondary);">${gateEval.message}</p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" onclick="window.OneInvestApp.switchTab('tab-markets')">
              Invest in Cash Global Stocks, Bonds &amp; FDs
            </button>
            <button type="button" class="btn btn-accent btn-sm" onclick="window.OneInvestApp.switchJurisdiction('SG')">
              Switch to 🇸🇬 Singapore Jurisdiction to Test Options
            </button>
          </div>
        </div>
      `;
    } else if (gateEval.gateType === 'SG_MAS_CKA_QUIZ') {
      gateBox.innerHTML = `
        <div class="gate-quiz-box">
          <div style="font-weight:700; color:#fbbf24;">🇸🇬 MAS Customer Knowledge Assessment (CKA) Required</div>
          <p style="font-size:0.83rem; color:var(--text-secondary);">${gateEval.message}</p>
          <div>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.OneInvestApp.openCkaQuiz()">
              📝 Take 30-Second MAS CKA Quiz to Unlock Derivatives
            </button>
          </div>
        </div>
      `;
    } else {
      gateBox.innerHTML = `
        <div class="wallet-card" style="border-color: rgba(16, 185, 129, 0.35);">
          <div style="font-size:0.82rem; color:#34d399; font-weight:600;">✅ ${gateEval.message}</div>
        </div>
      `;
    }

    // Render Open Derivative Positions Table
    const openTbody = document.getElementById('openDerivativePosTbody');
    if (state.derivativePositions.length === 0) {
      openTbody.innerHTML = `
        <tr>
          <th scope="row" colspan="5" style="text-align:center; color:var(--text-secondary);">
            All open derivative positions have been closed &amp; swept into your Global Portfolio! Execute a new contract on the right.
          </th>
        </tr>
      `;
    } else {
      openTbody.innerHTML = state.derivativePositions.map((pos) => `
        <tr>
          <th scope="row">${pos.symbol}</th>
          <td>${pos.market}</td>
          <td class="font-mono">${pos.contracts}x</td>
          <td class="font-mono text-up">+$${pos.unrealizedPnlUsd.toLocaleString()}</td>
          <td>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.OneInvestApp.closePositionAndAutoSweep('${pos.posId}')">
              💰 Close &amp; Auto-Sweep Profit
            </button>
          </td>
        </tr>
      `).join('');
    }

    // Render Derivatives Chain Table
    const chainTbody = document.getElementById('derivativesTbody');
    chainTbody.innerHTML = DATA.derivatives.map((d) => {
      const btnHtml = gateEval.allowed
        ? `<button type="button" class="btn btn-accent btn-sm" onclick="window.OneInvestApp.executeDerivativeTrade('${d.id}')">
             ⚡ Trade (${d.leverage})
           </button>`
        : `<button type="button" class="btn btn-outline btn-sm" disabled>🔒 Gated by Policy</button>`;

      return `
        <tr>
          <th scope="row">${d.flag} ${d.symbol}</th>
          <td><span class="badge badge-opa">${d.type}</span></td>
          <td>${d.market}</td>
          <td class="font-mono">$${d.premiumUsd.toLocaleString()}</td>
          <td class="font-mono">IV ${d.iv} | Δ ${d.delta}</td>
          <td>${btnHtml}</td>
        </tr>
      `;
    }).join('');
  }

  function renderHoldingsAndSweep() {
    const tbody = document.getElementById('holdingsTbody');
    if (!tbody) return;

    tbody.innerHTML = state.holdings.map((h) => {
      const asset = DATA.assets.find((a) => a.id === h.assetId);
      if (!asset) return '';
      const unitUsd = toUsd(asset.price, asset.currency);
      const mktValUsd = unitUsd * h.units;
      const costBasisUsd = h.avgCostUsd * h.units;
      const pnlUsd = mktValUsd - costBasisUsd;
      const pnlPct = costBasisUsd > 0 ? (pnlUsd / costBasisUsd) * 100 : 0;
      const ltvValUsd = mktValUsd * (asset.ltvPct / 100);

      return `
        <tr>
          <th scope="row">${asset.flag} ${asset.ticker} — ${asset.name}</th>
          <td><span class="badge badge-custody">${asset.category}</span></td>
          <td class="font-mono">${h.units.toFixed(2)}</td>
          <td class="font-mono">$${mktValUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="font-mono ${pnlUsd >= 0 ? 'text-up' : 'text-down'}">
            ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct.toFixed(1)}%)
          </td>
          <td class="font-mono text-accent">$${ltvValUsd.toFixed(0)} (${asset.ltvPct}%)</td>
        </tr>
      `;
    }).join('');
  }

  function renderLoansAndLedger() {
    const m = getPortfolioMetrics();
    document.getElementById('loanCollateralVal').textContent = formatCurrency(m.totalMarketValueUsd, 'USD');
    document.getElementById('loanMaxLimit').textContent = formatCurrency(m.totalMaxLombardUsd, 'USD');
    document.getElementById('loanCurrentDrawn').textContent = formatCurrency(state.lombardLoanDrawnUsd, 'USD');

    const utilPct = m.totalMaxLombardUsd > 0
      ? Math.min(100, (state.lombardLoanDrawnUsd / m.totalMaxLombardUsd) * 100)
      : 0;
    document.getElementById('loanLtvPctText').textContent =
      `${utilPct.toFixed(1)}% of Max Credit Line Used (Liquidation Threshold: 95%)`;
    document.getElementById('loanLtvBar').style.width = `${utilPct}%`;

    renderLedger();
  }

  function renderLedger() {
    const tbody = document.getElementById('ledgerTbody');
    if (!tbody) return;
    tbody.innerHTML = state.ledger.map((entry) => `
      <tr>
        <th scope="row" class="font-mono" style="font-size:0.78rem;">${entry.time}</th>
        <td><span class="badge badge-opa">${entry.op}</span></td>
        <td style="font-size:0.78rem; color:var(--text-secondary);">${entry.accounts}</td>
        <td class="font-mono text-up">${entry.amount}</td>
      </tr>
    `).join('');
  }

  function renderWalletAndRegTech() {
    const grid = document.getElementById('walletBalancesGrid');
    if (grid) {
      grid.innerHTML = Object.entries(state.wallet).map(([curr, bal]) => {
        const fx = DATA.fxRates[curr];
        const usdEq = toUsd(bal, curr);
        return `
          <div class="wallet-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:700;">${fx.flag} ${curr}</span>
              <span class="badge badge-mas">${fx.yieldApr}% MMF</span>
            </div>
            <div class="font-mono" style="font-size:1.15rem; font-weight:800;">
              ${formatCurrency(bal, curr)}
            </div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">
              ≈ $${usdEq.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD • ${fx.rail}
            </div>
          </div>
        `;
      }).join('');
    }

    const policy = DATA.jurisdictions[state.activeJurisdiction];
    const stepsContainer = document.getElementById('kycStepsList');
    if (stepsContainer) {
      stepsContainer.innerHTML = policy.kycSteps.map((step, idx) => `
        <div class="wallet-card" style="padding:0.65rem 0.9rem; flex-direction:row; align-items:center; justify-content:space-between;">
          <span style="font-size:0.82rem;"><strong>Step ${idx + 1}:</strong> ${step}</span>
          <span class="badge badge-mas">✓ Verified</span>
        </div>
      `).join('');
    }

    const opaBlock = document.getElementById('opaPolicyCodeBlock');
    if (opaBlock) {
      const opaSnapshot = {
        engine: 'OpenPolicyAgent (OPA) v0.68 — Singapore MAS RegTech Core',
        active_jurisdiction: policy.code,
        regulator: policy.regulator,
        investor_classification: state.investorClass,
        kyc_orchestrator: policy.kycProvider,
        tax_documentation_active: policy.taxForms,
        permissions: {
          global_cash_equities: !policy.sanctioned,
          sovereign_and_corporate_bonds: !policy.sanctioned,
          cross_border_fixed_deposits: !policy.sanctioned,
          options_and_futures_dma: evaluateDerivativesAccess().allowed,
          non_ucits_us_etfs_allowed: !(policy.blockNonUcitsEtfs && state.investorClass === 'RETAIL'),
          max_equity_leverage_ratio: `${policy.maxEquityLeverage}:1`,
          lrs_remittance_tracker_usd: policy.enforceLrsLimit ? `${policy.lrsUsedUsd} / ${policy.lrsAnnualCapUsd}` : 'NOT_APPLICABLE'
        }
      };
      opaBlock.textContent = JSON.stringify(opaSnapshot, null, 2);
    }
  }

  // ==========================================================================
  // INTERACTIVE TRADING CHART (HTML5 CANVAS)
  // ==========================================================================
  function drawTradingChart() {
    const canvas = document.getElementById('tradingChartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle Grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = (h / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const series = state.chartSeries;
    const minVal = Math.min(...series) * 0.996;
    const maxVal = Math.max(...series) * 1.004;
    const range = Math.max(0.01, maxVal - minVal);

    const points = series.map((val, idx) => ({
      x: (idx / (series.length - 1)) * (w - 40) + 20,
      y: h - 25 - ((val - minVal) / range) * (h - 50)
    }));

    // Gradient Fill under Price Line
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(16, 185, 129, 0.38)');
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, h - 20);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, h - 20);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Main Price Line
    ctx.beginPath();
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // Draw Points & Latest Price Label
    points.forEach((p, idx) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, idx === points.length - 1 ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = idx === points.length - 1 ? '#38bdf8' : '#10b981';
      ctx.fill();
    });
  }

  function renderAll() {
    renderTopAndPolicyBanners();
    renderKpis();
    renderGlobalAssets();
    renderDerivativesDesk();
    renderHoldingsAndSweep();
    renderLoansAndLedger();
    renderWalletAndRegTech();
    drawTradingChart();
  }

  // ==========================================================================
  // USER ACTIONS & CONTROLLERS
  // ==========================================================================
  let selectedOrderAssetId = 'NVDA';

  const OneInvestApp = {
    switchTab(tabId) {
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === tabId);
      });
      document.querySelectorAll('.nav-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
      });
      if (tabId === 'tab-trading') {
        drawTradingChart();
      }
    },

    switchJurisdiction(code) {
      state.activeJurisdiction = code;
      const select = document.getElementById('jurisdictionSelect');
      if (select && select.value !== code) {
        select.value = code;
      }
      const policy = DATA.jurisdictions[code];
      addLedgerEntry(
        'OPA_POLICY_SWITCH',
        `Jurisdiction switched to ${policy.name} (${policy.regulator})`,
        policy.code
      );
      renderAll();
      showToast(
        `${policy.flag} RegTech Engine Updated: ${policy.name}`,
        policy.policyRuleSummary
      );
    },

    filterAssets(category, btnEl) {
      state.assetFilter = category;
      document.querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('active'));
      if (btnEl) btnEl.classList.add('active');
      renderGlobalAssets();
    },

    openInvestModal(assetId) {
      selectedOrderAssetId = assetId;
      const asset = DATA.assets.find((a) => a.id === assetId);
      if (!asset) return;
      const policy = DATA.jurisdictions[state.activeJurisdiction];

      const body = document.getElementById('investDialogBody');
      document.getElementById('investDialogTitle').textContent =
        `${asset.flag} Invest in ${asset.ticker} — ${asset.name}`;

      body.innerHTML = `
        <div class="wallet-card">
          <div style="display:flex; justify-content:space-between; font-size:0.82rem;">
            <span>Exchange: <strong>${asset.exchange}</strong></span>
            <span>Lombard Collateral LTV: <strong class="text-accent">${asset.ltvPct}%</strong></span>
          </div>
          <div style="font-size:1.15rem; font-weight:800; margin-top:0.25rem;" class="font-mono">
            Live Price: ${formatCurrency(asset.price, asset.currency)}
            ${asset.yieldPct ? ` • Yield: <span class="text-up">${asset.yieldPct}%</span>` : ''}
          </div>
        </div>

        <div class="field" style="margin-bottom:0.2rem;">
          <label for="orderAmountUsdInput">Investment Amount in USD (Auto-FX Routed from Unified Cash Pool)</label>
          <span id="order-amt-hint" class="hint">Minimum: $50 USD • Fractional units &amp; instant custody enabled</span>
          <input
            type="number"
            id="orderAmountUsdInput"
            class="input-control font-mono"
            required
            min="50"
            max="100000"
            step="50"
            value="1000"
            aria-describedby="order-amt-hint"
            aria-errormessage="order-amt-error"
          >
          <div id="order-amt-error" class="error-msg">
            <span aria-hidden="true">❌</span> Please enter an investment amount between $50 and $100,000 USD.
          </div>
        </div>

        <div style="font-size:0.78rem; color:var(--text-secondary);">
          RegTech Compliance Check (${policy.flag} ${policy.code}): <strong>PASSED</strong> • Custody: <strong>DBS Institutional Client Trust Account</strong>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.5rem;">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('investDialog').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">⚡ Confirm Instant Investment</button>
        </div>
      `;

      const dialog = document.getElementById('investDialog');
      dialog.showModal();
    },

    submitAssetOrder(event) {
      event.preventDefault();
      const asset = DATA.assets.find((a) => a.id === selectedOrderAssetId);
      const amountUsd = Number(document.getElementById('orderAmountUsdInput').value);
      if (!asset || isNaN(amountUsd) || amountUsd <= 0) return;

      const policy = DATA.jurisdictions[state.activeJurisdiction];
      if (policy.enforceLrsLimit) {
        if (policy.lrsUsedUsd + amountUsd > policy.lrsAnnualCapUsd) {
          showToast('🇮🇳 RBI LRS Cap Exceeded', 'Order exceeds the $250,000/FY RBI Liberalised Remittance Scheme cap.');
          return;
        }
        policy.lrsUsedUsd += amountUsd;
      }

      // Deduct from USD wallet (or convert from multi-currency pool)
      state.wallet.USD = Math.max(0, state.wallet.USD - amountUsd);

      const unitPriceUsd = toUsd(asset.price, asset.currency);
      const unitsBought = amountUsd / unitPriceUsd;

      const existing = state.holdings.find((h) => h.assetId === asset.id);
      if (existing) {
        const totalCost = existing.avgCostUsd * existing.units + amountUsd;
        existing.units += unitsBought;
        existing.avgCostUsd = totalCost / existing.units;
      } else {
        state.holdings.unshift({
          assetId: asset.id,
          units: unitsBought,
          avgCostUsd: unitPriceUsd
        });
      }

      addLedgerEntry(
        `BUY_${asset.category}`,
        `DR: Segregated Custody (${asset.ticker} +${unitsBought.toFixed(2)}) | CR: Multi-Currency Cash Pool`,
        `$${amountUsd.toLocaleString()}`
      );

      document.getElementById('investDialog').close();
      renderAll();
      showToast(
        `✅ Invested $${amountUsd.toLocaleString()} in ${asset.ticker}`,
        `Acquired ${unitsBought.toFixed(3)} units on ${asset.exchange}. Lombard Credit Line automatically increased!`
      );
    },

    changeChartSymbol(symbol) {
      state.activeChartSymbol = symbol;
      const baseMap = {
        'NVDA': { label: 'NVDA (NASDAQ)', price: '$138.60 (+3.42%)', base: 138.6 },
        'ESZ6': { label: 'ESZ6 S&P 500 E-Mini Future (CME)', price: '5,842.50 (+0.88%)', base: 5842.5 },
        'D05.SI': { label: 'D05.SI DBS Group (SGX)', price: 'S$39.25 (+0.85%)', base: 39.25 },
        'RELIANCE.NS': { label: 'RELIANCE.NS (NSE India)', price: '₹2,745.80 (+1.64%)', base: 2745.8 },
        'GCZ6': { label: 'GCZ6 Gold Future (COMEX)', price: '$2,738.40 (+1.15%)', base: 2738.4 }
      };
      const info = baseMap[symbol] || baseMap.NVDA;
      document.getElementById('chartHeaderTicker').textContent = info.label;
      document.getElementById('chartHeaderPrice').textContent = info.price;

      const b = info.base;
      state.chartSeries = [
        b * 0.96, b * 0.965, b * 0.962, b * 0.971, b * 0.978,
        b * 0.974, b * 0.982, b * 0.988, b * 0.985, b * 0.991,
        b * 0.995, b * 0.993, b * 0.998, b
      ];
      drawTradingChart();
    },

    executeDerivativeTrade(contractId) {
      const gateEval = evaluateDerivativesAccess();
      if (!gateEval.allowed) {
        showToast('🔒 Derivatives Gated by RegTech Policy', gateEval.message);
        return;
      }

      const d = DATA.derivatives.find((item) => item.id === contractId);
      if (!d) return;

      const policy = DATA.jurisdictions[state.activeJurisdiction];
      if (policy.enforcePdtRule) {
        policy.pdtDayTradesUsed += 1;
      }

      const newPos = {
        posId: 'POS-' + Math.floor(100 + Math.random() * 900),
        contractId: d.id,
        symbol: d.symbol,
        type: d.type,
        market: d.market,
        contracts: 2,
        entryPremiumUsd: d.premiumUsd,
        currentPremiumUsd: +(d.premiumUsd * 1.18).toFixed(2),
        marginCommittedUsd: d.premiumUsd * 2,
        unrealizedPnlUsd: Math.round(d.premiumUsd * 2 * 0.35)
      };

      state.derivativePositions.unshift(newPos);
      addLedgerEntry(
        'DMA_DERIVATIVE_EXEC',
        `Opened 2x ${d.symbol} on ${d.market}`,
        `$${newPos.marginCommittedUsd.toLocaleString()}`
      );
      renderAll();
      showToast(
        `🎯 Order Filled: 2x ${d.symbol}`,
        `Routed via ${d.market}. Position is now live with 1-click Profit Auto-Sweep enabled.`
      );
    },

    closePositionAndAutoSweep(posId) {
      const idx = state.derivativePositions.findIndex((p) => p.posId === posId);
      if (idx === -1) return;
      const pos = state.derivativePositions[idx];
      state.derivativePositions.splice(idx, 1);

      const realizedProfit = pos.unrealizedPnlUsd;
      this.simulateProfitPayout(realizedProfit, `Realized Profit from closing ${pos.symbol}`);
    },

    updateSweepSliders(changedKey, rawVal) {
      const val = Math.max(0, Math.min(100, Number(rawVal)));
      state.sweepRules[changedKey] = val;

      const otherKeys = ['bond', 'fd', 'stock'].filter((k) => k !== changedKey);
      const remainder = 100 - val;
      const firstOther = Math.round(remainder / 2);
      const secondOther = remainder - firstOther;

      state.sweepRules[otherKeys[0]] = firstOther;
      state.sweepRules[otherKeys[1]] = secondOther;

      document.getElementById('sweepBondSlider').value = state.sweepRules.bond;
      document.getElementById('sweepFdSlider').value = state.sweepRules.fd;
      document.getElementById('sweepStockSlider').value = state.sweepRules.stock;

      document.getElementById('sweepBondPctLabel').textContent = `${state.sweepRules.bond}%`;
      document.getElementById('sweepFdPctLabel').textContent = `${state.sweepRules.fd}%`;
      document.getElementById('sweepStockPctLabel').textContent = `${state.sweepRules.stock}%`;
    },

    simulateProfitPayout(profitUsd, customSource) {
      const bondAmt = +(profitUsd * (state.sweepRules.bond / 100)).toFixed(2);
      const fdAmt = +(profitUsd * (state.sweepRules.fd / 100)).toFixed(2);
      const stockAmt = +(profitUsd - bondAmt - fdAmt).toFixed(2);

      // 1. Allocate Bond share to UST-10Y
      const bondAsset = DATA.assets.find((a) => a.id === 'UST-10Y');
      const bondHold = state.holdings.find((h) => h.assetId === 'UST-10Y');
      if (bondAsset && bondHold) {
        bondHold.units += bondAmt / bondAsset.price;
      }

      // 2. Allocate FD share to FD-JPM-US (4.90% APY CD)
      const fdAsset = DATA.assets.find((a) => a.id === 'FD-JPM-US');
      const fdHold = state.holdings.find((h) => h.assetId === 'FD-JPM-US');
      if (fdAsset && fdHold) {
        fdHold.units += fdAmt / fdAsset.price;
      }

      // 3. Allocate Equity share to CSPX.L (UCITS S&P 500)
      const stockAsset = DATA.assets.find((a) => a.id === 'CSPX.L');
      const stockHold = state.holdings.find((h) => h.assetId === 'CSPX.L');
      if (stockAsset && stockHold) {
        stockHold.units += stockAmt / stockAsset.price;
      }

      state.totalSweptProfitsUsd += profitUsd;

      addLedgerEntry(
        'PROFIT_AUTO_SWEEP',
        `${customSource || 'Trade Profit'}: $${bondAmt} → UST-10Y Bond | $${fdAmt} → JPMorgan FD | $${stockAmt} → S&P 500 ETF`,
        `+$${profitUsd.toLocaleString()}`
      );

      renderAll();
      showToast(
        `🔄 +$${profitUsd.toLocaleString()} Profit Auto-Reinvested (T+0)`,
        `Swept $${bondAmt} into US 10Y Bonds, $${fdAmt} into 4.90% Fixed Deposits, and $${stockAmt} into Global Equities without leaving One Invest!`
      );
    },

    sweepIdleCash(amountUsd) {
      if (state.wallet.USD < amountUsd) {
        showToast('Insufficient USD Cash', 'Convert currency in the FX Wallet or draw a Lombard Credit line first.');
        return;
      }
      state.wallet.USD -= amountUsd;
      this.simulateProfitPayout(amountUsd, 'Idle Cash Pool Sweep');
    },

    drawLombardLoan() {
      const m = getPortfolioMetrics();
      const amount = Number(document.getElementById('loanDrawAmountInput').value);
      if (isNaN(amount) || amount <= 0) return;

      if (state.lombardLoanDrawnUsd + amount > m.totalMaxLombardUsd) {
        showToast('Lombard LTV Limit Reached', 'Requested loan exceeds maximum portfolio collateral LTV.');
        return;
      }

      state.lombardLoanDrawnUsd += amount;
      state.wallet.USD += amount;

      addLedgerEntry(
        'SBLOC_DRAWDOWN',
        'DR: Client Multi-Currency Wallet (USD) | CR: MAS CMS Lombard Loan Facility (4.45% APR)',
        `+$${amount.toLocaleString()}`
      );
      renderAll();
      showToast(
        `🏦 $${amount.toLocaleString()} Lombard Credit Disbursed`,
        'Instant liquidity added to your USD Cash Pool against your Stocks, Bonds & FDs (0s settlement).'
      );
    },

    repayLombardLoan() {
      const amount = Number(document.getElementById('loanDrawAmountInput').value);
      const repayAmt = Math.min(state.lombardLoanDrawnUsd, amount, state.wallet.USD);
      if (repayAmt <= 0) {
        showToast('No Repayment Needed', 'Either loan balance is $0 or USD cash balance is insufficient.');
        return;
      }
      state.lombardLoanDrawnUsd -= repayAmt;
      state.wallet.USD -= repayAmt;

      addLedgerEntry(
        'SBLOC_REPAYMENT',
        'DR: MAS CMS Lombard Loan Facility | CR: Client Multi-Currency Wallet (USD)',
        `-$${repayAmt.toLocaleString()}`
      );
      renderAll();
      showToast(
        `✅ Repaid $${repayAmt.toLocaleString()} Lombard Credit`,
        `Remaining Lombard Loan balance: $${state.lombardLoanDrawnUsd.toLocaleString()}.`
      );
    },

    disburseEmbeddedBankLoan(amountUsd) {
      state.embeddedBankLoanUsd += amountUsd;
      state.wallet.USD += amountUsd;
      addLedgerEntry(
        'PARTNER_BANK_LOAN',
        'DR: Client Cash Pool (USD) | CR: Partner Bank Co-Lending Facility (5.20% APR)',
        `+$${amountUsd.toLocaleString()}`
      );
      renderAll();
      showToast(
        `💳 $${amountUsd.toLocaleString()} Partner Bank Loan Disbursed`,
        'Funds credited to your Unified Cash Pool and ready for global investing or withdrawal.'
      );
    },

    executeFxSwap() {
      const amount = Number(document.getElementById('fxAmountInput').value);
      const fromCurr = document.getElementById('fxFromSelect').value;
      const toCurr = document.getElementById('fxToSelect').value;

      if (fromCurr === toCurr || isNaN(amount) || amount <= 0) return;
      if ((state.wallet[fromCurr] || 0) < amount) {
        showToast('Insufficient Currency Balance', `Not enough ${fromCurr} in wallet for this swap.`);
        return;
      }

      state.wallet[fromCurr] -= amount;
      const usdVal = toUsd(amount, fromCurr) * 0.9996; // 0.04% institutional spread
      const received = fromUsd(usdVal, toCurr);
      state.wallet[toCurr] = (state.wallet[toCurr] || 0) + received;

      addLedgerEntry(
        'WHOLESALE_FX_SWAP',
        `Converted ${formatCurrency(amount, fromCurr)} ${fromCurr} → ${formatCurrency(received, toCurr)} ${toCurr} @ 0.04% spread`,
        `${formatCurrency(received, toCurr)}`
      );
      renderAll();
      showToast(
        `💱 Wholesale FX Swap Completed`,
        `Swapped ${formatCurrency(amount, fromCurr)} ${fromCurr} into ${formatCurrency(received, toCurr)} ${toCurr} instantly.`
      );
    },

    openCkaQuiz() {
      document.getElementById('ckaQuizDialog').showModal();
    },

    completeCkaQuiz(event) {
      event.preventDefault();
      state.sgCkaPassed = true;
      document.getElementById('ckaQuizDialog').close();
      addLedgerEntry(
        'MAS_CKA_CERTIFIED',
        'Customer Knowledge Assessment (SFA 04-N12) Passed — SIP Derivatives Unlocked',
        'CERTIFIED'
      );
      renderAll();
      showToast(
        '🇸🇬 MAS CKA / CAT Assessment Passed!',
        'Specified Investment Products (Global Options & Futures) are now unlocked for your Singapore account.'
      );
    },

    openKycDialog() {
      const policy = DATA.jurisdictions[state.activeJurisdiction];
      const banner = document.getElementById('kycDynamicProviderBanner');
      if (banner) {
        banner.innerHTML = `
          <div style="font-weight:700; color:#38bdf8;">${policy.flag} ${policy.name} Identity Pipeline: ${policy.kycProvider}</div>
          <div style="font-size:0.78rem; color:var(--text-secondary);">
            Verification Speed: <strong>${policy.kycSpeed}</strong> • Auto Tax Forms: <strong>${policy.taxForms.join(', ')}</strong>
          </div>
        `;
      }
      document.getElementById('kycOnboardingDialog').showModal();
    },

    setInvestorClass(cls) {
      state.investorClass = cls;
      renderAll();
    },

    submitKycOnboarding(event) {
      event.preventDefault();
      const email = document.getElementById('kycEmail').value;
      const taxId = document.getElementById('kycTaxId').value;
      const policy = DATA.jurisdictions[state.activeJurisdiction];

      document.getElementById('kycOnboardingDialog').close();
      addLedgerEntry(
        'KYC_TAX_ONBOARD',
        `Verified ${email} (ID: ${taxId}) via ${policy.kycProvider} [${state.investorClass}]`,
        'APPROVED'
      );
      renderAll();
      showToast(
        `🔐 KYC & Tax Certificates Issued (${policy.flag} ${policy.code})`,
        `Verified via ${policy.kycProvider}. Generated ${policy.taxForms.join(' & ')}.`
      );
    }
  };

  window.OneInvestApp = OneInvestApp;

  // ==========================================================================
  // MODERN WEB GUIDANCE MANDATORY FALLBACKS & INITIALIZATION
  // 1. <dialog closedby="any"> fallback for browsers without native closedBy
  // 2. :user-invalid WeakMap fallback & aria-invalid synchronization
  // ==========================================================================
  function initModernWebGuidanceFallbacks() {
    // 1. Light-dismiss dialog fallback (check if click occurred outside dialog content box)
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      document.querySelectorAll('dialog').forEach((dialog) => {
        dialog.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent = (
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width
          );
          if (isDialogContent) return;
          dialog.close();
        });
      });
    }

    // 2. :user-invalid WeakMap fallback for browsers without CSS :user-invalid support
    const UserInvalidFallback = (() => {
      const dirtyState = new WeakMap();

      const updateState = (input) => {
        const isValid = input.checkValidity();
        input.classList.toggle('user-invalid-fallback', !isValid);
        input.classList.toggle('user-valid-fallback', isValid);
        if (!isValid) {
          input.setAttribute('aria-invalid', 'true');
        } else {
          input.removeAttribute('aria-invalid');
        }
      };

      const handleEvent = (event) => {
        const input = event.target;
        if (event.type === 'reset') {
          const controls = input.elements || [];
          for (const control of controls) {
            dirtyState.delete(control);
            control.classList.remove('user-invalid-fallback', 'user-valid-fallback');
            control.removeAttribute('aria-invalid');
          }
          return;
        }
        if (!input || !input.checkValidity) return;

        if (event.type === 'input' || event.type === 'change') {
          const st = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
          st.hasInteracted = true;
          dirtyState.set(input, st);
          if (st.hasBlurred) updateState(input);
        } else if (event.type === 'blur') {
          const st = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
          st.hasBlurred = true;
          dirtyState.set(input, st);
          if (st.hasInteracted) updateState(input);
        }
      };

      const init = (root = document) => {
        if (CSS.supports('selector(:user-invalid)')) return;
        root.addEventListener('blur', handleEvent, true);
        root.addEventListener('input', handleEvent);
        root.addEventListener('change', handleEvent);
        root.addEventListener('reset', handleEvent, true);
      };

      return { init };
    })();

    UserInvalidFallback.init(document);

    // Sync aria-invalid with native CSS :user-invalid state
    const syncAria = (el) => {
      if (el && typeof el.matches === 'function' && el.tagName === 'INPUT') {
        el.setAttribute?.('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
      }
    };
    document.addEventListener('blur', (e) => syncAria(e.target), true);
    document.addEventListener('input', (e) => {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('aria-invalid')) {
        syncAria(e.target);
      }
    });
  }

  // Initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    initModernWebGuidanceFallbacks();
    renderAll();

    // Live subtle market price & chart tick simulation every 3.5 seconds
    setInterval(() => {
      const last = state.chartSeries[state.chartSeries.length - 1];
      const delta = (Math.random() - 0.46) * (last * 0.003);
      const nextVal = +(last + delta).toFixed(2);
      state.chartSeries.shift();
      state.chartSeries.push(nextVal);
      drawTradingChart();
    }, 3500);
  });
})();
