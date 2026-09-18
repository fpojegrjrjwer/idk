
// app.js - UI 제어 + 시뮬 + 경제 + 2종 최적화
const STORAGE_KEY = "ssp_history_v2";
const SERIAL_KEY = "ssp_serial_counter_v2";
let lastSim = null;
let lastOpt = null;
let lastAllCells = null;

function collectSimConfig() {
  const get = id => document.getElementById(id);
  return {
    altitude_km: parseFloat(get('altitude').value) || 500,
    inclination_deg: parseFloat(get('inclination').value) || 45,
    raan_deg: parseFloat(get('raan').value) || 0,
    initial_orbital_phase_deg: parseFloat(get('initPhase').value) || 0,
    panel_orientation_deg: parseFloat(get('panelOri').value) || 0,
    panel_area_m2: parseFloat(get('panelArea').value) || 20,
    solar_cell_type: get('cellType').value || "III-V_3J",
    simulation_duration_days: parseFloat(get('duration').value) || 1,
    time_step_seconds: parseFloat(get('dt').value) || 60,
    solar_irradiance_W_m2: parseFloat(get('irradiance')?.value) || 1361,
    PR: parseFloat(get('pr').value) || 0.8,
    electricity_price: parseFloat(get('elecPrice').value) || 0.15,
    electricity_growth_rate: parseFloat(get('elecGrowth').value) || 3,
    discount_rate: parseFloat(get('discountRate').value) || 5,
    maintenance_cost: parseFloat(get('maintenance').value) || 500,
    maintenance_is_percent: get('maintPercent')?.checked || false,
    maintenance_percent: parseFloat(get('maintPercentVal')?.value) || 2,
    launch_cost_per_kg: parseFloat(get('launchCost').value) || 20000,
    install_cost: parseFloat(get('installCost').value) || 5000,
    inverter_cost: parseFloat(get('inverterCost').value) || 3000,
    lifetime_years: parseInt(get('lifetime').value) || 25,
    absorptivity: 0.9,
    emissivity: 0.85
  };
}
function collectOptRanges() {
  return {
    altitude_km: [parseFloat(document.getElementById('altMin').value)||400, parseFloat(document.getElementById('altMax').value)||700, parseFloat(document.getElementById('altStep').value)||50],
    inclination_deg: [parseFloat(document.getElementById('incMin').value)||0, parseFloat(document.getElementById('incMax').value)||60, parseFloat(document.getElementById('incStep').value)||15],
    panel_orientation_deg: [parseFloat(document.getElementById('oriMin').value)||0, parseFloat(document.getElementById('oriMax').value)||90, parseFloat(document.getElementById('oriStep').value)||15]
  };
}
function getNextSerial(prefix){
  const key = SERIAL_KEY + "_" + prefix;
  let cnt = parseInt(localStorage.getItem(key) || "0") + 1;
  localStorage.setItem(key, cnt);
  return `${prefix}-${String(cnt).padStart(6,'0')}`;
}
function saveRecord(record){
  const hist = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  hist.unshift(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hist));
  renderHistory();
}
function loadHistory(){ return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
function downloadTXT(filename, content){
  const blob = new Blob([content], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); },0);
}

