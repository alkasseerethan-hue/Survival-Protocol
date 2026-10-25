const CHARACTERS = ["Leon S. Kennedy","Chris Redfield","Jill Valentine","Ada Wong","Claire Redfield","Sherry Birkin","Rebecca Chambers","Ethan Winters","Barry Burton","Luis Sera","Albert Wesker","HUNK","Jack Krauser","Alcina Dimitrescu","Jack Baker","Karl Heisenberg","Oswell E. Spencer","Ramón Salazar","Zeno"];
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Content-Type":"application/json; charset=utf-8"};
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:CORS});
const redirect = url=>Response.redirect(url,302);

export default { async fetch(request,env) {
 const url=new URL(request.url);
 if(request.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
 if(url.pathname==="/"&&request.method==="GET") return json({status:"Survival Protocol backend is online"});
 if(url.pathname==="/auth"&&request.method==="GET") {
  const state=crypto.randomUUID();
  await env.VOTES_KV.put(`oauthstate:${state}`,"1",{expirationTtl:600});
  const g=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  g.searchParams.set("client_id",env.GOOGLE_CLIENT_ID);
  g.searchParams.set("redirect_uri",env.REDIRECT_URI);
  g.searchParams.set("response_type","code");
  g.searchParams.set("scope","https://www.googleapis.com/auth/youtube.readonly openid");
  g.searchParams.set("state",state);
  g.searchParams.set("prompt","select_account");
  g.searchParams.set("access_type","online");
  return redirect(g.toString());
 }
 if(url.pathname==="/oauth2callback"&&request.method==="GET") {
  const code=url.searchParams.get("code"),state=url.searchParams.get("state");
  if(!code||!state||!await env.VOTES_KV.get(`oauthstate:${state}`)) return redirect(`${env.FRONTEND_URL}/?youtube=error`);
  await env.VOTES_KV.delete(`oauthstate:${state}`);
  const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:env.REDIRECT_URI,grant_type:"authorization_code"})});
  const td=await tr.json();
  if(!tr.ok||!td.access_token) return redirect(`${env.FRONTEND_URL}/?youtube=error`);
  const yu=new URL("https://www.googleapis.com/youtube/v3/subscriptions");
  yu.searchParams.set("part","id");yu.searchParams.set("mine","true");yu.searchParams.set("forChannelId",env.YOUTUBE_CHANNEL_ID);yu.searchParams.set("maxResults","1");
  const yr=await fetch(yu,{headers:{Authorization:`Bearer ${td.access_token}`}});
  const yd=await yr.json();
  if(!yr.ok) return redirect(`${env.FRONTEND_URL}/?youtube=error`);
  if(!Array.isArray(yd.items)||!yd.items.length) return redirect(`${env.FRONTEND_URL}/?youtube=not_subscribed`);
  const session=crypto.randomUUID();
  await env.VOTES_KV.put(`session:${session}`,JSON.stringify({verified:true}),{expirationTtl:3600});
  return redirect(`${env.FRONTEND_URL}/?youtube=verified&session=${encodeURIComponent(session)}`);
 }
 if(url.pathname==="/votes"&&request.method==="GET") {
  const votes={};for(const c of CHARACTERS)votes[c]=Number(await env.VOTES_KV.get(`vote:${c}`)||0);return json(votes);
 }
 if(url.pathname==="/vote"&&request.method==="POST") {
  const a=request.headers.get("Authorization")||"",s=a.startsWith("Bearer ")?a.slice(7):"";
  if(!s||!await env.VOTES_KV.get(`session:${s}`))return json({success:false,error:"YouTube verification required"},401);
  let b;try{b=await request.json()}catch{return json({success:false,error:"Invalid JSON"},400)}
  if(!CHARACTERS.includes(b.character))return json({success:false,error:"Invalid character"},400);
  const k=`vote:${b.character}`,n=Number(await env.VOTES_KV.get(k)||0)+1;
  await env.VOTES_KV.put(k,String(n));await env.VOTES_KV.delete(`session:${s}`);
  return json({success:true,character:b.character,votes:n});
 }
 return json({error:"Not found"},404);
}};
