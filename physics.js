

// physics.js - 궤도/열/방사선 + 셀 DB (가격 포함)
const CONSTANTS = {
  R_EARTH_KM: 6371.0,
  MU: 398600.4418,
  SIGMA: 5.670374419e-8,
  SOLAR_CONSTANT: 1361,
  STC: 1000,
  T0: 298.15
};

// 태양전지 DB - 가격, 효율, 감쇠, 무게, 수명 모두 포함 (INPUT에서 가격 표시)
const CELL_DB = {
  "III-V_3J": { label:"III-V_3J", eta0:0.32, beta:-0.0021, price_per_m2:2850, mass_kg_per_m2:1.8, degradation_d:0.005, lifetime_years:25, production_cost_factor:0.15, color:"#f97316" },
  "Si": { label:"Si", eta0:0.22, beta:-0.0045, price_per_m2:185, mass_kg_per_m2:2.2, degradation_d:0.007, lifetime_years:25, production_cost_factor:0.12, color:"#94a3b8" },
  "GaAs": { label:"GaAs", eta0:0.29, beta:-0.0025, price_per_m2:850, mass_kg_per_m2:1.5, degradation_d:0.006, lifetime_years:25, production_cost_factor:0.18, color:"#e879f9" },
  "Perovskite": { label:"Perovskite", eta0:0.24, beta:-0.0030, price_per_m2:95, mass_kg_per_m2:0.6, degradation_d:0.02, lifetime_years:15, production_cost_factor:0.08, color:"#22d3ee" },
  "TOPCon": { label:"TOPCon", eta0:0.235, beta:-0.0038, price_per_m2:195, mass_kg_per_m2:2.0, degradation_d:0.006, lifetime_years:25, production_cost_factor:0.11, color:"#a3e635" },
  "HJT": { label:"HJT", eta0:0.245, beta:-0.0032, price_per_m2:210, mass_kg_per_m2:2.1, degradation_d:0.0055, lifetime_years:25, production_cost_factor:0.13, color:"#facc15" },
  "CIGS": { label:"CIGS", eta0:0.195, beta:-0.0035, price_per_m2:145, mass_kg_per_m2:1.2, degradation_d:0.008, lifetime_years:20, production_cost_factor:0.10, color:"#fb7185" },
  "CdTe": { label:"CdTe", eta0:0.18, beta:-0.0030, price_per_m2:110, mass_kg_per_m2:1.4, degradation_d:0.009, lifetime_years:20, production_cost_factor:0.09, color:"#818cf8" }
};

