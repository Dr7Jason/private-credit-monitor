import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

// ── FRED API Series IDs ──────────────────────────────────────────
const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const FRED_KEY  = "cd484126bef5ea19bc705b7fcbdcfcbb";

// HY Spread: BAMLH0A0HYM2  |  IG (Investment Grade) Spread: BAMLC0A0CM
// We use these as proxy for CLO health since CLO AAA is not on FRED public API
const SERIES = {
  hy:  { id: "BAMLH0A0HYM2", label: "HY Spread (정크본드)",   color: "#f97316", dangerAbove: 5.0, warnAbove: 4.0 },
  ig:  { id: "BAMLC0A0CM",   label: "IG Spread (투자등급)",    color: "#38bdf8", dangerAbove: 1.8, warnAbove: 1.4 },
};

const FOMC_DATE = new Date("2025-03-19T14:00:00");

const EVENTS = [
  { date: "2025-02-14", label: "BCRED 순유출 $17억 확인",           type: "yellow" },
  { date: "2025-02-21", label: "Blue Owl OBDC II 환매 영구 종료",   type: "red"    },
  { date: "2025-02-21", label: "OTIC 환매율 NAV 15% 도달",          type: "yellow" },
  { date: "2025-03-19", label: "FOMC 금리 결정 발표",               type: "fomc"   },
];

const SIGNALS = [
  { id:"hy",    name:"HY Spread",             cat:"credit", critical:true,  note:"5% 돌파 시 🔴 경보 — 지금 자동 반영" },
  { id:"ig",    name:"IG (BBB) Spread",        cat:"credit", critical:false, note:"1.8% 돌파 시 🔴 경보 — 자동 반영" },
  { id:"bcred", name:"Blackstone BCRED",       cat:"fund",   critical:false, note:"임직원 $4억 투입으로 방어 중" },
  { id:"obdc",  name:"Blue Owl OBDC II",       cat:"fund",   critical:false, note:"환매 영구 종료 — 청산 모드" },
  { id:"otic",  name:"Blue Owl OTIC",          cat:"fund",   critical:false, note:"환매율 NAV 15%" },
  { id:"ares",  name:"Ares BDC 환매",          cat:"fund",   critical:true,  note:"3번째 펀드 — 핵심 감시 대상" },
  { id:"apollo",name:"Apollo BDC 환매",        cat:"fund",   critical:true,  note:"연쇄 전염 여부 판단 지표" },
  { id:"pe",    name:"PE Exit 딜 속도",        cat:"market", critical:false, note:"사모펀드 출구 전략 둔화" },
  { id:"oil",   name:"WTI 유가",               cat:"macro",  critical:false, note:"이란 리스크 → 에너지 변동성" },
];

const INIT_STATUS = {
  bcred:"yellow", obdc:"red", otic:"yellow",
  ares:"green", apollo:"green", pe:"yellow", oil:"yellow",
};

// ── Helpers ──────────────────────────────────────────────────────
function spreadStatus(val, series) {
  if (!val) return "green";
  if (val >= series.dangerAbove) return "red";
  if (val >= series.warnAbove)   return "yellow";
  return "green";
}

const SC = {
  green:  { color:"#22c55e", bg:"rgba(34,197,94,.12)",   border:"rgba(34,197,94,.3)"  },
  yellow: { color:"#f59e0b", bg:"rgba(245,158,11,.12)",  border:"rgba(245,158,11,.3)" },
  red:    { color:"#ef4444", bg:"rgba(239,68,68,.12)",   border:"rgba(239,68,68,.3)"  },
};
const LABEL = { green:"정상", yellow:"주의", red:"경보" };
const CAT = { credit:"📊 신용시장 (FRED 실시간)", fund:"🏦 펀드 환매", market:"📈 시장 동향", macro:"🌍 거시경제" };

