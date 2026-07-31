import { useState, useEffect, useMemo } from "react";

const C = {
  bg:"#ffffff", surface:"#f7f8fa", raised:"#eef0f5", border:"#dde1eb",
  accent:"#FE5716", gold:"#1089FF", text:"#0f1623", muted:"#7a849e",
  des:"#FE5716", feas:"#1089FF", via:"#0d6ecc", danger:"#e03030",
};

const AGENTS = {
  clarification: {
    label:"Clarification", color:C.accent, icon:"◎",
    system:`You are an innovation consultant specialising in the UK energy sector. Your scope is strictly ideas related to power generation, distribution, retail, flexibility, or closely adjacent energy services in the UK.

Ask exactly 4 targeted clarifying questions covering: (1) primary customer or end-user segment within UK energy, (2) the specific problem or friction being solved, (3) proposed solution mechanism, (4) current stage of development.

Return ONLY valid JSON, no preamble:
{ "questions": ["q1","q2","q3","q4"], "summary": "one sentence restatement", "inScope": true }

If the idea is clearly outside UK energy, set inScope to false and add "scopeNote": "brief explanation".`,
  },
  desirability: {
    label:"Desirability", color:C.des, icon:"◈",
    system:`You are a Desirability Analyst specialising in the UK energy market using human-centred design principles.

Create a realistic UK-based persona relevant to the idea and assess desirability through their eyes.

UK personas must reflect authentic UK demographics, British culture, UK attitudes to energy bills, net zero awareness, smart meter rollout, Ofgem price cap context, and real UK energy market dynamics.

Return ONLY valid JSON. Keep all string values concise (2 sentences max per field):
{
  "persona": {
    "name": "string (British name)",
    "role": "string (e.g. Facilities Manager at an NHS Trust in Leeds)",
    "profile": "1-2 sentences of vivid UK context",
    "pains": ["pain 1", "pain 2", "pain 3"],
    "gains": ["gain 1", "gain 2", "gain 3"]
  },
  "assessment": "2 short paragraphs evaluating the idea from this persona perspective",
  "score": 7,
  "scoreRationale": "one sentence",
  "opportunities": ["opp 1", "opp 2", "opp 3"],
  "risks": ["risk 1", "risk 2", "risk 3"]
}`,
  },
  feasibility: {
    label:"Feasibility", color:C.feas, icon:"◉",
    system:`You are a Feasibility Analyst with deep expertise in UK energy technology, engineering, and regulation.

Assess feasibility drawing on UK-specific context: Ofgem, DESNZ, NESO, DNOs, BSC/EMR frameworks, GB transmission and distribution, Balancing Mechanism, CfD, REGO, REMA, IETF, LNRS.

Return ONLY valid JSON. Keep all string values concise (2 sentences max):
{
  "trlLevel": 4,
  "trlDescription": "one sentence describing TRL in this context",
  "assessment": "2 short paragraphs on feasibility",
  "score": 6,
  "scoreRationale": "one sentence",
  "keyTechnologies": ["tech 1", "tech 2", "tech 3"],
  "regulatoryConsiderations": ["UK reg 1 citing body/framework", "UK reg 2", "UK reg 3"],
  "effortEstimate": "e.g. 12-24 months to MVP",
  "risks": ["risk 1", "risk 2", "risk 3"]
}`,
  },
  viability: {
    label:"Viability", color:C.via, icon:"◑",
    system:`You are a Viability Analyst specialising in the UK energy sector commercial landscape.

All market size figures MUST be in GBP (£). Reference UK-specific market data. Identify real UK-based or UK-active competitors. Consider Ofgem price controls, network charging, TNUOS/DUoS, PPA structures, Supplier Obligation, and UK energy retail/wholesale dynamics.

Return ONLY valid JSON. Keep all string values concise (2 sentences max):
{
  "marketSize": "£X bn TAM with one line of UK-specific reasoning",
  "assessment": "2 short paragraphs on commercial viability in UK energy",
  "score": 7,
  "scoreRationale": "one sentence",
  "competitors": [
    { "name": "string", "description": "one sentence UK context" },
    { "name": "string", "description": "one sentence UK context" },
    { "name": "string", "description": "one sentence UK context" }
  ],
  "differentiators": ["diff 1", "diff 2", "diff 3"],
  "risks": ["risk 1", "risk 2", "risk 3"],
  "revenueModels": ["model 1", "model 2"]
}`,
  },
};

