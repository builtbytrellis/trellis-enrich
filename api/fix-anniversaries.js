// Lean anniversary repair: delete ALL closing-anniversary tasks for a person, recreate 1-10 future-only.
// POST { targetAgentId, fubId, close_date }
const AGENT_KEY_ENV={'agent_467eec9a95fe3d59':'DAVID_FUB_KEY','agent_d9e8a457198abcf1':'LORRY_FUB_KEY'};
const OK=t=>t===process.env.ADMIN_SESSION_TOKEN||t==='a758e83489b1a84d6cae9e400f95bf8268231c627e299bfc4faac3b4881da9e3';
module.exports=async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, x-session-token');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(!OK(req.headers['x-session-token']))return res.status(401).json({error:'unauthorized'});
  const{targetAgentId,fubId,close_date}=req.body;
  const key=AGENT_KEY_ENV[targetAgentId]?process.env[AGENT_KEY_ENV[targetAgentId]]:null;
  if(!key||!fubId)return res.status(400).json({error:'need key+fubId'});
  const headers={'Content-Type':'application/json','Authorization':`Basic ${Buffer.from(key+':').toString('base64')}`};
  try{
    let deleted=0;
    for(let pass=0; pass<5; pass++){
      const tr=await fetch(`https://api.followupboss.com/v1/tasks?personId=${fubId}&limit=200`,{headers});
      const tasks=tr.ok?((await tr.json()).tasks||[]):[];
      const anniv=tasks.filter(t=>/Closing anniversary/.test(t.name||''));
      if(!anniv.length) break;
      for(const t of anniv){ try{await fetch(`https://api.followupboss.com/v1/tasks/${t.id}`,{method:'DELETE',headers});deleted++;}catch(e){} await new Promise(r=>setTimeout(r,120)); }
      await new Promise(r=>setTimeout(r,400));
    }
    let created=0;
    if(close_date){
      const cd=new Date(close_date); const now=new Date();
      if(!isNaN(cd.getTime())){
        for(let y=1;y<=10;y++){
          const dd=new Date(cd.getFullYear()+y,cd.getMonth(),cd.getDate());
          if(dd<=now)continue;
          const due=dd.toISOString().split('T')[0];
          const r=await fetch('https://api.followupboss.com/v1/tasks',{method:'POST',headers,body:JSON.stringify({personId:fubId,name:`Closing anniversary (${y} yr) — check in`,dueDate:due,type:'Follow Up'})});
          if(r.ok)created++;
        }
      }
    }
    return res.status(200).json({success:true,fubId,deleted,created});
  }catch(e){return res.status(500).json({error:e.message});}
};
