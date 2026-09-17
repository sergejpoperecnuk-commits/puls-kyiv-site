const SOURCES=[{id:"wm",title:"monitor",user:"war_monitor",cat:"Тривога",initials:"MO"},{id:"kn",title:"Київське небо",user:"kyiv_nebo",cat:"Тривога",initials:"КН"},{id:"pp",title:"ППО Київ",user:"ppo_kiev",cat:"Тривога",initials:"ПП"},{id:"pt",title:"Повітряна тривога Київ",user:"airAlarm_Kyiv",cat:"Тривога",initials:"ПТ"},{id:"ki",title:"Київ ІНФО",user:"kievinform_ua1",cat:"Тривога",initials:"КІ"},{id:"mw",title:"monitorwar",user:"monitoringwar",cat:"Тривога",initials:"MW"},{id:"ka",title:"Київ Моніторинг",user:"KyivAlarm",cat:"Тривога",initials:"КА"},{id:"va",title:"КМВА",user:"VA_Kyiv",cat:"Офіційне",initials:"ВА"},{id:"od",title:"Київська ОВА",user:"kyivoda",cat:"Офіційне",initials:"ОД"}];
const BY_USER=Object.fromEntries(SOURCES.map(s=>[s.user.toLowerCase(),s]));
const NBSP="\u0026nbsp;";
const AMP="\u0026amp;";
function decodeEntities(v){return v.split(NBSP).join(" ").split(AMP).join("&").replace(/<[^>]+>/g,"").trim()}
function parseTelegramHtml(html){
  const blocks=html.split("tgme_widget_message_wrap");
  const posts=[];
  const postRe=new RegExp('data-post="([^"]+)"');
  const timeRe=new RegExp('datetime="([^"]+)"');
  for (const block of blocks){
    const post=block.match(postRe);
    if(!post) continue;
    const parts=post[1].split("/");
    if(parts.length<2) continue;
    const username=parts[0];
    const telegramId=parts[1];
    const source=BY_USER[username.toLowerCase()];
    if(!source) continue;
    const marker="tgme_widget_message_text";
    const i=block.indexOf(marker);
    let text="";
    if(i>=0){
      const start=block.indexOf(">", i);
      const end=block.indexOf("<"+"/div>", start);
      if(start>=0 && end>start) text=decodeEntities(block.slice(start+1,end));
    }
    const timeMatch=block.match(timeRe);
    if(!text||!timeMatch) continue;
    posts.push({id:username+"-"+telegramId,s:source,text,t:new Date(timeMatch[1]).getTime(),url:"https://t.me/"+username+"/"+telegramId});
  }
  return posts;
}
async function scrape(user){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const res=await fetch("https://t.me/s/"+user,{signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0 (compatible; KyivPulse/1.0)",Accept:"text/html"}});
    if(!res.ok) return [];
    return parseTelegramHtml(await res.text());
  }catch(e){return []}finally{clearTimeout(timer)}
}
export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","s-maxage=30, stale-while-revalidate=60");
  const lists=await Promise.all(SOURCES.map(s=>scrape(s.user)));
  const seen=new Set();
  const messages=lists.flat().filter(m=>{if(seen.has(m.id))return false;seen.add(m.id);return true}).sort((a,b)=>b.t-a.t).slice(0,60);
  res.status(200).json({ok:true,at:Date.now(),count:messages.length,messages});
}
