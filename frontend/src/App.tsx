import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Crosshair, ShieldAlert, ChevronDown, Info, Loader2, WifiOff } from 'lucide-react';
import { fetchAssets, fetchCone, fetchProbability, fetchPositionRisk } from './api';
import type { Asset, ConePoint, ConeRenderData, ProbabilityResponse, PositionRiskResponse } from './types';
import ProbabilityCone3D from './ProbabilityCone3D';
import DistributionChart from './DistributionChart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveConeRenderData(
  points: ConePoint[],
  currentPrice: number,
  horizon: string,
): ConeRenderData {
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const p of points) {
    if (p.p005 < minPrice) minPrice = p.p005;
    if (p.p995 > maxPrice) maxPrice = p.p995;
  }
  const range = maxPrice - minPrice;
  minPrice = Math.max(0, minPrice - range * 0.1);
  maxPrice = maxPrice + range * 0.1;

  const finalPoint = points[points.length - 1];
  const horizonYears = horizon === '1h' ? 1 / (365.25 * 24) : 1 / 365.25;
  const spread = Math.log(finalPoint.p995 / finalPoint.p005);
  const volatility = spread / (5.152 * Math.sqrt(horizonYears));
  const spreadPct = (finalPoint.p995 - finalPoint.p005) / currentPrice;

  return { minPrice, maxPrice, currentPrice, volatility, spreadPct };
}