function renderResultGUI(record){
  const resultBox = document.getElementById('resultBox');
  if(!resultBox) return;
  if(record.type==='SIM'){
    const { serial, config, summary, econ } = record;
    const score = scoreSummary(summary).toFixed(2);
    resultBox.innerHTML = `
      <div class="gui-dashboard">
        <div class="formula-box">
          <b>📐 계산식 노트 (정확히 구현)</b><br/>
          E₁ = A·η·G·365·PR·(1+γΔT) = ${econ.params.A}·${econ.params.eta0}·${econ.params.G}·365·${econ.params.PR}·(1+${econ.params.gamma}×${econ.params.deltaT.toFixed(1)}) = <b>${econ.E1_formula_kWh} kWh</b><br/>
          시뮬 기반 E₁ = avgP·24·365 = ${summary.avg_power_W}W → <b>${econ.E1_from_power_kWh} kWh</b><br/>
          E(t)=E₁·(1-d)^(t-1), d=${econ.params.d}<br/>
          LCOE = ΣCₜ/(1+r)^t / ΣEₜ/(1+r)^t = <b>${econ.LCOE} $/kWh</b><br/>
          NPV = Σ(Vₜ-Mₜ)/(1+r)^t - CAPEX = <b>$${econ.NPV}</b>
        </div>
        <div class="kpi-grid">
          <div class="kpi-card highlight"><span class="kpi-title">종합 점수</span><span class="kpi-value">${score}</span></div>
          <div class="kpi-card"><span class="kpi-title">평균 전력</span><span class="kpi-value">${summary.avg_power_W} <small>W</small></span></div>
          <div class="kpi-card"><span class="kpi-title">총 발전량(시뮬)</span><span class="kpi-value">${summary.total_energy_kWh} <small>kWh</small></span></div>
          <div class="kpi-card"><span class="kpi-title">LCOE / NPV</span><span class="kpi-value" style="font-size:0.85rem">$${econ.LCOE} / $${(econ.NPV/1000).toFixed(1)}k</span></div>
        </div>
        <div class="gui-tables">
          <div>
            <span class="gui-section-title">📥 INPUT 매개변수</span>
            <table class="gui-table">
              <tr><th>셀 타입 (가격)</th><td><span class="badge blue">${config.solar_cell_type} - $${econ.cell.price_per_m2}/m²</span></td></tr>
              <tr><th>고도 / 경사 / RAAN</th><td>${config.altitude_km}km / ${config.inclination_deg}° / ${config.raan_deg}°</td></tr>
              <tr><th>패널 방향 / 면적</th><td>${config.panel_orientation_deg}° / ${config.panel_area_m2}m²</td></tr>
              <tr><th>PR / 일사량</th><td>${config.PR} / ${config.solar_irradiance_W_m2}W/m²</td></tr>
              <tr><th>전기요금 / 상승률 / 할인율</th><td>$${config.electricity_price}/kWh / ${config.electricity_growth_rate}% / ${config.discount_rate}%</td></tr>
              <tr><th>발사비 / 설치 / 인버터 / 수명</th><td>$${config.launch_cost_per_kg}/kg / $${config.install_cost} / $${config.inverter_cost} / ${config.lifetime_years}y</td></tr>
              <tr><th>시뮬 기간</th><td>${config.simulation_duration_days}일 dt ${config.time_step_seconds}s</td></tr>
              <tr><th>시리얼</th><td><code>${serial}</code></td></tr>
            </table>
            <span class="gui-section-title">🔬 상수</span>
            <table class="gui-table">
              <tr><th>태양상수</th><td>1361 W/m²</td></tr>
              <tr><th>STC</th><td>1000 W/m²</td></tr>
              <tr><th>평균 온도</th><td>${summary.avg_temperature_K}K (${summary.avg_temperature_C}°C)</td></tr>
              <tr><th>평균 효율 / 최종 효율</th><td>${(summary.avg_efficiency*100).toFixed(2)}% / ${(summary.final_efficiency*100).toFixed(2)}%</td></tr>
              <tr><th>식 Eclipse 비율 / avg cosθ</th><td>${(summary.eclipse_fraction*100).toFixed(1)}% / ${summary.avg_cos_theta}</td></tr>
            </table>
          </div>
          <div>
            <span class="gui-section-title">💰 비용 구조 (모든 경제적 비용)</span>
            <table class="gui-table">
              <tr><th>패널 가격 A×단가</th><td>$${econ.panelCost} (${config.panel_area_m2}m² × $${econ.cell.price_per_m2})</td></tr>
              <tr><th>생산 비용</th><td>$${econ.productionCost} (factor ${econ.cell.production_cost_factor})</td></tr>
              <tr><th>발사 비용</th><td>$${econ.launchCost} (${config.panel_area_m2}m² × ${econ.cell.mass_kg_per_m2}kg × $${config.launch_cost_per_kg})</td></tr>
              <tr><th>CAPEX</th><td><b>$${econ.CAPEX}</b></td></tr>
              <tr><th>총 CAPEX (생산포함)</th><td><b>$${econ.totalCAPEX}</b></td></tr>
              <tr><th>연간 유지비</th><td>$${econ.annualMaintenance}</td></tr>
              <tr><th>LCC (할인 총비용)</th><td>$${econ.LCC}</td></tr>
              <tr><th>LCOE</th><td><b>$${econ.LCOE}/kWh</b></td></tr>
            </table>
            <span class="gui-section-title">📈 가치 분석 (경제적 가치)</span>
            <table class="gui-table">
              <tr><th>E₁ (공식) / E₁(전력)</th><td>${econ.E1_formula_kWh} / ${econ.E1_from_power_kWh} kWh/년</td></tr>
              <tr><th>E(t) 1년 / 10년 / 25년</th><td>${econ.yearly[0]?.Et} / ${econ.yearly[9]?.Et||'-'} / ${econ.yearly[24]?.Et||'-'} kWh</td></tr>
              <tr><th>연간 가치 V₁</th><td>$${econ.yearly[0]?.Vt} /년</td></tr>
              <tr><th>누적 가치 / 에너지</th><td>$${econ.totalValue} / ${econ.totalEnergyLifetime}kWh</td></tr>
              <tr><th>NPV / IRR / 회수</th><td><b style="color:${econ.NPV>=0?'#4ade80':'#f87171'}">$${econ.NPV}</b> / ${econ.IRR? (econ.IRR*100).toFixed(2)+'%':'-'} / ${econ.paybackYears? econ.paybackYears+'년':'-'} </td></tr>
            </table>
          </div>
        </div>
        <span class="gui-section-title">📉 경제적 가치 변동 분석</span>
        <div class="econ-grid">
          <table class="gui-table"><tr><th>시나리오</th><th>연간가치</th><th>NPV</th><th>LCOE</th></tr>
            ${econ.sensitivity.map(s=>`<tr><td>${s.label} ($${s.elecPrice})</td><td>$${s.annualValue}</td><td style="color:${s.NPV>=0?'#4ade80':'#f87171'}">$${s.NPV}</td><td>$${s.LCOE}</td></tr>`).join('')}
          </table>
          <table class="gui-table"><tr><th>일사량 민감도</th><th>NPV</th><th>LCOE</th></tr>
            ${econ.irradianceSens.map(s=>`<tr><td>${s.label}</td><td>$${s.NPV}</td><td>$${s.LCOE}</td></tr>`).join('')}
          </table>
        </div>
        <div style="margin-top:8px">
          <span class="gui-section-title">25년 E(t) 감소 곡선: E(t)=E₁·(1-d)^(t-1), d=${econ.params.d}</span>
          <canvas id="econChart" width="600" height="120" style="width:100%; background:#020617; border-radius:8px; border:1px solid #1e293b"></canvas>
        </div>
      </div>
    `;
    setTimeout(()=>drawEconChart(econ), 100);
  } else if(record.type==='OPT'){
    const { serial, algorithm, objective, best, tested } = record;
    resultBox.innerHTML = `
      <div class="gui-dashboard">
        <div class="kpi-grid">
          <div class="kpi-card highlight"><span class="kpi-title">최고 점수 (${objective})</span><span class="kpi-value">${best ? best.score : '-'}</span></div>
          <div class="kpi-card"><span class="kpi-title">알고리즘</span><span class="kpi-value" style="font-size:0.85rem">${algorithm}</span></div>
          <div class="kpi-card"><span class="kpi-title">테스트 수</span><span class="kpi-value">${tested.length} <small>건</small></span></div>
          <div class="kpi-card"><span class="kpi-title">최적 NPV / LCOE</span><span class="kpi-value" style="font-size:0.75rem">$${best?best.econ.NPV:'-'} / $${best?best.econ.LCOE:'-'}</span></div>
        </div>
        ${best ? `<div class="gui-section" style="margin-top:12px;">
          <span class="gui-section-title">🏆 최적 조건 (단일 전지 최고 효율 - ${best.summary.solar_cell_type} - $${best.econ.cell.price_per_m2}/m²)</span>
          <table class="gui-table">
            <tr><th>최적 고도</th><td><b>${best.config.altitude_km} km</b></td></tr>
            <tr><th>최적 경사각</th><td><b>${best.config.inclination_deg}°</b></td></tr>
            <tr><th>최적 패널 방향</th><td><b>${best.config.panel_orientation_deg}°</b></td></tr>
            <tr><th>예상 E1 / 전력</th><td>${best.econ.E1_used_kWh} kWh/년 / ${best.summary.avg_power_W}W</td></tr>
            <tr><th>NPV / LCOE / 회수</th><td><b style="color:${best.econ.NPV>=0?'#4ade80':'#f87171'}">$${best.econ.NPV}</b> / $${best.econ.LCOE} / ${best.econ.paybackYears||'-'}년</td></tr>
          </table>
          <div style="margin-top:6px; font-size:0.7rem; color:#94a3b8">INPUT/OUTPUT 결과에 포함됨 - 이 최적 조건으로 시뮬 다시 실행하면 전체 경제 보고서가 결과에 표시됩니다.</div>
        </div>`:''}
      </div>
    `;
  } else if(record.type==='ALLCELLS'){
    const { serial, results } = record;
    resultBox.innerHTML = `
      <div class="gui-dashboard">
        <span class="gui-section-title">🌐 전체 전지 비교 - 특정 환경에서 어떤 전지가 가장 좋은가 (${serial})</span>
        <div style="font-size:0.7rem; color:#94a3b8">고도 ${results[0]?.summary.altitude_km}km, 경사 ${results[0]?.summary.inclination_deg}° 기준</div>
        <table class="gui-table" style="font-size:0.72rem">
          <tr><th>순위</th><th>셀(가격)</th><th>avg P</th><th>E1</th><th>LCOE</th><th>NPV</th><th>회수</th><th>총가치</th></tr>
          ${results.map((r,i)=>`<tr style="${i===0?'background:rgba(34,197,94,0.1)':''}"><td>${i+1}</td><td><b style="color:${r.cell.color}">${r.cellKey}</b> $${r.cell.price_per_m2}</td><td>${r.summary.avg_power_W}W</td><td>${(r.econ.E1_used_kWh/1000).toFixed(1)}MWh</td><td>$${r.econ.LCOE}</td><td style="color:${r.econ.NPV>=0?'#4ade80':'#f87171'}"><b>$${r.econ.NPV}</b></td><td>${r.econ.paybackYears||'-'}y</td><td>$${(r.econ.totalValue/1000).toFixed(1)}k</td></tr>`).join('')}
        </table>
        <div style="margin-top:8px; font-size:0.7rem; color:#bae6fd; background:rgba(14,165,233,0.08); padding:8px; border-radius:8px">
          <b>결론:</b> ${results[0]?.cellKey} ( $${results[0]?.cell.price_per_m2}/m² ) 가 현재 환경에서 NPV $${results[0]?.econ.NPV} 로 최고. LCOE 최소는 ${[...results].sort((a,b)=>a.econ.LCOE-b.econ.LCOE)[0]?.cellKey} $${[...results].sort((a,b)=>a.econ.LCOE-b.econ.LCOE)[0]?.econ.LCOE}/kWh.
        </div>
      </div>
    `;
  } else if(record.type==='PERCELL'){
    const { serial, perCell } = record;
    resultBox.innerHTML = `
      <div class="gui-dashboard">
        <span class="gui-section-title">🛰️ 각 전지가 가장 좋은 환경 (셀별 최적 환경 찾기) - ${serial}</span>
        <div style="display:grid; gap:8px">
          ${perCell.map(p=>`<div style="border:1px solid #1e293b; border-radius:8px; padding:8px; background:#020617">
            <div style="display:flex; justify-content:space-between"><b style="color:${p.cell.color}">${p.cellKey} - $${p.cell.price_per_m2}/m²</b><span style="color:${p.econ.NPV>=0?'#4ade80':'#f87171'}"><b>NPV $${p.econ.NPV}</b></span></div>
            <div style="font-size:0.7rem; color:#94a3b8; margin-top:4px">최적 고도 ${p.best.config.altitude_km}km, 경사 ${p.best.config.inclination_deg}°, 방향 ${p.best.config.panel_orientation_deg}° | 전력 ${p.summary.avg_power_W}W, LCOE $${p.econ.LCOE}, E1 ${p.econ.E1_used_kWh}kWh</div>
            <div style="font-size:0.68rem; color:#cbd5e1; margin-top:4px">${p.cellKey==='III-V_3J'?'고효율 고고도 SSO 추천':p.cellKey==='Perovskite'?'저비용 저고도 단기 임무':p.cellKey==='Si'?'균형형 중궤도':p.cellKey==='GaAs'?'중고도 고경사': '저궤도 경제형'}</div>
          </div>`).join('')}
        </div>
      </div>
    `;
  }
}
function drawEconChart(econ){
  const c = document.getElementById('econChart'); if(!c) return; const ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  const years = econ.yearly.map(y=>y.year); const ets = econ.yearly.map(y=>y.Et);
  const maxEt = Math.max(...ets);
  ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.beginPath();
  ets.forEach((et,i)=>{
    const x = 40 + (i/(ets.length-1))*(c.width-50);
    const y = c.height-20 - (et/maxEt)*(c.height-40);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }); ctx.stroke();
  ctx.fillStyle='#94a3b8'; ctx.font='10px monospace';
  ctx.fillText(`E1=${econ.E1_used_kWh}kWh d=${econ.params.d}`, 45, 15);
  ctx.fillText(`0y`, 40, c.height-5); ctx.fillText(`${years[years.length-1]}y`, c.width-30, c.height-5);
}
function renderTimeseriesChart(ts){
  const canvas = document.getElementById('chart'); if(!canvas) return;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
  const maxP = Math.max(...ts.map(r=>r.power_W),1);
  ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.beginPath();
  ts.forEach((r,i)=>{
    const x = (i/ts.length)*canvas.width;
    const y = canvas.height - (r.power_W/maxP)*canvas.height*0.85 - 15;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }); ctx.stroke();
  // eclipse shading
  ctx.fillStyle='rgba(239,68,68,0.15)';
  ts.forEach((r,i)=>{
    if(r.eclipse){
      const x = (i/ts.length)*canvas.width;
      ctx.fillRect(x,0,2,canvas.height);
    }
  });
  ctx.fillStyle='#94a3b8'; ctx.font='11px sans-serif'; ctx.fillText(`Max ${maxP.toFixed(1)}W avg ${(ts.reduce((s,r)=>s+r.power_W,0)/ts.length).toFixed(1)}W`,10,18);
}
function renderHistory(){
  const container = document.getElementById('historyList'); if(!container) return;
  const hist = loadHistory(); container.innerHTML='';
  hist.slice(0,60).forEach(rec=>{
    const div=document.createElement('div'); div.className='history-item';
    const title = rec.type==='SIM'? `${rec.summary.avg_power_W}W, $${rec.econ.NPV}` : rec.type==='ALLCELLS'? `${rec.results[0]?.cellKey} 최고` : rec.type==='PERCELL'? `각셀 최적 ${rec.perCell.length}개` : `${rec.best?.score}`;
    div.innerHTML=`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;"><b>${rec.serial}</b> <span class="badge ${rec.type==='SIM'?'blue':'green'}">${rec.type}</span></div>
      <div>${title}</div><small>${new Date(rec.timestamp).toLocaleString()}</small>
      <div style="margin-top:6px;"><button onclick="viewHistoryItem('${rec.serial}')">상세 보기</button> <button class="secondary" onclick="downloadHistoryItem('${rec.serial}')">TXT</button></div>`;
    container.appendChild(div);
  });
}
function downloadHistoryItem(serial){
  const hist=loadHistory(); const rec=hist.find(h=>h.serial===serial); if(!rec) return;
  if(rec.type==='SIM') downloadTXT(`sim_${serial}.txt`, rec.resultTXT);
  else if(rec.type==='OPT') downloadTXT(`opt_${serial}.txt`, rec.resultTXT);
  else if(rec.type==='ALLCELLS') downloadTXT(`allcells_${serial}.txt`, rec.resultTXT);
  else if(rec.type==='PERCELL') downloadTXT(`percell_${serial}.txt`, rec.resultTXT);
}
function viewHistoryItem(serial){
  const hist=loadHistory(); const rec=hist.find(h=>h.serial===serial); if(!rec) return;
  renderResultGUI(rec); if(rec.timeseries) renderTimeseriesChart(rec.timeseries);
}
window.viewHistoryItem = viewHistoryItem;
window.downloadHistoryItem = downloadHistoryItem;