// ── Components ───────────────────────────────────────────────────
function Dot({ status, pulse }) {
  const c = SC[status]?.color ?? "#64748b";
  return (
    <span style={{
      display:"inline-block", width:10, height:10, borderRadius:"50%", flexShrink:0, marginTop:2,
      background: c,
      boxShadow: pulse && status !== "green" ? `0 0 0 3px ${c}44` : "none",
      animation: pulse && status !== "green" ? "pulse 2s infinite" : "none",
    }}/>
  );
}

function Badge({ status }) {
  const s = SC[status] ?? SC.green;
  return (
    <span style={{
      fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:20, letterSpacing:"0.06em",
      color: s.color, background: s.bg, border:`1px solid ${s.border}`,
    }}>
      {LABEL[status] ?? status}
    </span>
  );
}

function FomcCountdown() {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    const tick = () => {
      const d = FOMC_DATE - Date.now();
      if (d <= 0) { setRemaining("발표됨"); return; }
      const days  = Math.floor(d / 86400000);
      const hours = Math.floor((d % 86400000) / 3600000);
      const mins  = Math.floor((d % 3600000)  / 60000);
      setRemaining(`${days}일 ${hours}시간 ${mins}분`);
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);
  return <span style={{ color:"#f59e0b", fontFamily:"'Space Mono',monospace", fontWeight:700, fontSize:15 }}>{remaining}</span>;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", fontSize:12 }}>
      <div style={{ color:"#64748b", marginBottom:4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color, fontWeight:700 }}>
          {p.name}: {p.value?.toFixed(2)}%
        </div>
      ))}
    </div>
  );
};