function orbitalPeriod(alt){
  const r = CONSTANTS.R_EARTH_KM + alt;
  return 2*Math.PI*Math.sqrt(Math.pow(r,3)/CONSTANTS.MU);
}
function isEclipse(phaseDeg, alt){
  const r = CONSTANTS.R_EARTH_KM + alt;
  const shadow = Math.asin(CONSTANTS.R_EARTH_KM/r)*180/Math.PI;
  let p = ((phaseDeg % 360)+360)%360;
  return Math.abs(p-180) < shadow;
}
function cosTheta(phaseDeg, panelOri, incDeg){
  const total = (phaseDeg + panelOri)*Math.PI/180;
  const incFactor = Math.cos(incDeg*Math.PI/180)*0.3 + 0.7;
  return Math.max(0, Math.cos(total)*incFactor);
}
function thermalTemp(I, cosT, abs=0.9, emiss=0.85){
  if(cosT<=0||I<=0) return 280;
  const absorbed = abs*I*cosT;
  const T4 = absorbed/(emiss*CONSTANTS.SIGMA) + Math.pow(3,4);
  let T = Math.pow(T4,0.25);
  return Math.min(Math.max(T,200),450);
}
function doseRate(alt, incDeg){
  return 0.01 * Math.pow(alt/500,1.2) * (1+0.8*Math.sin(incDeg*Math.PI/180));
}
function degradedEta(eta0, beta, T, dose, tYears){
  // beta는 음수, T-298.15
  const etaTemp = eta0*(1 + beta*(T-298.15));
  const etaRad = etaTemp*Math.exp(-0.05*dose*tYears);
  return Math.max(0.05, etaRad);
}
function simulate(config){
  const alt = config.altitude_km ?? 500;
  const inc = config.inclination_deg ?? 45;
  const raan = config.raan_deg ?? 0;
  const initPhase = config.initial_orbital_phase_deg ?? 0;
  const panelOri = config.panel_orientation_deg ?? 0;
  const area = config.panel_area_m2 ?? 20;
  const cellType = config.solar_cell_type ?? "III-V_3J";
  const I0 = config.solar_irradiance_W_m2 ?? 1361;
  const absorp = config.absorptivity ?? 0.90;
  const emiss = config.emissivity ?? 0.85;
  const durDays = config.simulation_duration_days ?? 1;
  const dt = config.time_step_seconds ?? 60;
  const cell = CELL_DB[cellType] || CELL_DB["III-V_3J"];
  const period = orbitalPeriod(alt);
  const totalSec = durDays*86400;
  const steps = Math.floor(totalSec/dt);
  const dRate = doseRate(alt, inc);
  let dose=0, totalEnergy=0, maxP=0, sumP=0, sumT=0, sumEta=0, sumCos=0, eclipseCount=0;
  const timeseries=[];
  let lastEta=cell.eta0;
  for(let i=0;i<steps;i++){
    const tSec=i*dt;
    const tDays=tSec/86400;
    const tYears=tDays/365.25;
    const phase = (initPhase + (tSec/period)*360 + raan) % 360;
    const eclipse = isEclipse(phase, alt);
    if(eclipse) eclipseCount++;
    const ct = eclipse ? 0 : cosTheta(phase, panelOri, inc);
    sumCos+=ct;
    const T = thermalTemp(I0, ct, absorp, emiss);
    dose += dRate * (dt/86400);
    const eta = degradedEta(cell.eta0, cell.beta, T, dose, tYears);
    lastEta=eta;
    const P = eclipse ? 0 : eta*I0*area*ct;
    totalEnergy += P*(dt/3600);
    maxP = Math.max(maxP, P);
    sumP+=P; sumT+=T; sumEta+=eta;
    if(i%Math.max(1, Math.floor(steps/400))===0){
      timeseries.push({ time_sec: tSec, time_days: +tDays.toFixed(4), orbital_phase_deg: +phase.toFixed(2), eclipse: eclipse, cos_theta: +ct.toFixed(4), temperature_K: +T.toFixed(2), efficiency: +eta.toFixed(4), power_W: +P.toFixed(2), dose: +dose.toFixed(4) });
    }
  }
  const avgP = steps? sumP/steps:0;
  const summary={
    altitude_km: alt, inclination_deg: inc, raan_deg: raan, initial_orbital_phase_deg: initPhase, panel_orientation_deg: panelOri, panel_area_m2: area, solar_cell_type: cellType,
    orbital_period_s: +period.toFixed(1), max_power_W: +maxP.toFixed(2), avg_power_W: +avgP.toFixed(2), total_energy_kWh: +(totalEnergy/1000).toFixed(2), total_energy_Wh: +totalEnergy.toFixed(2),
    avg_temperature_K: +(sumT/steps||0).toFixed(2), avg_temperature_C: +((sumT/steps||0)-273.15).toFixed(2),
    avg_efficiency: +(sumEta/steps||0).toFixed(4), final_efficiency: +lastEta.toFixed(4), final_dose: +dose.toFixed(4),
    eclipse_fraction: +(eclipseCount/steps||0).toFixed(4), avg_cos_theta: +(sumCos/steps||0).toFixed(4),
    steps: steps, duration_days: durDays
  };
  return {timeseries, summary};
}
function scoreSummary(s){
  const w1=1.0,w2=0.01,w3=10,w4=0.1;
  return w1*s.avg_power_W - w2*s.avg_temperature_K - w3*s.final_dose + w4*s.total_energy_kWh;
}
function toTXT_timeseries(serial, ts){
  let txt = `${serial}\n` + "=".repeat(50) + "\n[TIMESERIES]\ntime_days,phase_deg,eclipse,cos_theta,temp_K,eff,power_W,dose\n";
  ts.forEach(r=>{ txt+=`${r.time_days},${r.orbital_phase_deg},${r.eclipse?1:0},${r.cos_theta},${r.temperature_K},${r.efficiency},${r.power_W},${r.dose}\n`; });
  return txt;
}
function toTXT_result(serial, config, summary, econ){
  let txt = `${serial}\n` + "=".repeat(50) + `\nGenerated: ${new Date().toISOString()}\n\n[INPUT]\n`;
  for(let k in config) txt+=`${k}: ${config[k]}\n`;
  txt+="\n[SUMMARY]\n";
  for(let k in summary) txt+=`${k}: ${summary[k]}\n`;
  if(econ){
    txt+="\n[ECONOMICS]\n";
    txt+=`E1_formula_kWh: ${econ.E1_formula_kWh}\nE1_used_kWh: ${econ.E1_used_kWh}\nCAPEX: ${econ.totalCAPEX}\nLCOE: ${econ.LCOE}\nNPV: ${econ.NPV}\nPayback: ${econ.paybackYears}\n`;
    txt+="\n[FORMULA]\nE1 = A·η·G·365·PR·(1+γΔT)\nE(t)=E1·(1-d)^(t-1)\nLCOE = ΣCt/(1+r)^t / ΣEt/(1+r)^t\nNPV = Σ(Vt-Mt)/(1+r)^t - CAPEX\n";
  }
  txt+=`score: ${scoreSummary(summary).toFixed(2)}\n`;
  return txt;
}