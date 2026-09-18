
// optimizer.js - 기존 알고리즘 + 경제 목적함수 + 2종 최적화
function* gridGenerator(ranges){
  const keys = Object.keys(ranges);
  const vals = keys.map(k=>{
    const [mn,mx,step]=ranges[k];
    const arr=[];
    for(let v=mn; v<=mx+1e-9; v+=step) arr.push(+v.toFixed(2));
    return arr;
  });
  function* rec(idx, cur){
    if(idx===keys.length){ yield {...cur}; return; }
    for(let v of vals[idx]){ cur[keys[idx]]=v; yield* rec(idx+1, cur); }
  }
  yield* rec(0,{});
}

// 공통 평가 함수 - physics + economics
function evaluateConfig(baseConfig, varConfig, objective="max_power"){
  const cfg={...baseConfig, ...varConfig};
  const {summary, timeseries} = simulate(cfg);
  const econ = calculateEconomics(cfg, summary);
  let score=0;
  if(objective==="max_power") score = summary.avg_power_W;
  else if(objective==="max_npv") score = econ.NPV;
  else if(objective==="min_lcoe") score = -econ.LCOE; // 최소화는 음수
  else if(objective==="max_value") score = econ.totalValue;
  else score = scoreSummary(summary);
  return { cfg, summary, econ, timeseries, score };
}