window.addEventListener('DOMContentLoaded', ()=>{
  renderHistory();
  const cellSelect = document.getElementById('cellType');
  // 가격 표시
  for(let k in CELL_DB){
    const opt = document.createElement('option'); opt.value=k;
    opt.textContent = `${CELL_DB[k].label} - $${CELL_DB[k].price_per_m2}/m² (η${(CELL_DB[k].eta0*100).toFixed(1)}%)`;
    cellSelect.appendChild(opt);
  }
  cellSelect.value="III-V_3J";

  document.getElementById('runSimBtn').onclick = ()=>{
    const cfg=collectSimConfig();
    const serial=getNextSerial('SIM');
    const {timeseries, summary}=simulate(cfg);
    const econ=calculateEconomics(cfg, summary);
    const resultTXT=toTXT_result(serial,cfg,summary,econ);
    const timeseriesTXT=toTXT_timeseries(serial,timeseries);
    const rec={serial, type:'SIM', timestamp:Date.now(), config:cfg, summary, econ, resultTXT, timeseriesTXT, timeseries};
    lastSim=rec; renderResultGUI(rec); renderTimeseriesChart(timeseries); saveRecord(rec);
    document.getElementById('status').textContent=`✅ ${serial} 완료 - ${summary.avg_power_W}W, NPV $${econ.NPV}, LCOE $${econ.LCOE}`;
  };

  document.getElementById('runOptBtn').onclick = async ()=>{
    const base=collectSimConfig();
    const ranges=collectOptRanges();
    const algo=document.getElementById('algoSelect').value;
    const objective=document.getElementById('objectiveSelect').value;
    const serial=getNextSerial('OPT');
    document.getElementById('status').textContent=`🔄 ${serial} ${algo} (${objective}) 최적화 중...`;
    setTimeout(()=>{
      const {tested,best,bestCfg}=ALGORITHMS[algo](base,ranges,objective, (p)=>{ document.getElementById('status').textContent=`🔄 ${serial} 진행 중 (${p})`; });
      const resultTXT=toTXT_optimization(serial, algo, base, ranges, tested, best, objective);
      const rec={serial, type:'OPT', algorithm:algo, objective, timestamp:Date.now(), config:base, ranges, summary:best?best.summary:null, resultTXT, tested, best};
      lastOpt=rec; renderResultGUI(rec);
      document.getElementById('status').textContent=`✅ ${serial} 최적화 완료 - Score ${best.score} NPV $${best.econ.NPV}`;
      saveRecord(rec);
      if(bestCfg){ const {timeseries}=simulate(bestCfg); renderTimeseriesChart(timeseries); }
    },50);
  };

  document.getElementById('runAllCellsBtn').onclick = ()=>{
    const base=collectSimConfig();
    const serial=getNextSerial('ALLCELLS');
    document.getElementById('status').textContent=`🔄 ${serial} 전체 셀 비교 중...`;
    setTimeout(()=>{
      const results=compareAllCells(base);
      const txt=toTXT_allCells(serial, results);
      const rec={serial, type:'ALLCELLS', timestamp:Date.now(), config:base, results, resultTXT:txt, summary:results[0].summary};
      lastAllCells=rec; renderResultGUI(rec); saveRecord(rec);
      document.getElementById('status').textContent=`✅ ${serial} 전체 비교 완료 - 최고 ${results[0].cellKey} NPV $${results[0].econ.NPV}`;
    },50);
  };

  document.getElementById('runPerCellOptBtn').onclick = ()=>{
    const base=collectSimConfig();
    const ranges=collectOptRanges();
    const serial=getNextSerial('PERCELL');
    document.getElementById('status').textContent=`🔄 ${serial} 각 셀 최적 환경 탐색 중 (Random 80회씩)...`;
    setTimeout(()=>{
      const perCell=findOptimalEnvPerCell(base, ranges, 80, "max_npv");
      let txt=`${serial} PER-CELL OPTIMAL ENV\n`;
      perCell.forEach(p=>{ txt+=`${p.cellKey}: alt ${p.best.config.altitude_km}km inc ${p.best.config.inclination_deg}° NPV ${p.econ.NPV}\n`; });
      const rec={serial, type:'PERCELL', timestamp:Date.now(), config:base, perCell, resultTXT:txt, summary:perCell[0]?.summary};
      renderResultGUI(rec); saveRecord(rec);
      document.getElementById('status').textContent=`✅ ${serial} 각 셀 최적 환경 완료`;
    },50);
  };

  document.getElementById('downloadSimResult').onclick=()=>{ if(lastSim) downloadTXT(`simulation_result_${lastSim.serial}.txt`, lastSim.resultTXT); };
  document.getElementById('downloadSimTimeseries').onclick=()=>{ if(lastSim) downloadTXT(`simulation_timeseries_${lastSim.serial}.txt`, lastSim.timeseriesTXT); };
  document.getElementById('downloadOptResult').onclick=()=>{ if(lastOpt) downloadTXT(`optimization_result_${lastOpt.serial}.txt`, lastOpt.resultTXT); };
  document.getElementById('downloadAll').onclick=()=>{
    const hist=loadHistory(); let all=''; hist.forEach(r=>{ all+=r.resultTXT+"\n\n"+"=".repeat(50)+"\n\n"; }); downloadTXT(`all_history_${new Date().toISOString().slice(0,10)}.txt`, all);
  };
  document.getElementById('clearHistory').onclick=()=>{
    if(confirm('전체 기록 삭제?')){ localStorage.removeItem(STORAGE_KEY); renderHistory(); }
  };
});