function formatPrice(price: number, symbol: string): string {
  if (symbol === 'BTC') {
    return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roundForAsset(price: number, symbol: string): number {
  if (symbol === 'BTC') return Math.round(price);
  return Math.round(price * 100) / 100;
}

function horizonLabel(h: string): string {
  return h === '1h' ? '1 hour' : '24 hours';
}

type QueryMode = 'above' | 'below' | 'between';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  // Core state
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC');
  const [activeTab, setActiveTab] = useState<'explorer' | 'scanner'>('explorer');
  const [horizon, setHorizon] = useState<string>('24h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 3D cone + 2D chart
  const [coneRenderData, setConeRenderData] = useState<ConeRenderData | null>(null);
  const [conePoints, setConePoints] = useState<ConePoint[]>([]);
  const [coneCurrentPrice, setConeCurrentPrice] = useState<number>(0);
  const horizonDays = horizon === '1h' ? 1 / 24 : 1;

  // Explorer state
  const [queryMode, setQueryMode] = useState<QueryMode>('above');
  const [targetPrice, setTargetPrice] = useState<number>(0);
  const [lowerBound, setLowerBound] = useState<number>(0);
  const [upperBound, setUpperBound] = useState<number>(0);
  const [probResult, setProbResult] = useState<ProbabilityResponse | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);

  // Scanner state
  const [entryPrice, setEntryPrice] = useState<number>(0);
  const [leverage, setLeverage] = useState<number>(10);
  const [isLong, setIsLong] = useState(true);
  const [takeProfit, setTakeProfit] = useState<number | undefined>(undefined);
  const [stopLoss, setStopLoss] = useState<number | undefined>(undefined);
  const [riskResult, setRiskResult] = useState<PositionRiskResponse | null>(null);
  const [scannerLoading, setScannerLoading] = useState(false);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.symbol === selectedSymbol) ?? null,
    [assets, selectedSymbol],
  );

  const supports1h = selectedAsset?.horizons.includes('1h') ?? false;
  const currentSymbol = selectedAsset?.symbol ?? 'BTC';

  // ── Set explorer defaults for a given price and mode ────────────────
  function applyExplorerDefaults(price: number, symbol: string, mode: QueryMode) {
    if (mode === 'above') {
      setTargetPrice(roundForAsset(price * 1.02, symbol));
    } else if (mode === 'below') {
      setTargetPrice(roundForAsset(price * 0.98, symbol));
    } else {
      setLowerBound(roundForAsset(price * 0.95, symbol));
      setUpperBound(roundForAsset(price * 1.05, symbol));
    }
  }

  // ── Load assets on mount ────────────────────────────────────────────
  useEffect(() => {
    fetchAssets()
      .then((a) => {
        setAssets(a);
        if (a.length > 0) {
          const first = a[0];
          setSelectedSymbol(first.symbol);
          if (first.current_price) {
            setEntryPrice(first.current_price);
            applyExplorerDefaults(first.current_price, first.symbol, 'above');
          }
        }
      })
      .catch(() => setError('Cannot connect to Prism API'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load cone when asset or horizon changes ─────────────────────────
  useEffect(() => {
    if (!selectedSymbol) return;
    setLoading(true);
    setError(null);
    fetchCone(selectedSymbol, horizon)
      .then((cone) => {
        setConeRenderData(deriveConeRenderData(cone.points, cone.current_price, horizon));
        setConePoints(cone.points);
        setConeCurrentPrice(cone.current_price);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setError('Cannot connect to Prism API');
      });
  }, [selectedSymbol, horizon]);

  // ── Reset defaults on asset change ──────────────────────────────────
  useEffect(() => {
    if (!selectedAsset?.current_price) return;
    const price = selectedAsset.current_price;
    setEntryPrice(price);
    applyExplorerDefaults(price, selectedAsset.symbol, queryMode);
    setTakeProfit(undefined);
    setStopLoss(undefined);
    setProbResult(null);
    setRiskResult(null);
    if (!selectedAsset.horizons.includes(horizon)) {
      setHorizon('24h');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol]);

  // ── Reset explorer defaults on mode change ──────────────────────────
  useEffect(() => {
    if (!selectedAsset?.current_price) return;
    applyExplorerDefaults(selectedAsset.current_price, selectedAsset.symbol, queryMode);
    setProbResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryMode]);

  // ── Debounced probability fetch (Explorer) ──────────────────────────
  useEffect(() => {
    if (activeTab !== 'explorer' || !selectedSymbol) return;

    let lower: number | undefined;
    let upper: number | undefined;

    if (queryMode === 'above') {
      if (!targetPrice || targetPrice <= 0) return;
      lower = targetPrice;
    } else if (queryMode === 'below') {
      if (!targetPrice || targetPrice <= 0) return;
      upper = targetPrice;
    } else {
      if (!lowerBound || !upperBound || lowerBound <= 0 || upperBound <= 0 || lowerBound >= upperBound) return;
      lower = lowerBound;
      upper = upperBound;
    }

    const timer = setTimeout(() => {
      setExplorerLoading(true);
      fetchProbability(selectedSymbol, lower, upper, horizon)
        .then((result) => {
          setProbResult(result);
          if (result.cone) {
            setConeRenderData(deriveConeRenderData(result.cone.points, result.cone.current_price, horizon));
            setConePoints(result.cone.points);
            setConeCurrentPrice(result.cone.current_price);
          }
          setExplorerLoading(false);
        })
        .catch(() => setExplorerLoading(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedSymbol, queryMode, targetPrice, lowerBound, upperBound, horizon, activeTab]);

  // ── Debounced position risk fetch (Scanner) ─────────────────────────
  useEffect(() => {
    if (activeTab !== 'scanner' || !selectedSymbol || !entryPrice || !leverage || entryPrice <= 0 || leverage < 1) return;
    const timer = setTimeout(() => {
      setScannerLoading(true);
      fetchPositionRisk(
        selectedSymbol,
        entryPrice,
        leverage,
        isLong ? 'LONG' : 'SHORT',
        takeProfit,
        stopLoss,
        horizon,
      )
        .then((result) => {
          setRiskResult(result);
          if (result.cone_with_levels?.cone) {
            setConeRenderData(
              deriveConeRenderData(result.cone_with_levels.cone, result.current_price, horizon),
            );
            setConePoints(result.cone_with_levels.cone);
            setConeCurrentPrice(result.current_price);
          }
          setScannerLoading(false);
        })
        .catch(() => setScannerLoading(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedSymbol, entryPrice, leverage, isLong, takeProfit, stopLoss, horizon, activeTab]);

  // ── Derived display values ──────────────────────────────────────────
  const displayProb = probResult?.probability ?? 0;
  const probBelowLower = probResult?.probability_below_lower ?? 0;
  const probAboveUpper = probResult?.probability_above_upper ?? 0;

  const liqProb = riskResult?.liquidation.probability ?? 0;
  const liqPrice = riskResult?.liquidation.price ?? 0;
  const riskScore = riskResult?.risk_score.score ?? 0;
  const probTP = riskResult?.take_profit?.probability ?? 0;
  const probSL = riskResult?.stop_loss?.probability ?? 0;

  // ── Cone overlay props ──────────────────────────────────────────────
  let coneHighlightRange: [number, number] | undefined;
  let coneTargetLine: number | undefined;

  if (activeTab === 'explorer') {
    if (queryMode === 'above' && targetPrice > 0) {
      coneHighlightRange = [targetPrice, (coneRenderData?.maxPrice ?? targetPrice * 2)];
      coneTargetLine = targetPrice;
    } else if (queryMode === 'below' && targetPrice > 0) {
      coneHighlightRange = [(coneRenderData?.minPrice ?? 0), targetPrice];
      coneTargetLine = targetPrice;
    } else if (queryMode === 'between' && lowerBound > 0 && upperBound > 0) {
      coneHighlightRange = [lowerBound, upperBound];
    }
  }

  const liquidationPriceForCone = activeTab === 'scanner' ? riskResult?.liquidation.price : undefined;
  const tpForCone = activeTab === 'scanner' ? riskResult?.take_profit?.price : undefined;
  const slForCone = activeTab === 'scanner' ? riskResult?.stop_loss?.price : undefined;

  // ── Price input blur handler ────────────────────────────────────────
  function roundOnBlur(value: number, setter: (v: number) => void) {
    if (value > 0) setter(roundForAsset(value, currentSymbol));
  }

  // ── Error overlay ───────────────────────────────────────────────────
  if (error && assets.length === 0) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <WifiOff className="w-12 h-12 text-white/30 mx-auto" />
          <h2 className="text-xl font-light tracking-wider">Cannot connect to Prism API</h2>
          <p className="text-sm text-white/50">Ensure the backend is running on {import.meta.env.VITE_API_URL || 'http://localhost:8000'}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Explorer output panel ───────────────────────────────────────────
  function renderExplorerOutput() {
    if (queryMode === 'between') {
      return (
        <motion.div
          key="explorer-between"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.3 }}
          className="bg-black/40 backdrop-blur-xl p-8 rounded-3xl border border-white/10 shadow-2xl"
        >
          <div className="text-center mb-8 relative">
            {explorerLoading && (
              <div className="absolute -top-2 right-0">
                <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
              </div>
            )}
            <div className="text-[10px] font-medium text-white/50 uppercase tracking-widest mb-2">Probability in Range</div>
            <div className="text-7xl font-light text-white tracking-tighter">
              {(displayProb * 100).toFixed(1)}<span className="text-4xl text-white/40">%</span>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-1 h-1.5 rounded-full overflow-hidden bg-white/5">
              <div style={{ width: `${probBelowLower * 100}%` }} className="h-full bg-white/20" />
              <div style={{ width: `${displayProb * 100}%` }} className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
              <div style={{ width: `${probAboveUpper * 100}%` }} className="h-full bg-white/20" />
            </div>

            <div className="flex justify-between text-xs font-mono">
              <div className="flex flex-col">
                <span className="text-white/40 uppercase text-[10px] tracking-widest mb-1">Below</span>
                <span className="text-white/80">{(probBelowLower * 100).toFixed(1)}%</span>
              </div>
              <div className="flex flex-col text-right">
                <span className="text-white/40 uppercase text-[10px] tracking-widest mb-1">Above</span>
                <span className="text-white/80">{(probAboveUpper * 100).toFixed(1)}%</span>
              </div>
            </div>

            {probResult && (
              <div className="pt-6 border-t border-white/10">
                <div className="flex items-start gap-3">
                  <Info className="w-4 h-4 text-white/40 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/60 leading-relaxed">
                    The model indicates a <span className="text-white font-medium">{(displayProb * 100).toFixed(1)}%</span> probability
                    that {selectedAsset?.name} will land between ${formatPrice(lowerBound, currentSymbol)} and
                    ${formatPrice(upperBound, currentSymbol)} within {horizonLabel(horizon)}.
                    <span className="ml-1 text-white/40">(Confidence: {probResult.confidence})</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      );
    }

    // Above or Below mode
    const isAbove = queryMode === 'above';
    const complement = 1 - displayProb;

    return (
      <motion.div
        key={`explorer-${queryMode}`}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.3 }}
        className="bg-black/40 backdrop-blur-xl p-8 rounded-3xl border border-white/10 shadow-2xl"
      >
        <div className="text-center mb-8 relative">
          {explorerLoading && (
            <div className="absolute -top-2 right-0">
              <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
            </div>
          )}
          <div className="text-[10px] font-medium text-white/50 uppercase tracking-widest mb-2">
            Probability {isAbove ? 'Above' : 'Below'}
          </div>
          <div className="text-7xl font-light text-white tracking-tighter">
            {(displayProb * 100).toFixed(1)}<span className="text-4xl text-white/40">%</span>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-1 h-1.5 rounded-full overflow-hidden bg-white/5">
            <div
              style={{ width: `${(isAbove ? complement : displayProb) * 100}%` }}
              className={`h-full ${isAbove ? 'bg-white/20' : 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]'}`}
            />
            <div
              style={{ width: `${(isAbove ? displayProb : complement) * 100}%` }}
              className={`h-full ${isAbove ? 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]' : 'bg-white/20'}`}
            />
          </div>

          <div className="flex justify-between text-xs font-mono">
            <div className="flex flex-col">
              <span className="text-white/40 uppercase text-[10px] tracking-widest mb-1">Below</span>
              <span className="text-white/80">{((isAbove ? complement : displayProb) * 100).toFixed(1)}%</span>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-white/40 uppercase text-[10px] tracking-widest mb-1">Above</span>
              <span className="text-white/80">{((isAbove ? displayProb : complement) * 100).toFixed(1)}%</span>
            </div>
          </div>

          {probResult && (
            <div className="pt-6 border-t border-white/10">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-white/40 shrink-0 mt-0.5" />
                <p className="text-xs text-white/60 leading-relaxed">
                  The model indicates a <span className="text-white font-medium">{(displayProb * 100).toFixed(1)}%</span> probability
                  that {selectedAsset?.name} will {isAbove ? 'go above' : 'drop below'} ${formatPrice(targetPrice, currentSymbol)} within {horizonLabel(horizon)}.
                  <span className="ml-1 text-white/40">(Confidence: {probResult.confidence})</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <div className="relative min-h-screen bg-black text-white font-sans overflow-hidden selection:bg-white/20">
      {/* 3D Background */}
      <ProbabilityCone3D
        data={coneRenderData}
        horizonDays={horizonDays}
        targetLine={coneTargetLine}
        liquidationPrice={liquidationPriceForCone}
        takeProfit={tpForCone}
        stopLoss={slForCone}
      />

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10">

        {/* Top Left: Branding & Asset Selection */}
        <div className="absolute top-8 left-8 pointer-events-auto flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-light tracking-widest uppercase">Prism</h1>
          </div>

          <div className="h-8 w-px bg-white/20" />

          <div className="relative group">
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="appearance-none bg-transparent text-xl font-medium focus:outline-none pr-8 cursor-pointer text-white/90 group-hover:text-white transition-colors"
            >
              {assets.map((a) => (
                <option key={a.symbol} value={a.symbol} className="bg-black text-white">
                  {a.name} ({a.symbol})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 text-white/50 pointer-events-none group-hover:text-white/90 transition-colors" />
          </div>

          <div className="flex items-center gap-4 ml-4">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-white/40">Current</span>
              <span className="font-mono text-sm">
                ${selectedAsset?.current_price != null ? formatPrice(selectedAsset.current_price, currentSymbol) : '—'}
              </span>
            </div>
            {coneRenderData && (
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Vol</span>
                <span className="font-mono text-sm">{(coneRenderData.volatility * 100).toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Top Right: Status */}
        <div className="absolute top-8 right-8 pointer-events-auto flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-md border border-white/10 rounded-full text-xs font-medium text-white/70">
            <div className={`w-2 h-2 rounded-full ${error ? 'bg-rose-400' : 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]'}`} />
            Synth Network
          </div>
        </div>

        {/* Left Panel: Inputs */}
        <div className="absolute top-1/2 -translate-y-1/2 left-8 pointer-events-auto w-80">
          <AnimatePresence mode="wait">
            {activeTab === 'explorer' ? (
              <motion.div
                key="explorer-inputs"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="bg-black/40 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-2xl"
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2 bg-white/10 rounded-lg">
                    <Crosshair className="w-4 h-4 text-white" />
                  </div>
                  <h2 className="text-sm font-medium uppercase tracking-widest text-white/80">Price Query</h2>
                </div>

                {/* Mode Toggle */}
                <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 mb-5">
                  {(['above', 'below', 'between'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setQueryMode(mode)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${queryMode === mode ? 'bg-white text-black shadow-sm' : 'text-white/50 hover:text-white'}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                {/* Inputs based on mode */}
                <div className="space-y-5">
                  {queryMode === 'between' ? (
                    <>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">Upper Bound</label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-mono text-sm">$</span>
                          <input
                            type="number"
                            value={upperBound || ''}
                            onChange={(e) => setUpperBound(Number(e.target.value))}
                            onBlur={() => roundOnBlur(upperBound, setUpperBound)}
                            className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-xl pl-8 pr-4 py-3 focus:outline-none focus:ring-1 focus:ring-white/30 font-mono transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">Lower Bound</label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-mono text-sm">$</span>
                          <input
                            type="number"
                            value={lowerBound || ''}
                            onChange={(e) => setLowerBound(Number(e.target.value))}
                            onBlur={() => roundOnBlur(lowerBound, setLowerBound)}
                            className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-xl pl-8 pr-4 py-3 focus:outline-none focus:ring-1 focus:ring-white/30 font-mono transition-all"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">Target Price</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-mono text-sm">$</span>
                        <input
                          type="number"
                          value={targetPrice || ''}
                          onChange={(e) => setTargetPrice(Number(e.target.value))}
                          onBlur={() => roundOnBlur(targetPrice, setTargetPrice)}
                          className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-xl pl-8 pr-4 py-3 focus:outline-none focus:ring-1 focus:ring-white/30 font-mono transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="scanner-inputs"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="bg-black/40 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-2xl"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-white/10 rounded-lg">
                    <ShieldAlert className="w-4 h-4 text-white" />
                  </div>
                  <h2 className="text-sm font-medium uppercase tracking-widest text-white/80">Position Setup</h2>
                </div>

                <div className="space-y-5">
                  <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                    <button
                      onClick={() => setIsLong(true)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${isLong ? 'bg-white text-black shadow-sm' : 'text-white/50 hover:text-white'}`}
                    >
                      Long
                    </button>
                    <button
                      onClick={() => setIsLong(false)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${!isLong ? 'bg-white text-black shadow-sm' : 'text-white/50 hover:text-white'}`}
                    >
                      Short
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">Entry</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 font-mono text-xs">$</span>
                        <input
                          type="number"
                          value={entryPrice || ''}
                          onChange={(e) => setEntryPrice(Number(e.target.value))}
                          className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-xl pl-6 pr-2 py-2.5 focus:outline-none focus:ring-1 focus:ring-white/30 font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">Leverage</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={leverage || ''}
                          onChange={(e) => setLeverage(Number(e.target.value))}
                          className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-white/30 font-mono"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 font-mono text-xs">x</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-emerald-400/70 mb-2">Take Profit</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400/50 font-mono text-xs">$</span>
                        <input
                          type="number"
                          value={takeProfit ?? ''}
                          onChange={(e) => setTakeProfit(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-100 text-sm rounded-xl pl-6 pr-2 py-2.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 font-mono"
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-rose-400/70 mb-2">Stop Loss</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400/50 font-mono text-xs">$</span>
                        <input
                          type="number"
                          value={stopLoss ?? ''}
                          onChange={(e) => setStopLoss(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full bg-rose-500/10 border border-rose-500/20 text-rose-100 text-sm rounded-xl pl-6 pr-2 py-2.5 focus:outline-none focus:ring-1 focus:ring-rose-500/50 font-mono"
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Panel: Outputs */}
        <div className="absolute top-1/2 -translate-y-1/2 right-8 pointer-events-auto w-96">
          <AnimatePresence mode="wait">
            {activeTab === 'explorer' ? (
              renderExplorerOutput()
            ) : (
              <motion.div
                key="scanner-outputs"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
                className="bg-black/40 backdrop-blur-xl p-8 rounded-3xl border border-white/10 shadow-2xl"
              >
                <div className="text-center mb-8 relative">
                  {scannerLoading && (
                    <div className="absolute -top-2 right-0">
                      <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
                    </div>
                  )}
                  <div className="text-[10px] font-medium text-white/50 uppercase tracking-widest mb-2">Liquidation Prob</div>
                  <div className={`text-7xl font-light tracking-tighter ${liqProb > 0.2 ? 'text-rose-500' : liqProb > 0.05 ? 'text-amber-500' : 'text-emerald-500'}`}>
                    {(liqProb * 100).toFixed(1)}<span className="text-4xl opacity-50">%</span>
                  </div>
                  {riskResult && (
                    <div className="text-xs font-mono text-white/40 mt-2">
                      AT ${formatPrice(liqPrice, currentSymbol)}
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between text-[10px] uppercase tracking-widest mb-2">
                      <span className="text-white/50">Risk Score</span>
                      <span className="text-white font-mono">{riskScore}/100</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden bg-white/5">
                      <div
                        style={{ width: `${riskScore}%` }}
                        className={`h-full transition-all ${riskScore > 70 ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]' : riskScore > 30 ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]' : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]'}`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
                    <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                      <div className="text-[10px] uppercase tracking-widest text-emerald-400/70 mb-1">Hit TP</div>
                      <div className="text-lg font-mono text-emerald-400">
                        {riskResult?.take_profit ? `${(probTP * 100).toFixed(1)}%` : '—'}
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                      <div className="text-[10px] uppercase tracking-widest text-rose-400/70 mb-1">Hit SL</div>
                      <div className="text-lg font-mono text-rose-400">
                        {riskResult?.stop_loss ? `${(probSL * 100).toFixed(1)}%` : '—'}
                      </div>
                    </div>
                  </div>

                  {liqProb > 0.15 && (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-xs text-rose-200 leading-relaxed">
                      <span className="font-semibold text-rose-400">Warning:</span> High liquidation risk detected. Consider reducing leverage or tightening your stop loss.
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom: Distribution Chart & Controls */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto flex flex-col items-center gap-3">
          {/* 2D Distribution Chart */}
          {conePoints.length > 0 && (
            <div className="w-[80vw] max-w-[1100px] h-[220px] bg-white/[0.03] backdrop-blur-md rounded-3xl border border-white/10 shadow-2xl relative">
              <span className="absolute top-3 right-5 text-[10px] font-mono uppercase tracking-widest text-white/30 z-10">
                Forecast Range
              </span>
              <DistributionChart
                points={conePoints}
                currentPrice={coneCurrentPrice}
                horizon={horizon}
                targetLine={coneTargetLine}
                highlightRange={coneHighlightRange}
                queryMode={activeTab === 'explorer' ? queryMode : undefined}
                liquidationPrice={liquidationPriceForCone}
                takeProfit={tpForCone}
                stopLoss={slForCone}
              />
            </div>
          )}

          {/* Controls Row */}
          <div className="flex items-center gap-3">
            <div className="bg-black/40 backdrop-blur-xl px-4 py-2.5 rounded-2xl border border-white/10 shadow-2xl flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-widest text-white/40 mr-1">Horizon</span>
              {loading && <Loader2 className="w-3 h-3 text-white/30 animate-spin" />}
              <button
                onClick={() => supports1h && setHorizon('1h')}
                disabled={!supports1h}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${
                  horizon === '1h'
                    ? 'bg-white text-black shadow-sm'
                    : supports1h
                      ? 'text-white/50 hover:text-white'
                      : 'text-white/20 cursor-not-allowed'
                }`}
              >
                1H
              </button>
              <button
                onClick={() => setHorizon('24h')}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${
                  horizon === '24h'
                    ? 'bg-white text-black shadow-sm'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                24H
              </button>
            </div>

            <div className="flex bg-white/10 backdrop-blur-xl p-1.5 rounded-full border border-white/10 shadow-2xl">
              <button
                onClick={() => setActiveTab('explorer')}
                className={`px-8 py-2.5 rounded-full text-xs font-medium uppercase tracking-widest transition-all ${activeTab === 'explorer' ? 'bg-white text-black shadow-lg' : 'text-white/50 hover:text-white'}`}
              >
                Explorer
              </button>
              <button
                onClick={() => setActiveTab('scanner')}
                className={`px-8 py-2.5 rounded-full text-xs font-medium uppercase tracking-widest transition-all ${activeTab === 'scanner' ? 'bg-white text-black shadow-lg' : 'text-white/50 hover:text-white'}`}
              >
                Scanner
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