function optimizeBrute(base, ranges, maxCases=2000, objective="max_power", onProgress){
  const tested=[]; let best=null, bestCfg=null, bestScore=-1e18; let i=0;
  for(let varCfg of gridGenerator(ranges)){
    if(i>=maxCases) break;
    const res = evaluateConfig(base, varCfg, objective);
    const rec={case_serial:`CASE-${String(i+1).padStart(6,'0')}`, config:varCfg, summary:res.summary, econ:res.econ, score:+res.score.toFixed(2)};
    tested.push(rec);
    if(res.score>bestScore){ bestScore=res.score; best=rec; bestCfg=res.cfg; }
    i++; if(onProgress && i%20===0) onProgress(i);
  }
  return {tested,best,bestCfg, bestScore};
}
function optimizeRandom(base, ranges, n=300, objective="max_power", onProgress){
  const keys=Object.keys(ranges); const tested=[]; let best=null,bestCfg=null,bestScore=-1e18;
  for(let i=0;i<n;i++){
    const varCfg={}; keys.forEach(k=>{ const [mn,mx]=ranges[k]; varCfg[k]=+(mn+Math.random()*(mx-mn)).toFixed(2); });
    const res = evaluateConfig(base, varCfg, objective);
    const rec={case_serial:`CASE-${String(i+1).padStart(6,'0')}`, config:varCfg, summary:res.summary, econ:res.econ, score:+res.score.toFixed(2)};
    tested.push(rec);
    if(res.score>bestScore){ bestScore=res.score; best=rec; bestCfg=res.cfg; }
    if(onProgress) onProgress(i+1);
  }
  return {tested,best,bestCfg, bestScore};
}
function optimizeGenetic(base, ranges, pop=20, gens=20, objective="max_power", onProgress){
  const keys=Object.keys(ranges);
  const randCfg=()=>{ const o={}; keys.forEach(k=>{ const [mn,mx]=ranges[k]; o[k]=+(mn+Math.random()*(mx-mn)).toFixed(2); }); return o; };
  const cross=(a,b)=>{ const o={}; keys.forEach(k=>o[k]=Math.random()<0.5?a[k]:b[k]); return o; };
  const mutate=(c)=>{ const o={...c}; const k=keys[Math.floor(Math.random()*keys.length)]; const [mn,mx]=ranges[k]; o[k]=Math.max(mn, Math.min(mx, o[k]+(Math.random()-0.5)*10)); o[k]=+o[k].toFixed(2); return o; };
  let population=Array.from({length:pop}, randCfg);
  let tested=[], best=null, bestCfg=null, bestScore=-1e18, caseId=0;
  for(let g=0; g<gens; g++){
    let scored=[];
    population.forEach(cfgVar=>{
      caseId++;
      const res = evaluateConfig(base, cfgVar, objective);
      const rec={case_serial:`CASE-${String(caseId).padStart(6,'0')}`, config:cfgVar, summary:res.summary, econ:res.econ, score:+res.score.toFixed(2), gen:g};
      tested.push(rec); scored.push({score:res.score,cfgVar,rec, full:res});
      if(res.score>bestScore){ bestScore=res.score; best=rec; bestCfg=res.cfg; }
    });
    scored.sort((a,b)=>b.score-a.score);
    const top=scored.slice(0, Math.floor(pop/2)).map(s=>s.cfgVar);
    const newPop=[];
    while(newPop.length<pop){
      const [p1,p2]=[top[Math.floor(Math.random()*top.length)], top[Math.floor(Math.random()*top.length)]];
      let child=cross(p1,p2); if(Math.random()<0.3) child=mutate(child); newPop.push(child);
    }
    population=newPop; if(onProgress) onProgress(g+1);
  }
  return {tested,best,bestCfg, bestScore};
}
function optimizePSO(base, ranges, particles=20, iters=20, objective="max_power", onProgress){
  const keys=Object.keys(ranges);
  let pos=Array.from({length:particles}, ()=>{ const o={}; keys.forEach(k=>{ const [mn,mx]=ranges[k]; o[k]=mn+Math.random()*(mx-mn); }); return o; });
  let vel=Array.from({length:particles}, ()=>{ const o={}; keys.forEach(k=>o[k]=(Math.random()-0.5)*2); return o; });
  let pbest=pos.map(p=>({...p})); let pbestScore=Array(particles).fill(-1e18);
  let gbest=null, gbestScore=-1e18, best=null, bestCfg=null; let tested=[], caseId=0;
  for(let it=0; it<iters; it++){
    for(let i=0;i<particles;i++){
      const varCfg=keys.reduce((a,k)=>{a[k]=+pos[i][k].toFixed(2);return a;},{});
      const res = evaluateConfig(base, varCfg, objective);
      caseId++;
      const rec={case_serial:`CASE-${String(caseId).padStart(6,'0')}`, config:varCfg, summary:res.summary, econ:res.econ, score:+res.score.toFixed(2), iter:it};
      tested.push(rec);
      if(res.score>pbestScore[i]){ pbestScore[i]=res.score; pbest[i]={...pos[i]}; }
      if(res.score>gbestScore){ gbestScore=res.score; gbest={...pos[i]}; best=rec; bestCfg=res.cfg; }
    }
    for(let i=0;i<particles;i++){
      keys.forEach(k=>{
        const r1=Math.random(), r2=Math.random();
        vel[i][k]=0.5*vel[i][k]+1.5*r1*(pbest[i][k]-pos[i][k])+1.5*r2*(gbest[k]-pos[i][k]);
        pos[i][k]+=vel[i][k];
        const [mn,mx]=ranges[k]; pos[i][k]=Math.max(mn, Math.min(mx, pos[i][k]));
      });
    }
    if(onProgress) onProgress(it+1);
  }
  return {tested,best,bestCfg, bestScore:gbestScore};
}
function optimizeBayesian(base, ranges, nInit=20, nIter=30, objective="max_power", onProgress){
  let {tested,best,bestCfg, bestScore}=optimizeRandom(base,ranges,nInit,objective);
  if(!best) return {tested,best,bestCfg, bestScore};
  const keys=Object.keys(ranges); let caseId=tested.length;
  for(let i=0;i<nIter;i++){
    const varCfg={};
    keys.forEach(k=>{
      const [mn,mx]=ranges[k];
      const center=best.config[k];
      let v = center + (Math.random()-0.5)*(mx-mn)*0.2;
      v=Math.max(mn, Math.min(mx, v));
      varCfg[k]=+v.toFixed(2);
    });
    const res = evaluateConfig(base, varCfg, objective);
    caseId++;
    const rec={case_serial:`CASE-${String(caseId).padStart(6,'0')}`, config:varCfg, summary:res.summary, econ:res.econ, score:+res.score.toFixed(2)};
    tested.push(rec);
    if(res.score>bestScore){ bestScore=res.score; best=rec; bestCfg=res.cfg; }
    if(onProgress) onProgress(i+1);
  }
  return {tested,best,bestCfg, bestScore};
}