// ── Main Dashboard ────────────────────────────────────────────────
export default function App() {
  const [chartData, setChartData]     = useState({});
  const [latest,    setLatest]        = useState({});
  const [loading,   setLoading]       = useState(true);
  const [error,     setError]         = useState(null);
  const [manualStatus, setManual]     = useState(INIT_STATUS);
  const [activeChart, setActiveChart] = useState("hy");
  const [notes, setNotes]             = useState("");
  const [lastFetch, setLastFetch]     = useState(null);

  // Compute auto status for credit series
  const autoStatus = useCallback((id) => {
    const s = SERIES[id];
    if (!s) return manualStatus[id] ?? "green";
    return spreadStatus(latest[id], s);
  }, [latest, manualStatus]);

  const getStatus = (id) => {
    if (id === "hy" || id === "ig") return autoStatus(id);
    return manualStatus[id] ?? "green";
  };

  // FRED fetch (로컬 JSON — GitHub Actions가 6시간마다 갱신)
  const fetchFRED = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${import.meta.env.BASE_URL}fred-data.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`데이터 로드 실패: ${res.status}`);
      const data = await res.json();
      const results = {};
      const charts  = {};
      for (const [key] of Object.entries(SERIES)) {
        const obs = (data[key]?.observations ?? [])
          .filter(o => o.value !== ".")
          .map(o => ({ date: o.date, value: parseFloat(o.value) }));
        if (obs.length) results[key] = obs[obs.length - 1].value;
        charts[key] = obs.map(o => ({ date: o.date.slice(5), value: o.value }));
      }
      setLatest(results);
      setChartData(charts);
      setLastFetch(data.updated ? new Date(data.updated).toLocaleString("ko-KR") : new Date().toLocaleTimeString("ko-KR"));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFRED(); }, [fetchFRED]);

  // Overall status
  const allStatuses = SIGNALS.map(s => getStatus(s.id));
  const overallStatus = allStatuses.includes("red") ? "red" : allStatuses.includes("yellow") ? "yellow" : "green";
  const counts = { green: allStatuses.filter(s=>s==="green").length, yellow: allStatuses.filter(s=>s==="yellow").length, red: allStatuses.filter(s=>s==="red").length };

  const grouped = Object.keys(CAT).reduce((a,c) => { a[c] = SIGNALS.filter(s=>s.cat===c); return a; }, {});
  const activeSeries = SERIES[activeChart];

  return (
    <div style={{ minHeight:"100vh", background:"#060d1a", color:"#cbd5e1", fontFamily:"'Space Mono','Courier New',monospace", paddingBottom:60 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Noto+Sans+KR:wght@400;500;700&display=swap');
        @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(245,158,11,.7)} 70%{box-shadow:0 0 0 8px rgba(245,158,11,0)} 100%{box-shadow:0 0 0 0 rgba(245,158,11,0)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing:border-box; }
        ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:#060d1a} ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
        .row:hover { background:rgba(255,255,255,.025) !important; }
        .tab:hover { background:rgba(255,255,255,.05) !important; }
        button { cursor:pointer; }
        textarea { resize:vertical; outline:none; }
        textarea::placeholder { color:#334155; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background:"#0a1220", borderBottom:"1px solid #1e293b", padding:"20px 28px 16px", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ maxWidth:920, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.2em", marginBottom:3 }}>PRIVATE CREDIT CRISIS MONITOR · LIVE</div>
              <div style={{ fontSize:20, fontWeight:700, color:"#f1f5f9", letterSpacing:"-0.02em" }}>글로벌 신용시장 위기 신호등</div>
            </div>
            {/* Overall pill */}
            <div style={{ background: SC[overallStatus].bg, border:`1px solid ${SC[overallStatus].border}`, borderRadius:12, padding:"10px 16px", display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 }}>
              <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.15em" }}>OVERALL</div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <Dot status={overallStatus} pulse />
                <span style={{ color: SC[overallStatus].color, fontWeight:700, fontSize:16 }}>{LABEL[overallStatus]}</span>
              </div>
            </div>
          </div>

          {/* Score row */}
          <div style={{ display:"flex", gap:16, marginTop:12, alignItems:"center", flexWrap:"wrap" }}>
            {["green","yellow","red"].map(s => (
              <div key={s} style={{ display:"flex", gap:5, alignItems:"center" }}>
                <Dot status={s} />
                <span style={{ color: SC[s].color, fontWeight:700, fontSize:13 }}>{counts[s]}</span>
                <span style={{ color:"#475569", fontSize:11 }}>{LABEL[s]}</span>
              </div>
            ))}
            <div style={{ marginLeft:"auto", fontSize:10, color:"#334155" }}>
              {loading ? "⟳ 로딩중..." : error ? "⚠ API 오류" : `업데이트: ${lastFetch}`}
              {!loading && (
                <button onClick={fetchFRED} style={{ marginLeft:8, background:"none", border:"1px solid #1e293b", color:"#475569", borderRadius:4, padding:"2px 8px", fontSize:10 }}>
                  새로고침
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:920, margin:"0 auto", padding:"24px 28px 0", animation:"fadeIn .5s ease" }}>

        {/* ── FOMC BANNER ── */}
        <div style={{ background:"linear-gradient(135deg,#12172a,#0a0f1e)", border:"1px solid #f59e0b44", borderRadius:12, padding:"14px 20px", marginBottom:22, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
          <div>
            <div style={{ fontSize:10, color:"#64748b", letterSpacing:"0.15em", marginBottom:3 }}>⏱ FOMC — 2025.03.19 14:00 ET</div>
            <div style={{ fontSize:12, color:"#94a3b8", fontFamily:"'Noto Sans KR',sans-serif" }}>금리 동결 시 → Private Credit 압박 지속</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:9, color:"#475569", marginBottom:2 }}>남은 시간</div>
            <FomcCountdown />
          </div>
        </div>

        {/* ── LIVE CHART ── */}
        <div style={{ background:"#0a1220", border:"1px solid #1e293b", borderRadius:14, padding:"18px 20px", marginBottom:22 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:8 }}>
            <div>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.15em", marginBottom:3 }}>FRED 실시간 데이터 · 최근 90일</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#e2e8f0", fontFamily:"'Noto Sans KR',sans-serif" }}>신용 스프레드 추이</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              {Object.entries(SERIES).map(([k,s]) => (
                <button key={k} className="tab" onClick={() => setActiveChart(k)} style={{
                  background: activeChart===k ? s.color+"22" : "none",
                  border: `1px solid ${activeChart===k ? s.color+"66" : "#1e293b"}`,
                  color: activeChart===k ? s.color : "#475569",
                  borderRadius:6, padding:"4px 10px", fontSize:10, transition:"all .15s"
                }}>
                  {k.toUpperCase()} Spread
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", color:"#334155", fontSize:13 }}>
              FRED API 연결 중...
            </div>
          ) : error ? (
            <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:8 }}>
              <div style={{ color:"#ef4444", fontSize:13 }}>⚠ {error}</div>
              <div style={{ color:"#475569", fontSize:11, fontFamily:"'Noto Sans KR',sans-serif" }}>CORS 제한으로 API 직접 호출이 차단될 수 있습니다</div>
            </div>
          ) : (
            <>
              {/* Current value display */}
              <div style={{ display:"flex", gap:16, marginBottom:14, flexWrap:"wrap" }}>
                {Object.entries(SERIES).map(([k,s]) => {
                  const val = latest[k];
                  const st  = spreadStatus(val, s);
                  return (
                    <div key={k} style={{ background:"#0d1626", borderRadius:8, padding:"8px 14px", border:`1px solid ${SC[st].border}`, minWidth:140 }}>
                      <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", marginBottom:4 }}>{s.label}</div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                        <span style={{ fontSize:22, fontWeight:700, color: SC[st].color, fontFamily:"'Space Mono',monospace" }}>
                          {val != null ? val.toFixed(2) : "--"}
                        </span>
                        <span style={{ fontSize:11, color:"#475569" }}>%</span>
                        <Badge status={st} />
                      </div>
                      <div style={{ fontSize:9, color:"#334155", marginTop:3 }}>
                        경보: {s.dangerAbove}% / 주의: {s.warnAbove}%
                      </div>
                    </div>
                  );
                })}
              </div>

              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData[activeChart] ?? []} margin={{ top:4, right:8, left:-20, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill:"#475569", fontSize:9 }} tickLine={false} interval={14} />
                  <YAxis tick={{ fill:"#475569", fontSize:9 }} tickLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={activeSeries.dangerAbove} stroke="#ef444466" strokeDasharray="4 4"
                    label={{ value:"경보", fill:"#ef4444", fontSize:9, position:"right" }} />
                  <ReferenceLine y={activeSeries.warnAbove} stroke="#f59e0b44" strokeDasharray="4 4"
                    label={{ value:"주의", fill:"#f59e0b", fontSize:9, position:"right" }} />
                  <Line type="monotone" dataKey="value" name={activeSeries.label}
                    stroke={activeSeries.color} strokeWidth={2} dot={false}
                    activeDot={{ r:4, fill: activeSeries.color }} />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* ── SIGNAL TABLE ── */}
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom:18 }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#475569", letterSpacing:"0.12em", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
              {CAT[cat]}
              <div style={{ flex:1, height:1, background:"#1e293b" }} />
            </div>
            <div style={{ borderRadius:10, overflow:"hidden", border:"1px solid #1e293b" }}>
              {items.map((sig, i) => {
                const st  = getStatus(sig.id);
                const isAuto = sig.id === "hy" || sig.id === "ig";
                return (
                  <div key={sig.id} className="row" style={{
                    display:"flex", alignItems:"center", gap:10, padding:"11px 14px",
                    background: i%2===0 ? "#0c1525" : "#080e1c",
                    borderBottom: i < items.length-1 ? "1px solid #1e293b" : "none",
                    transition:"background .12s"
                  }}>
                    <Dot status={st} pulse={st !== "green"} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:2, flexWrap:"wrap" }}>
                        <span style={{ fontSize:13, fontWeight:600, color:"#e2e8f0", fontFamily:"'Noto Sans KR',sans-serif" }}>{sig.name}</span>
                        {sig.critical && <span style={{ fontSize:9, color:"#a78bfa", background:"#7c3aed22", border:"1px solid #7c3aed44", borderRadius:4, padding:"1px 5px" }}>핵심</span>}
                        {isAuto && <span style={{ fontSize:9, color:"#38bdf8", background:"#0ea5e922", border:"1px solid #0ea5e944", borderRadius:4, padding:"1px 5px" }}>LIVE</span>}
                      </div>
                      <div style={{ fontSize:11, color:"#64748b", fontFamily:"'Noto Sans KR',sans-serif" }}>
                        {isAuto && latest[sig.id] != null
                          ? <span style={{ color:"#94a3b8", marginRight:8 }}>{latest[sig.id].toFixed(2)}%</span>
                          : null
                        }
                        {sig.note}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:4, alignItems:"center", flexShrink:0 }}>
                      <Badge status={st} />
                      {!isAuto && (
                        <div style={{ display:"flex", gap:3, marginLeft:6 }}>
                          {["green","yellow","red"].map(s => (
                            <button key={s} onClick={() => setManual(prev => ({...prev, [sig.id]: s}))} style={{
                              width:9, height:9, borderRadius:"50%", border:"none", padding:0,
                              background: st===s ? SC[s].color : "#1e293b",
                              outline: st===s ? `2px solid ${SC[s].color}66` : "none",
                              outlineOffset:1, transition:"all .1s"
                            }} title={LABEL[s]} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* ── TIMELINE ── */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#475569", letterSpacing:"0.12em", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
            📅 이벤트 타임라인
            <div style={{ flex:1, height:1, background:"#1e293b" }} />
          </div>
          <div style={{ position:"relative", paddingLeft:18 }}>
            <div style={{ position:"absolute", left:6, top:6, bottom:6, width:1, background:"#1e293b" }} />
            {EVENTS.map((ev, i) => {
              const dotColor = ev.type==="red" ? "#ef4444" : ev.type==="fomc" ? "#a78bfa" : "#f59e0b";
              return (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:12, position:"relative" }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background: dotColor, flexShrink:0, marginTop:4 }} />
                  <div>
                    <div style={{ fontSize:10, color:"#475569", marginBottom:2 }}>{ev.date}</div>
                    <div style={{ fontSize:13, color:"#cbd5e1", fontFamily:"'Noto Sans KR',sans-serif" }}>{ev.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── NOTES ── */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#475569", letterSpacing:"0.12em", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
            📝 모니터링 노트
            <div style={{ flex:1, height:1, background:"#1e293b" }} />
          </div>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder="관찰 내용, 뉴스 링크, 판단 메모..."
            style={{ width:"100%", minHeight:90, background:"#0c1525", border:"1px solid #1e293b", borderRadius:10, padding:"12px 14px", color:"#e2e8f0", fontSize:13, fontFamily:"'Noto Sans KR',sans-serif", lineHeight:1.7 }}
          />
        </div>

        {/* ── DISCLAIMER ── */}
        <div style={{ padding:"10px 14px", background:"#0c1525", borderRadius:8, border:"1px solid #1e293b", fontSize:11, color:"#334155", fontFamily:"'Noto Sans KR',sans-serif", lineHeight:1.7 }}>
          ⚠ 본 대시보드는 시장 모니터링 도구이며 투자 자문이 아닙니다. FRED 데이터(HY/IG Spread)는 실시간 연동이나, CLO AAA Spread는 별도 유료 데이터 소스가 필요합니다. 펀드 환매 항목은 수동 입력 기반입니다.
        </div>
      </div>
    </div>
  );
}