function extractJSON(raw) {
  let text = raw.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  try { return JSON.parse(text); } catch(_) {}
  const start = text.indexOf("{");
  if (start===-1) throw new Error("No JSON found in response");
  let depth=0,end=-1;
  for (let i=start;i<text.length;i++) {
    if (text[i]==="{") depth++;
    else if (text[i]==="}") { depth--; if (depth===0) { end=i; break; } }
  }
  if (end!==-1) { try { return JSON.parse(text.slice(start,end+1)); } catch(_) {} }
  let frag=(end!==-1?text.slice(start,end+1):text.slice(start)).replace(/,\s*$/,"");
  let braces=0,brackets=0,inStr=false,esc=false;
  for (const ch of frag) {
    if (esc) { esc=false; continue; }
    if (ch==="\\"&&inStr) { esc=true; continue; }
    if (ch==='"') { inStr=!inStr; continue; }
    if (inStr) continue;
    if (ch==="{") braces++; else if (ch==="}") braces--;
    else if (ch==="[") brackets++; else if (ch==="]") brackets--;
  }
  if (inStr) frag+='"';
  frag+="]".repeat(Math.max(0,brackets))+"}".repeat(Math.max(0,braces));
  try { return JSON.parse(frag); } catch {
    throw new Error("Could not parse agent response — please try again.");
  }
}

// Calls the serverless proxy in /api/claude.js, which holds the API key.
// The key is never present in this bundle.
const REQUEST_TIMEOUT_MS = 90_000;

async function callClaude(system, user) {
  // Without this, a stalled request leaves the loading dots spinning forever.
  const ac = new AbortController();
  const timer = setTimeout(()=>ac.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch("/api/claude", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ system, user }),
      signal: ac.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Request timed out — please try again.");
    throw new Error("Network error — check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(()=>null);
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return extractJSON(data.text || "");
}

function Chip({label,color}) {
  return <span style={{display:"inline-block",padding:"2px 10px",borderRadius:20,fontSize:10,fontWeight:600,letterSpacing:1.2,textTransform:"uppercase",background:color+"22",color,border:`1px solid ${color}44`,fontFamily:"'IBM Plex Mono',monospace"}}>{label}</span>;
}

function Dots({color}) {
  return <span style={{display:"inline-flex",gap:4,alignItems:"center"}}>
    {[0,1,2].map(i=><span key={i} style={{width:5,height:5,borderRadius:"50%",background:color,display:"inline-block",animation:`dp 1.3s ease-in-out ${i*0.22}s infinite`}}/>)}
  </span>;
}

function Ring({score,color,size=76}) {
  const r=(size-10)/2,circ=2*Math.PI*r,fill=Math.min(Math.max(score,0)/10,1)*circ;
  return <svg width={size} height={size} style={{transform:"rotate(-90deg)",flexShrink:0}}>
    <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={5}/>
    <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5} strokeDasharray={`${fill} ${circ-fill}`} strokeLinecap="round" style={{transition:"stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)"}}/>
    <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize={size*0.21} fontWeight="700" style={{transform:`rotate(90deg)`,transformOrigin:`${size/2}px ${size/2}px`,fontFamily:"'IBM Plex Mono',monospace"}}>{score}/10</text>
  </svg>;
}