const ALGORITHMS = {
  brute_force: (b,r,obj,cb)=>optimizeBrute(b,r,2000,obj,cb),
  grid_search: (b,r,obj,cb)=>optimizeBrute(b,r,2000,obj,cb),
  random_search: (b,r,obj,cb)=>optimizeRandom(b,r,300,obj,cb),
  genetic: (b,r,obj,cb)=>optimizeGenetic(b,r,20,15,obj,cb),
  pso: (b,r,obj,cb)=>optimizePSO(b,r,20,15,obj,cb),
  bayesian: (b,r,obj,cb)=>optimizeBayesian(b,r,20,30,obj,cb),
  gradient: (b,r,obj,cb)=>optimizeRandom(b,r,200,obj,cb),
  ai_based: (b,r,obj,cb)=>optimizeBayesian(b,r,20,30,obj,cb)
};

// Type B: 전체 전지 비교 (현재 환경에서)
function compareAllCells(baseConfig){
  const results=[];
  for(let cellKey in CELL_DB){
    const cfg = {...baseConfig, solar_cell_type: cellKey};
    const {summary} = simulate(cfg);
    const econ = calculateEconomics(cfg, summary);
    results.push({ cellKey, cell: CELL_DB[cellKey], summary, econ, score: econ.NPV });
  }
  results.sort((a,b)=>b.econ.NPV - a.econ.NPV);
  return results;
}

// Type B-2: 각 셀의 최적 환경 찾기
function findOptimalEnvPerCell(baseConfig, ranges, n=80, objective="max_npv"){
  const perCell=[];
  for(let cellKey in CELL_DB){
    const base = {...baseConfig, solar_cell_type: cellKey};
    const {best, bestCfg} = optimizeRandom(base, ranges, n, objective);
    if(best){
      perCell.push({ cellKey, cell: CELL_DB[cellKey], best, bestCfg, econ: best.econ, summary: best.summary });
    }
  }
  perCell.sort((a,b)=>b.econ.NPV - a.econ.NPV);
  return perCell;
}

function toTXT_optimization(serial, algorithm, base, ranges, tested, best, objective){
  let txt=`${serial}\n` + "=".repeat(50) + `\nalgorithm: ${algorithm}\nobjective: ${objective}\ntested_count: ${tested.length}\nGenerated: ${new Date().toISOString()}\n\n[OPTIMIZATION_INPUT]\nBase:\n`;
  for(let k in base) txt+=`${k}: ${base[k]}\n`;
  txt+="\nRanges:\n";
  for(let k in ranges) txt+=`${k}: ${ranges[k][0]} ~ ${ranges[k][1]} step ${ranges[k][2]}\n`;
  txt+="\n[BEST_SOLUTION]\n";
  if(best){
    txt+=`score: ${best.score}\n`;
    for(let k in best.config) txt+=`${k}: ${best.config[k]}\n`;
    txt+="\nSummary:\n";
    for(let k in best.summary) txt+=`${k}: ${best.summary[k]}\n`;
    txt+="\nEconomics:\n";
    txt+=`E1: ${best.econ.E1_used_kWh} kWh\nNPV: ${best.econ.NPV}\nLCOE: ${best.econ.LCOE}\nCAPEX: ${best.econ.totalCAPEX}\n`;
  }
  txt+="\n[TESTED_SUMMARY]\n";
  tested.slice(0,300).forEach(rec=>{
    txt+=`${rec.case_serial}: score=${rec.score}, NPV=${rec.econ.NPV}, LCOE=${rec.econ.LCOE}, avgPower=${rec.summary.avg_power_W}W, config=${JSON.stringify(rec.config)}\n`;
  });
  if(tested.length>300) txt+=`... and ${tested.length-300} more cases\n`;
  return txt;
}
function toTXT_allCells(serial, allResults){
  let txt=`${serial} ALL-CELLS COMPARISON\n` + "=".repeat(50) + `\nGenerated: ${new Date().toISOString()}\n\n`;
  allResults.forEach((r,i)=>{
    txt+=`${i+1}. ${r.cellKey} - $${r.cell.price_per_m2}/m2 | NPV:${r.econ.NPV} | LCOE:${r.econ.LCOE} | Power:${r.summary.avg_power_W}W | E1:${r.econ.E1_used_kWh}kWh\n`;
  });
  return txt;
}