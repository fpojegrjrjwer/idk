
// economics.js - 경제적 가치 계산 (사용자 공식 그대로)
function calculateEconomics(config, summary){
  const cell = CELL_DB[config.solar_cell_type] || CELL_DB["III-V_3J"];
  const A = config.panel_area_m2 ?? 20;
  const eta = summary.avg_efficiency || cell.eta0; // 실제 평균 효율 사용
  const eta0 = cell.eta0;
  const G = config.solar_irradiance_W_m2 ?? 1361; // W/m2
  const PR = config.PR ?? 0.8;
  const gamma = cell.beta; // γ
  const deltaT = (summary.avg_temperature_K ?? 298) - 298.15;
  const d = cell.degradation_d; // 연간 열화율
  const r = (config.discount_rate ?? 5)/100; // 할인율
  const g = (config.electricity_growth_rate ?? 3)/100; // 전기요금 상승률
  const elecPrice = config.electricity_price ?? 0.15; // $/kWh
  const N = config.lifetime_years ?? cell.lifetime_years ?? 25;
  const launchPerKg = config.launch_cost_per_kg ?? 20000;
  const install = config.install_cost ?? 5000;
  const inverter = config.inverter_cost ?? 3000;

  // E1 공식 두가지 계산
  // 이론식: E1 = A·η·G·365·PR·(1+γΔT) -> Wh -> kWh
  const E1_formula = A * eta0 * G * 365 * PR * (1 + gamma*deltaT) / 1000 * summary.avg_cos_theta; // kWh/year
  // 시뮬 기반: avg_power * 24*365 /1000
  const E1_from_power = summary.avg_power_W * 24 * 365 / 1000;

  const E1_used = E1_from_power > 0 ? E1_from_power : E1_formula;

  // 비용
  const panelCost = A * cell.price_per_m2;
  const launchCost = A * cell.mass_kg_per_m2 * launchPerKg;
  const productionCost = panelCost * cell.production_cost_factor;
  const CAPEX = panelCost + launchCost + install + inverter;
  const totalCAPEX = CAPEX + productionCost;

  let maintenanceBase = config.maintenance_cost ?? 500;
  if(config.maintenance_is_percent){
    maintenanceBase = totalCAPEX * (config.maintenance_percent ?? 2)/100;
  }
  const annualMaintenance = maintenanceBase;

  // 연차별 계산
  let sumDiscEt = 0, sumDiscCt = 0, sumDiscNet = 0;
  let cumulativeValue = 0;
  let paybackYear = null;
  const yearly = [];
  let totalEnergyLifetime = 0;
  let totalValue = 0;

  for(let t=1; t<=N; t++){
    const Et = E1_used * Math.pow(1-d, t-1);
    const Vt = Et * elecPrice * Math.pow(1+g, t-1);
    const Mt = annualMaintenance;
    const Ct = (t===1) ? totalCAPEX + Mt : Mt;
    const discEt = Et / Math.pow(1+r, t);
    const discCt = Ct / Math.pow(1+r, t);
    const discVt = Vt / Math.pow(1+r, t);
    sumDiscEt += discEt;
    sumDiscCt += discCt;
    sumDiscNet += (Vt - Mt) / Math.pow(1+r, t);
    totalEnergyLifetime += Et;
    totalValue += Vt;
    cumulativeValue += (Vt - Mt);
    if(paybackYear===null && cumulativeValue >= totalCAPEX){
      // 선형 보간
      const prevCum = cumulativeValue - (Vt - Mt);
      const frac = (totalCAPEX - prevCum) / (Vt - Mt);
      paybackYear = (t-1) + frac;
    }
    yearly.push({ year:t, Et: +Et.toFixed(2), Vt: +Vt.toFixed(2), Mt: +Mt.toFixed(2), discEt: +discEt.toFixed(2), discCt: +discCt.toFixed(2), discVt: +discVt.toFixed(2), Ct: +Ct.toFixed(2) });
  }

  const LCOE = sumDiscEt>0 ? sumDiscCt / sumDiscEt : 0;
  const NPV = sumDiscNet - totalCAPEX;
  // IRR 근사: NPV 0 되는 r 찾기 (간단 2분법)
  let IRR = null;
  const calcNPVAt = (rate)=>{
    let s=0;
    for(let t=1; t<=N; t++){
      const Et = E1_used * Math.pow(1-d, t-1);
      const Vt = Et * elecPrice * Math.pow(1+g, t-1);
      s += (Vt - annualMaintenance) / Math.pow(1+rate, t);
    }
    return s - totalCAPEX;
  };
  let low=-0.2, high=1.0;
  let npvLow=calcNPVAt(low), npvHigh=calcNPVAt(high);
  if(npvLow*npvHigh < 0){
    for(let i=0;i<40;i++){
      const mid=(low+high)/2;
      const npvMid=calcNPVAt(mid);
      if(npvMid>0) low=mid; else high=mid;
    }
    IRR=(low+high)/2;
  }

  // 민감도 분석: 전기요금 변동
  const sensitivity = [];
  const factors = [{label:"비관 -20%", factor:0.8},{label:"기준", factor:1.0},{label:"낙관 +20%", factor:1.2},{label:"낙관 +50%", factor:1.5}];
  factors.forEach(f=>{
    const price = elecPrice * f.factor;
    let sNet=0, sLCC=0, sEt=0;
    for(let t=1; t<=N; t++){
      const Et = E1_used * Math.pow(1-d, t-1);
      const Vt = Et * price * Math.pow(1+g, t-1);
      const Ct = (t===1)? totalCAPEX + annualMaintenance : annualMaintenance;
      sNet += (Vt - annualMaintenance) / Math.pow(1+r, t);
      sLCC += Ct / Math.pow(1+r, t);
      sEt += Et / Math.pow(1+r, t);
    }
    const npv = sNet - totalCAPEX;
    const lcoe = sEt>0 ? sLCC / sEt : 0;
    const annualV = E1_used * price;
    sensitivity.push({ label:f.label, factor:f.factor, annualValue:+annualV.toFixed(2), NPV:+npv.toFixed(2), LCOE:+lcoe.toFixed(4), elecPrice:price });
  });

  // 일사량 민감도
  const irradianceSens = [];
  [0.85, 1.0, 1.15].forEach(f=>{
    const E1_s = E1_used * f;
    let sNet=0, sLCC=0, sEt=0;
    for(let t=1; t<=N; t++){
      const Et = E1_s * Math.pow(1-d, t-1);
      const Vt = Et * elecPrice * Math.pow(1+g, t-1);
      const Ct = (t===1)? totalCAPEX + annualMaintenance : annualMaintenance;
      sNet += (Vt - annualMaintenance) / Math.pow(1+r, t);
      sLCC += Ct / Math.pow(1+r, t);
      sEt += Et / Math.pow(1+r, t);
    }
    irradianceSens.push({ label: `${(f*100).toFixed(0)}% 일사량`, factor:f, NPV:+(sNet-totalCAPEX).toFixed(2), LCOE:+(sLCC/(sEt||1)).toFixed(4) });
  });

  return {
    cell,
    E1_formula_kWh: +E1_formula.toFixed(2),
    E1_from_power_kWh: +E1_from_power.toFixed(2),
    E1_used_kWh: +E1_used.toFixed(2),
    panelCost: +panelCost.toFixed(2),
    launchCost: +launchCost.toFixed(2),
    productionCost: +productionCost.toFixed(2),
    CAPEX: +CAPEX.toFixed(2),
    totalCAPEX: +totalCAPEX.toFixed(2),
    annualMaintenance: +annualMaintenance.toFixed(2),
    LCC: +sumDiscCt.toFixed(2),
    totalEnergyLifetime: +totalEnergyLifetime.toFixed(2),
    totalValue: +totalValue.toFixed(2),
    LCOE: +LCOE.toFixed(5),
    NPV: +NPV.toFixed(2),
    IRR: IRR!==null? +IRR.toFixed(4): null,
    paybackYears: paybackYear!==null? +paybackYear.toFixed(2): null,
    yearly,
    sensitivity,
    irradianceSens,
    params: { A, eta, eta0, G, PR, gamma, deltaT, d, r, g, elecPrice, N }
  };
}