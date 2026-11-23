const API='https://v3.football.api-sports.io';
const headers=()=>({'x-apisports-key':process.env.API_FOOTBALL_KEY||''});
async function get(path,params={}){const u=new URL(API+path);Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,v)});const r=await fetch(u,{headers:headers()});const j=await r.json();if(!r.ok||j.errors&&Object.keys(j.errors).length)throw new Error(JSON.stringify(j.errors||j.message||'API request failed'));return j.response||[]}
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const pct=(hits,total)=>total?Math.round(hits/total*100):null;
async function teamLast(team,season){try{return await get('/fixtures',{team,last:5,season})}catch{return []}}
async function statsFor(fixture){try{return await get('/fixtures/statistics',{fixture})}catch{return []}}
function statValue(list,name){let x=list?.statistics?.find(s=>String(s.type).toLowerCase()===name.toLowerCase());let n=Number(String(x?.value??'').replace('%',''));return Number.isFinite(n)?n:null}
async function detail(id,home,away,league,season){
 const [pred,matchStats,homeLast,awayLast,h2h,standings,injuries]=await Promise.all([
  get('/predictions',{fixture:id}).catch(()=>[]),statsFor(id),teamLast(home,season),teamLast(away,season),
  get('/fixtures/headtohead',{h2h:`${home}-${away}`,last:5}).catch(()=>[]),
  get('/standings',{league,season}).catch(()=>[]),get('/injuries',{fixture:id}).catch(()=>[])
 ]);
 const p=pred[0]||{};
 const sections=[];
 const recentRows=[];
 for(let i=0;i<Math.max(homeLast.length,awayLast.length);i++){let a=homeLast[i],b=awayLast[i];if(a)recentRows.push({label:`Home recent ${i+1}`,home:a.teams.home.name,away:`${a.goals.home}-${a.goals.away} ${a.teams.away.name}`});if(b)recentRows.push({label:`Away recent ${i+1}`,home:b.teams.home.name,away:`${b.goals.home}-${b.goals.away} ${b.teams.away.name}`})}
 sections.push({rows:recentRows});
 sections.push({rows:h2h.map(x=>({label:new Date(x.fixture.date).toLocaleDateString(),home:x.teams.home.name,away:`${x.goals.home}-${x.goals.away} ${x.teams.away.name}`}))});
 sections.push({rows:matchStats.flatMap(t=>t.statistics||[]).filter(x=>/goals/i.test(x.type)).map(x=>({label:x.type,home:x.value,away:''}))});
 sections.push({rows:matchStats.flatMap(t=>t.statistics||[]).filter(x=>/corner/i.test(x.type)).map(x=>({label:x.type,home:x.value,away:''}))});
 sections.push({rows:[{label:'Recent home fixtures',home:homeLast.length,away:'Home team'},{label:'Recent away fixtures',home:awayLast.length,away:'Away team'}]});
 const table=standings[0]?.league?.standings?.[0]||[];sections.push({rows:table.slice(0,10).map(t=>({label:`#${t.rank} ${t.team.name}`,home:`${t.points} pts`,away:`${t.all.played} played`}))});
 sections.push({rows:injuries.map(x=>({label:x.player?.name||'Player',home:x.team?.name||'',away:x.player?.type||x.player?.reason||'Unavailable'}))});
 sections.push({rows:[]});
 return {predictions:p,stats:{},sections};
}
exports.handler=async(event)=>{
 try{
  if(!process.env.API_FOOTBALL_KEY)return {statusCode:500,body:JSON.stringify({message:'API_FOOTBALL_KEY is missing in Netlify environment variables.'})};
  const q=event.queryStringParameters||{};
  if(q.fixture){const d=await detail(q.fixture,q.home,q.away,q.league,q.season);return {statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify(d)}}
  let response;
  if(q.live==='all')response=await get('/fixtures',{live:'all'});
  else if(q.date)response=await get('/fixtures',{date:q.date});
  else return {statusCode:400,body:JSON.stringify({message:'Provide date, live=all, or fixture.'})};
  const major=new Set([39,140,135,78,61,2,3,848,45,143,88,94,253,262,71,72,128,239,307,556]);
  response=response.filter(f=>major.has(Number(f.league?.id)));
  response.sort((a,b)=>(major.has(a.league?.id)?0:1)-(major.has(b.league?.id)?0:1)||new Date(a.fixture.date)-new Date(b.fixture.date));
  return {statusCode:200,headers:{'content-type':'application/json','cache-control':'public, max-age=60'},body:JSON.stringify({response:response.slice(0,15)})};
 }catch(e){return {statusCode:502,headers:{'content-type':'application/json'},body:JSON.stringify({message:e.message||'Football data provider error'})}}
};