function AgentCard({agentKey,data,loading}) {
  const cfg=AGENTS[agentKey];
  const [open,setOpen]=useState(false);
  const isD=agentKey==="desirability",isF=agentKey==="feasibility",isV=agentKey==="viability";
  // A failed agent carries { error } and no score. It must never render a
  // Ring, because "0/10" is indistinguishable from a real verdict.
  const failed=!!data?.error;
  const expandable=!!data&&!failed;
  return <div style={{background:C.surface,borderRadius:10,marginBottom:12,border:`1px solid ${failed?C.danger+"55":data?cfg.color+"55":C.border}`,overflow:"hidden",transition:"border-color 0.4s"}}>
    <div onClick={()=>expandable&&setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:14,padding:"18px 22px",cursor:expandable?"pointer":"default"}}>
      <span style={{fontSize:20,color:failed?C.danger:cfg.color,flexShrink:0}}>{cfg.icon}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace"}}>Analysis Agent</div>
        <div style={{fontSize:17,fontWeight:700,color:C.text}}>{cfg.label}</div>
        {failed&&<div style={{fontSize:12,color:C.danger,marginTop:4,lineHeight:1.5}}>{data.error}</div>}
      </div>
      {loading&&<Dots color={cfg.color}/>}
      {failed&&<Chip label="Not completed" color={C.danger}/>}
      {data&&!loading&&!failed&&<Ring score={data.score??0} color={cfg.color}/>}
      {expandable&&<span style={{color:C.muted,fontSize:13}}>{open?"▲":"▼"}</span>}
    </div>
    {open&&expandable&&<div style={{padding:"0 22px 24px",borderTop:`1px solid ${C.border}`}}>
      {isD&&data.persona&&<div style={{marginTop:18,padding:16,background:C.raised,borderRadius:8,borderLeft:`3px solid ${cfg.color}`}}>
        <Chip label="UK Customer Persona" color={cfg.color}/>
        <div style={{marginTop:10,fontSize:16,fontWeight:700,color:C.text}}>{data.persona.name}</div>
        <div style={{fontSize:13,color:cfg.color,marginBottom:6}}>{data.persona.role}</div>
        <div style={{fontSize:13,color:C.muted,marginBottom:12,lineHeight:1.7}}>{data.persona.profile}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><div style={{fontSize:10,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>Pains</div>{(data.persona.pains||[]).map((p,i)=><div key={i} style={{fontSize:12,color:C.text,marginBottom:4}}>— {p}</div>)}</div>
          <div><div style={{fontSize:10,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>Gains</div>{(data.persona.gains||[]).map((g,i)=><div key={i} style={{fontSize:12,color:C.text,marginBottom:4}}>+ {g}</div>)}</div>
        </div>
      </div>}
      {isF&&<div style={{marginTop:18,display:"flex",gap:14,alignItems:"center"}}>
        <div style={{padding:"10px 18px",background:cfg.color+"22",borderRadius:8,textAlign:"center",flexShrink:0}}>
          <div style={{fontSize:26,fontWeight:700,color:cfg.color,fontFamily:"'IBM Plex Mono',monospace"}}>TRL {data.trlLevel}</div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1}}>Readiness</div>
        </div>
        <div style={{fontSize:13,color:C.muted,lineHeight:1.7}}>{data.trlDescription}</div>
      </div>}
      {isV&&data.marketSize&&<div style={{marginTop:18,padding:"12px 16px",background:C.raised,borderRadius:8,borderLeft:`3px solid ${cfg.color}`}}>
        <div style={{fontSize:10,color:cfg.color,letterSpacing:2,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>UK Market Size (£)</div>
        <div style={{fontSize:14,color:C.text,lineHeight:1.6}}>{data.marketSize}</div>
      </div>}
      <div style={{marginTop:16,fontSize:13,color:C.muted,lineHeight:1.8}}>{data.assessment}</div>
      <div style={{marginTop:12,padding:"8px 14px",background:cfg.color+"11",borderRadius:6,fontSize:13,color:cfg.color,fontStyle:"italic"}}>Score rationale: {data.scoreRationale}</div>
      <div style={{marginTop:18,display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div>
          <div style={{fontSize:10,color:cfg.color,letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:8}}>{isD?"Opportunities":isF?"Key Technologies":"Differentiators"}</div>
          {(data.opportunities||data.keyTechnologies||data.differentiators||[]).map((x,i)=><div key={i} style={{fontSize:12,color:C.text,marginBottom:5}}>✦ {x}</div>)}
        </div>
        <div>
          <div style={{fontSize:10,color:C.danger,letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:8}}>Risks</div>
          {(data.risks||[]).map((x,i)=><div key={i} style={{fontSize:12,color:C.text,marginBottom:5}}>⚠ {x}</div>)}
        </div>
      </div>
      {isF&&(data.regulatoryConsiderations||[]).length>0&&<div style={{marginTop:16}}>
        <div style={{fontSize:10,color:C.gold,letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:8}}>UK Regulatory Considerations</div>
        {data.regulatoryConsiderations.map((r,i)=><div key={i} style={{fontSize:12,color:C.text,marginBottom:5}}>⚖ {r}</div>)}
      </div>}
      {isF&&data.effortEstimate&&<div style={{marginTop:14,display:"inline-flex",gap:8,alignItems:"center",padding:"8px 14px",background:C.bg,borderRadius:6}}>
        <span style={{color:cfg.color}}>⏱</span>
        <span style={{fontSize:13,color:C.text}}>Effort to MVP: <strong>{data.effortEstimate}</strong></span>
      </div>}
      {isV&&(data.competitors||[]).length>0&&<div style={{marginTop:16}}>
        <div style={{fontSize:10,color:C.gold,letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:8}}>UK-Active Competitors</div>
        {data.competitors.map((comp,i)=><div key={i} style={{padding:"8px 12px",background:C.bg,borderRadius:6,marginBottom:6}}>
          <span style={{fontWeight:600,color:C.text}}>{comp.name}</span>
          <span style={{color:C.muted,fontSize:12}}> — {comp.description}</span>
        </div>)}
      </div>}
      {isV&&(data.revenueModels||[]).length>0&&<div style={{marginTop:14}}>
        <div style={{fontSize:10,color:C.gold,letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:8}}>Revenue Models</div>
        {data.revenueModels.map((m,i)=><div key={i} style={{fontSize:12,color:C.text,marginBottom:5}}>£ {m}</div>)}
      </div>}
    </div>}
  </div>;
}

const AGENT_KEYS=["desirability","feasibility","viability"];
const hasAllScores=r=>AGENT_KEYS.every(k=>typeof r?.[k]?.score==="number");

function SummaryPanel({results}) {
  const avg=Math.round(((results.desirability?.score??0)+(results.feasibility?.score??0)+(results.viability?.score??0))/3);
  const verdict=avg>=8?{label:"STRONG SIGNAL",color:C.des}:avg>=6?{label:"PROMISING",color:C.gold}:avg>=4?{label:"NEEDS WORK",color:C.via}:{label:"RECONSIDER",color:C.danger};
  const steps=[
    results.desirability?.score<7&&"Run 6–8 customer discovery interviews with UK energy users matching the persona — focus on validating the unmet need.",
    results.feasibility?.score<7&&"Commission a technical spike with a UK-based energy engineer or academic to address the key feasibility blockers identified.",
    results.viability?.score<7&&"Map the UK competitor landscape in detail and identify a defensible white-space positioning before commercial development.",
    results.desirability?.score>=7&&"Strong desirability signal — move quickly to a low-fidelity prototype and run usability testing with UK energy customers.",
    results.feasibility?.score>=7&&"Technology path looks viable — scope an MVP sprint and identify Ofgem or DESNZ funding mechanisms to accelerate delivery.",
    results.viability?.score>=7&&"UK market opportunity confirmed — define a go-to-market hypothesis targeting the highest-value UK segment and begin commercial outreach.",
  ].filter(Boolean).slice(0,3);
  return <div style={{background:C.surface,border:`1px solid ${verdict.color}55`,borderRadius:10,padding:26,marginTop:20}}>
    <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:22}}>
      <div style={{width:60,height:60,borderRadius:"50%",background:verdict.color+"22",border:`2px solid ${verdict.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:verdict.color,fontFamily:"'IBM Plex Mono',monospace"}}>{avg}</div>
      <div>
        <div style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace"}}>Overall Verdict</div>
        <div style={{fontSize:22,fontWeight:700,color:verdict.color}}>{verdict.label}</div>
      </div>
    </div>
    <div style={{display:"flex",gap:10,marginBottom:22,flexWrap:"wrap"}}>
      {[{k:"desirability",label:"Desirability",color:C.des},{k:"feasibility",label:"Feasibility",color:C.feas},{k:"viability",label:"Viability",color:C.via}].map(a=>(
        <div key={a.k} style={{flex:1,minWidth:100,padding:"12px 14px",background:C.raised,borderRadius:8,textAlign:"center",border:`1px solid ${a.color}33`}}>
          <div style={{fontSize:22,fontWeight:700,color:a.color,fontFamily:"'IBM Plex Mono',monospace"}}>{results[a.k]?.score??"-"}</div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginTop:2}}>{a.label}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:4,lineHeight:1.4}}>{results[a.k]?.scoreRationale}</div>
        </div>
      ))}
    </div>
    <div style={{fontSize:10,color:C.accent,letterSpacing:2,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:12}}>Recommended Next Steps</div>
    {steps.map((s,i)=><div key={i} style={{display:"flex",gap:12,padding:"12px 14px",background:C.bg,borderRadius:8,marginBottom:8,borderLeft:`3px solid ${C.accent}`}}>
      <span style={{color:C.accent,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",minWidth:18}}>{i+1}.</span>
      <span style={{fontSize:13,color:C.text,lineHeight:1.6}}>{s}</span>
    </div>)}
  </div>;
}

const PAD=48,W=600,H=400,PLOT_W=W-PAD*2,PLOT_H=H-PAD*2;
const toX=s=>PAD+(s/10)*PLOT_W,toY=s=>PAD+PLOT_H-(s/10)*PLOT_H,toR=s=>12+(s/10)*22;

function shortLabel(entry) {
  const text=entry.summary||entry.idea||"";
  return text.replace(/[^a-zA-Z ]/g," ").split(/\s+/).filter(Boolean).slice(0,3).join(" ");
}

function IdeaMatrix({library,onView}) {
  const [tooltip,setTooltip]=useState(null);
  // Hovering a node sets state and re-renders the whole SVG. Without this memo
  // every hover re-filtered the library and re-ran the label regex per entry.
  const nodes=useMemo(()=>library
    .filter(e=>e.results?.desirability?.score!=null&&e.results?.feasibility?.score!=null&&e.results?.viability?.score!=null)
    .map(entry=>{
      const des=entry.results.desirability.score,feas=entry.results.feasibility.score,via=entry.results.viability.score;
      return {
        entry, des, feas, via,
        cx:toX(des), cy:toY(feas), r:toR(via),
        words:shortLabel(entry).split(" "),
        color:(des>=5&&feas>=5)?"#FE5716":(des<5&&feas>=5)?"#1089FF":(des>=5&&feas<5)?"#7a849e":"#e03030",
      };
    }),[library]);
  if (nodes.length===0) return null;
  return <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"24px 24px 16px",marginBottom:28}}>
    <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4}}>Innovation Portfolio Matrix</div>
    <div style={{fontSize:12,color:C.muted,marginBottom:16}}>X axis: Desirability · Y axis: Feasibility · Circle size: Viability</div>
    <div style={{overflowX:"auto"}}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{display:"block",maxWidth:"100%"}}>
        <rect x={PAD} y={PAD} width={PLOT_W/2} height={PLOT_H/2} fill="#1089FF08"/>
        <rect x={PAD+PLOT_W/2} y={PAD} width={PLOT_W/2} height={PLOT_H/2} fill="#FE571608"/>
        <rect x={PAD} y={PAD+PLOT_H/2} width={PLOT_W/2} height={PLOT_H/2} fill="#e0303008"/>
        <rect x={PAD+PLOT_W/2} y={PAD+PLOT_H/2} width={PLOT_W/2} height={PLOT_H/2} fill="#7a849e08"/>
        <text x={PAD+8} y={PAD+16} fontSize={9} fill="#1089FF" opacity={0.7} fontFamily="IBM Plex Mono,monospace">HIGH FEASIBILITY / LOW DESIRABILITY</text>
        <text x={PAD+PLOT_W/2+8} y={PAD+16} fontSize={9} fill="#FE5716" opacity={0.8} fontFamily="IBM Plex Mono,monospace" fontWeight="700">★ SWEET SPOT</text>
        <text x={PAD+8} y={PAD+PLOT_H/2+16} fontSize={9} fill="#e03030" opacity={0.6} fontFamily="IBM Plex Mono,monospace">LOW FEASIBILITY / LOW DESIRABILITY</text>
        <text x={PAD+PLOT_W/2+8} y={PAD+PLOT_H/2+16} fontSize={9} fill="#7a849e" opacity={0.7} fontFamily="IBM Plex Mono,monospace">LOW FEASIBILITY / HIGH DESIRABILITY</text>
        <rect x={PAD} y={PAD} width={PLOT_W} height={PLOT_H} fill="none" stroke={C.border} strokeWidth={1.5}/>
        <line x1={PAD+PLOT_W/2} y1={PAD} x2={PAD+PLOT_W/2} y2={PAD+PLOT_H} stroke={C.border} strokeWidth={1} strokeDasharray="4 4"/>
        <line x1={PAD} y1={PAD+PLOT_H/2} x2={PAD+PLOT_W} y2={PAD+PLOT_H/2} stroke={C.border} strokeWidth={1} strokeDasharray="4 4"/>
        {[0,2,4,6,8,10].map(v=><g key={v}>
          <text x={toX(v)} y={PAD+PLOT_H+16} textAnchor="middle" fontSize={10} fill={C.muted} fontFamily="IBM Plex Mono,monospace">{v}</text>
          <text x={PAD-10} y={toY(v)+4} textAnchor="end" fontSize={10} fill={C.muted} fontFamily="IBM Plex Mono,monospace">{v}</text>
        </g>)}
        <text x={PAD+PLOT_W/2} y={H-4} textAnchor="middle" fontSize={11} fill={C.text} fontWeight="600" fontFamily="Sora,sans-serif">Desirability →</text>
        <text x={12} y={PAD+PLOT_H/2} textAnchor="middle" fontSize={11} fill={C.text} fontWeight="600" fontFamily="Sora,sans-serif" transform={`rotate(-90,12,${PAD+PLOT_H/2})`}>Feasibility →</text>
        {nodes.map(({entry,des,feas,via,cx,cy,r,words,color})=>{
          const isHovered=tooltip?.id===entry.id;
          return <g key={entry.id} style={{cursor:"pointer"}} onClick={()=>onView(entry)} onMouseEnter={()=>setTooltip({id:entry.id,cx,cy,r,label:entry.summary||entry.idea,des,feas,via})} onMouseLeave={()=>setTooltip(null)}>
            <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={isHovered?0.9:0.18} stroke={color} strokeWidth={isHovered?2.5:1.5} style={{transition:"all 0.2s"}}/>
            {words.map((word,wi)=><text key={wi} x={cx} y={cy+(wi-(words.length-1)/2)*11} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight="600" fill={color} fontFamily="Sora,sans-serif" style={{pointerEvents:"none"}}>{word}</text>)}
          </g>;
        })}
        {tooltip&&(()=>{
          const TW=180,TH=72;let tx=tooltip.cx+tooltip.r+8,ty=tooltip.cy-TH/2;
          if (tx+TW>W) tx=tooltip.cx-tooltip.r-TW-8;
          if (ty<PAD) ty=PAD;if (ty+TH>H-8) ty=H-TH-8;
          return <g style={{pointerEvents:"none"}}>
            <rect x={tx} y={ty} width={TW} height={TH} rx={6} fill="#ffffff" stroke={C.border} strokeWidth={1}/>
            <foreignObject x={tx+10} y={ty+8} width={TW-20} height={TH-16}>
              <div xmlns="http://www.w3.org/1999/xhtml" style={{fontSize:11,color:"#0f1623",lineHeight:1.4,fontFamily:"Sora,sans-serif"}}>
                <div style={{fontWeight:700,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tooltip.label?.slice(0,40)}{tooltip.label?.length>40?"…":""}</div>
                <div style={{color:"#7a849e",fontSize:10}}>D: {tooltip.des} · F: {tooltip.feas} · V: {tooltip.via}</div>
              </div>
            </foreignObject>
          </g>;
        })()}
      </svg>
    </div>
  </div>;
}

// Intl formatters are expensive to construct; build once, not per card render.
const shortDate=new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"});
const longDate=new Intl.DateTimeFormat("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

function LibraryCard({entry,onView}) {
  const avg=entry.results?Math.round(((entry.results.desirability?.score??0)+(entry.results.feasibility?.score??0)+(entry.results.viability?.score??0))/3):null;
  const verdict=avg>=8?{label:"Strong",color:C.des}:avg>=6?{label:"Promising",color:C.gold}:avg>=4?{label:"Needs work",color:C.via}:{label:"Reconsider",color:C.danger};
  return <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"14px 18px",marginBottom:10,display:"flex",alignItems:"center",gap:14}}>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{entry.summary||entry.idea?.slice(0,80)+"…"}</div>
      <div style={{fontSize:11,color:C.muted,marginTop:3}}>{shortDate.format(new Date(entry.savedAt))}</div>
    </div>
    {avg!==null&&<div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
      <Chip label={verdict.label} color={verdict.color}/>
      <div style={{fontSize:15,fontWeight:700,color:verdict.color,fontFamily:"'IBM Plex Mono',monospace"}}>{avg}/10</div>
    </div>}
    <button onClick={()=>onView(entry)} style={{background:C.accent+"22",border:`1px solid ${C.accent}44`,color:C.accent,borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",flexShrink:0}}>View →</button>
  </div>;
}

// Hoisted to module scope: these are constant, so re-allocating them on every
// App render only created garbage and broke referential equality for children.
const btn={padding:"12px 26px",background:C.accent,color:C.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",letterSpacing:1,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace"};
const btnG={padding:"10px 20px",background:"transparent",color:C.muted,border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"};
const card={background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:28,marginBottom:24};
const lbl={fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",fontFamily:"'IBM Plex Mono',monospace",marginBottom:8,display:"block"};
const inp={width:"100%",background:C.raised,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 16px",color:C.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Sora,sans-serif"};
const ta={...inp,resize:"vertical",minHeight:110};

const EDF_LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 32'%3E%3Crect width='80' height='32' rx='4' fill='%23FE5716'/%3E%3Ctext x='40' y='22' text-anchor='middle' font-family='Arial,sans-serif' font-weight='700' font-size='14' fill='white'%3EEDF%3C/text%3E%3C/svg%3E";

export default function App() {
  const [nav,setNav]=useState("home");
  const [stage,setStage]=useState("idea");
  const [idea,setIdea]=useState("");
  const [questions,setQuestions]=useState([]);
  const [ideaSummary,setIdeaSummary]=useState("");
  const [inScope,setInScope]=useState(true);
  const [scopeNote,setScopeNote]=useState("");
  const [answers,setAnswers]=useState({});
  const [loading,setLoading]=useState(false);
  const [agentLoad,setAgentLoad]=useState({});
  const [results,setResults]=useState({});
  const [allDone,setAllDone]=useState(false);
  const [error,setError]=useState("");
  const [library,setLibrary]=useState([]);
  const [viewing,setViewing]=useState(null);

  useEffect(()=>{
    if (nav==="library") {
      try {
        const stored=JSON.parse(localStorage.getItem("edf_ideas")||"[]");
        setLibrary(stored);
      } catch(_) { setLibrary([]); }
    }
  },[nav]);

  const saveIdea=(entry)=>{
    try {
      const stored=JSON.parse(localStorage.getItem("edf_ideas")||"[]");
      localStorage.setItem("edf_ideas",JSON.stringify([entry,...stored]));
    } catch(_) {}
  };

  const reset=()=>{ setStage("idea");setIdea("");setQuestions([]);setIdeaSummary("");setAnswers({});setResults({});setAllDone(false);setError("");setInScope(true);setScopeNote("");setViewing(null); };
  const goNew=()=>{ reset();setNav("new"); };

  const submitIdea=async()=>{
    if (!idea.trim()) return;
    setLoading(true);setError("");
    try {
      const r=await callClaude(AGENTS.clarification.system,`UK energy innovation idea: ${idea}`);
      setQuestions(r.questions||[]);setIdeaSummary(r.summary||"");
      setInScope(r.inScope!==false);setScopeNote(r.scopeNote||"");
      setStage("clarify");
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const runAnalysis=async()=>{
    setStage("analysing");
    setAllDone(false);setError("");setResults({});
    const ctx=`UK Energy Innovation Idea: ${idea}\n\nSummary: ${ideaSummary}\n\nClarifications:\n${questions.map((q,i)=>`Q: ${q}\nA: ${answers[i]||"(not answered)"}`).join("\n\n")}`;
    const final={};
    await Promise.all(["desirability","feasibility","viability"].map(async k=>{
      setAgentLoad(p=>({...p,[k]:true}));
      try {
        const r=await callClaude(AGENTS[k].system,ctx);
        final[k]=r;setResults(p=>({...p,[k]:r}));
      } catch(e) {
        // Record the failure as a failure. Previously this stored a score of
        // 0, which was then saved to the library and plotted on the matrix as
        // though the idea had genuinely scored zero.
        const fb={error:e.message};
        final[k]=fb;setResults(p=>({...p,[k]:fb}));
      }
      setAgentLoad(p=>({...p,[k]:false}));
    }));
    setAllDone(true);

    const failed=["desirability","feasibility","viability"].filter(k=>final[k]?.error);
    if (failed.length) {
      // Don't persist a partial analysis — it would pollute the library and
      // the portfolio matrix with an idea that was never fully assessed.
      setError(`${failed.map(k=>AGENTS[k].label).join(" and ")} did not complete, so nothing was saved to your library. Retry to finish the analysis.`);
      return;
    }
    const entry={id:Date.now().toString(),idea,summary:ideaSummary,questions,answers,results:final,savedAt:new Date().toISOString()};
    saveIdea(entry);
  };

  return <>
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"Sora,sans-serif"}}>
      <nav style={{background:"#ffffff",borderBottom:`1px solid ${C.border}`,padding:"0 28px",display:"flex",alignItems:"center",height:54,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginRight:30,flexShrink:0}}>
          <img src={EDF_LOGO} alt="EDF" style={{height:26,width:"auto"}}/>
          <span style={{fontSize:13,fontWeight:600,color:"#0f1623",fontFamily:"Sora,sans-serif"}}>Innovation Sense-Checker</span>
        </div>
        {[["home","Home"],["new","+ New Idea"],["library","Idea Library"]].map(([k,l])=>(
          <button key={k} onClick={()=>k==="new"?goNew():setNav(k)} style={{padding:"0 16px",height:54,border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:500,color:nav===k?C.accent:C.muted,borderBottom:nav===k?`2px solid ${C.accent}`:"2px solid transparent",fontFamily:"Sora,sans-serif",transition:"color 0.2s"}}>{l}</button>
        ))}
        <div style={{flex:1}}/>
        <div style={{fontSize:10,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>EDF · DFV Analysis</div>
      </nav>

      <div style={{maxWidth:760,margin:"0 auto",padding:"40px 20px"}}>

        {nav==="home"&&<div>
          <div style={{textAlign:"center",padding:"40px 0 48px"}}>
            <img src={EDF_LOGO} alt="EDF" style={{height:48,width:"auto",marginBottom:20}}/>
            <h1 style={{fontSize:34,fontWeight:700,color:C.text,letterSpacing:-0.5,marginBottom:12}}>Innovation Sense-Checker</h1>
            <p style={{fontSize:14,color:C.muted,maxWidth:520,margin:"0 auto 32px",lineHeight:1.8}}>Purpose-built for the UK energy industry. Submit an idea in power generation, distribution, retail or adjacent energy services and receive a structured DFV analysis grounded in UK regulation, culture, and £-denominated market data.</p>
            <button style={btn} onClick={goNew}>Submit an Idea →</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
            {[
              {color:C.des,icon:"◈",title:"Desirability",desc:"UK customer persona analysis grounded in British energy demographics, Ofgem price cap context, and net zero attitudes."},
              {color:C.feas,icon:"◉",title:"Feasibility",desc:"Technical readiness assessed against UK grid infrastructure, Ofgem/DESNZ frameworks, and real UK programme funding."},
              {color:C.via,icon:"◑",title:"Viability",desc:"Market sizing in £ with UK-active competitor mapping, commercial model assessment, and energy sector revenue models."},
            ].map(a=><div key={a.title} style={{background:C.surface,border:`1px solid ${a.color}33`,borderRadius:10,padding:20}}>
              <div style={{fontSize:22,color:a.color,marginBottom:8}}>{a.icon}</div>
              <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:6}}>{a.title}</div>
              <div style={{fontSize:13,color:C.muted,lineHeight:1.7}}>{a.desc}</div>
            </div>)}
          </div>
        </div>}

        {nav==="new"&&<div>
          {stage==="idea"&&<>
            <h1 style={{fontSize:28,fontWeight:700,color:C.text,marginBottom:8}}>Submit Your Idea</h1>
            <p style={{fontSize:14,color:C.muted,marginBottom:28,lineHeight:1.7}}>Describe your UK energy innovation. Focus on power generation, distribution, retail, flexibility, or closely adjacent services.</p>
            <div style={card}>
              <label style={lbl}>Idea Description</label>
              <textarea style={ta} placeholder="e.g. A platform that aggregates flexibility from domestic heat pumps and EV chargers across UK housing estates, trading them into the Balancing Mechanism via a licensed aggregator..." value={idea} onChange={e=>setIdea(e.target.value)}/>
              {error&&<div style={{color:C.danger,fontSize:13,marginTop:8}}>{error}</div>}
              <div style={{marginTop:16,display:"flex",gap:12}}>
                <button style={{...btn,opacity:loading?0.6:1}} onClick={submitIdea} disabled={loading}>{loading?"Reviewing…":"Next: Clarify →"}</button>
              </div>
            </div>
          </>}

          {stage==="clarify"&&<>
            <div style={{...card,borderColor:C.accent+"44",marginBottom:24}}>
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <span style={{fontSize:20,color:C.accent}}>◎</span>
                <div>
                  <Chip label="Clarification Agent" color={C.accent}/>
                  <div style={{fontSize:15,color:C.text,marginTop:8,lineHeight:1.6}}>{ideaSummary}</div>
                  {!inScope&&<div style={{marginTop:10,padding:"10px 14px",background:C.danger+"22",borderRadius:6,fontSize:13,color:C.danger,borderLeft:`3px solid ${C.danger}`}}>⚠ Scope note: {scopeNote}</div>}
                </div>
              </div>
            </div>
            <p style={{fontSize:14,color:C.muted,marginBottom:22,lineHeight:1.7}}>Answer these questions to sharpen the analysis. Skip any that don't apply.</p>
            {questions.map((q,i)=><div key={i} style={{marginBottom:20}}>
              <label style={lbl}>Question {i+1}</label>
              <p style={{fontSize:14,color:C.text,marginBottom:10,lineHeight:1.6}}>{q}</p>
              <textarea style={{...ta,minHeight:80}} placeholder="Your answer (optional)…" value={answers[i]||""} onChange={e=>setAnswers(p=>({...p,[i]:e.target.value}))}/>
            </div>)}
            <div style={{display:"flex",gap:12}}>
              <button style={btn} onClick={runAnalysis}>Run Full Analysis →</button>
              <button style={btnG} onClick={()=>setStage("idea")}>← Back</button>
            </div>
          </>}

          {(stage==="analysing"||stage==="done")&&<>
            <div style={{...card,marginBottom:20}}>
              <Chip label="Analysing" color={C.accent}/>
              <div style={{fontSize:14,color:C.text,marginTop:10,lineHeight:1.6}}>{ideaSummary||idea}</div>
            </div>
            {["desirability","feasibility","viability"].map(k=><AgentCard key={k} agentKey={k} data={results[k]} loading={agentLoad[k]}/>)}
            {allDone&&error&&<div style={{...card,borderColor:C.danger+"55",background:C.danger+"11",marginTop:20,marginBottom:0}}>
              <Chip label="Analysis incomplete" color={C.danger}/>
              <div style={{fontSize:14,color:C.text,marginTop:10,lineHeight:1.7}}>{error}</div>
            </div>}
            {/* Only summarise when all three produced a real score. */}
            {allDone&&!error&&hasAllScores(results)&&<SummaryPanel results={results}/>}
            {allDone&&<div style={{marginTop:24,display:"flex",gap:12,flexWrap:"wrap"}}>
              {error&&<button style={btn} onClick={runAnalysis}>↻ Retry Analysis</button>}
              <button style={error?btnG:btn} onClick={goNew}>+ Analyse Another Idea</button>
              <button style={btnG} onClick={()=>{setNav("library");setViewing(null);}}>View Idea Library →</button>
            </div>}
          </>}
        </div>}

        {nav==="library"&&!viewing&&<div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <div>
              <h1 style={{fontSize:28,fontWeight:700,color:C.text,marginBottom:4}}>Idea Library</h1>
              <p style={{fontSize:13,color:C.muted}}>All previously analysed UK energy ideas, saved in this browser.</p>
            </div>
            <button style={btn} onClick={goNew}>+ New Idea</button>
          </div>
          {library.length>0&&<IdeaMatrix library={library} onView={e=>setViewing(e)}/>}
          {library.length===0&&<div style={{...card,textAlign:"center",padding:48}}>
            <div style={{fontSize:30,marginBottom:12}}>💡</div>
            <div style={{fontSize:16,color:C.text,marginBottom:8}}>No ideas saved yet</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>Submit and analyse your first UK energy idea — it'll appear here automatically.</div>
            <button style={btn} onClick={goNew}>Submit First Idea →</button>
          </div>}
          {library.map(entry=><LibraryCard key={entry.id} entry={entry} onView={e=>setViewing(e)}/>)}
        </div>}

        {nav==="library"&&viewing&&<div>
          <button style={{...btnG,marginBottom:24}} onClick={()=>setViewing(null)}>← Back to Library</button>
          <div style={{...card,marginBottom:20}}>
            <Chip label="Saved Analysis" color={C.gold}/>
            <div style={{fontSize:15,color:C.text,marginTop:10,lineHeight:1.6}}>{viewing.summary||viewing.idea}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:6}}>Saved {longDate.format(new Date(viewing.savedAt))}</div>
          </div>
          {["desirability","feasibility","viability"].map(k=><AgentCard key={k} agentKey={k} data={viewing.results?.[k]} loading={false}/>)}
          {hasAllScores(viewing.results)&&<SummaryPanel results={viewing.results}/>}
        </div>}

      </div>
    </div>
  </>;
}
