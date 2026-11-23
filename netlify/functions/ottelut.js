exports.handler = async function (event) {
 const key=process.env.API_FOOTBALL_KEY, headers={"Content-Type":"application/json","Cache-Control":"public, max-age=45"};
 if(!key)return{statusCode:500,headers,body:JSON.stringify({error:"API_FOOTBALL_KEY is not configured in Netlify."})};
 const p=event.queryStringParameters||{},action=p.action||"fixtures";let path;
 if(action==="predictions"||action==="statistics"){if(!p.fixture||!/^\d+$/.test(p.fixture))return{statusCode:400,headers,body:JSON.stringify({error:"A valid fixture ID is required."})};path=`/${action}?fixture=${encodeURIComponent(p.fixture)}`}
 else{if(!p.date||!/^\d{4}-\d{2}-\d{2}$/.test(p.date))return{statusCode:400,headers,body:JSON.stringify({error:"Please provide date as YYYY-MM-DD."})};path=`/fixtures?date=${encodeURIComponent(p.date)}`}
 try{const r=await fetch("https://v3.football.api-sports.io"+path,{headers:{"x-apisports-key":key}});return{statusCode:r.status,headers,body:JSON.stringify(await r.json())}}
 catch(e){return{statusCode:502,headers,body:JSON.stringify({error:"Unable to fetch match data from API-Football."})}}
};