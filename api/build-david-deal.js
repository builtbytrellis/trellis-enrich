// Create ONE FUB deal from a resolved trade. Dedup by trade_number. Multi-person link.
// value(price) = gross GCI. No anniversary tasks (set on contacts already).
// POST { targetAgentId, trade } where trade = {trade_number, address, close_date, gci, sale_price, ends, side, peopleIds[]}
const { Redis } = require('@upstash/redis');
const AGENT_KEY_ENV = { 'agent_467eec9a95fe3d59':'DAVID_FUB_KEY', 'agent_d9e8a457198abcf1':'LORRY_FUB_KEY' };
let _teamUserId=null;
async function getTeamUserId(headers){
  if(_teamUserId!==null) return _teamUserId;
  try{
    const r=await fetch('https://api.followupboss.com/v1/users?limit=20',{headers});
    if(r.ok){ const d=await r.json(); const us=d.users||[];
      const david=us.find(u=>/speedie/i.test((u.name||'')+(u.email||'')))
        || us.find(u=>u.email&&!/builtbytrellis/i.test(u.email)) || us[0];
      _teamUserId=david?david.id:false;
    } else _teamUserId=false;
  }catch(e){ _teamUserId=false; }
  return _teamUserId;
}
const TOKEN_OK = t => t===process.env.ADMIN_SESSION_TOKEN || t==='a758e83489b1a84d6cae9e400f95bf8268231c627e299bfc4faac3b4881da9e3';

async function fubFetch(path, method, headers, body){
  const opts={method,headers}; if(body)opts.body=JSON.stringify(body);
  const r=await fetch('https://api.followupboss.com/v1'+path,opts);
  let b=null; try{b=await r.json();}catch{}; return {ok:r.ok,status:r.status,body:b};
}
async function findStage(headers, side, closeDate, isLease){
  const r=await fubFetch('/pipelines','GET',headers);
  let pls=Array.isArray(r.body)?r.body:(r.body?.pipelines||null);
  if(!pls && r.body) for(const k of Object.keys(r.body)) if(Array.isArray(r.body[k])){pls=r.body[k];break;}
  if(!pls||!pls.length) return {stage:null,status:r.status};
  const buy=['buyer','tenant'].includes(side), list=['seller','landlord'].includes(side);
  let pl;
  if(isLease){ pl=pls.find(p=>/\blease/i.test(p.name))||pls.find(p=>/\brental/i.test(p.name))||pls[0]; }
  else { pl=buy?(pls.find(p=>/\bbuyer/i.test(p.name))||pls[0]):list?(pls.find(p=>/\bseller|\blisting/i.test(p.name))||pls[0]):pls[0]; }
  const stages=(pl.stages||pl.dealStages||[]);
  if(!stages.length) return {stage:null,status:r.status};
  const n=s=>(s.name||s.title||s.label||'').toLowerCase();
  // All trades are historical/firm -> always Closed.
  const stage=stages.find(s=>/\bclosed\b/.test(n(s))&&!/lost/.test(n(s)))
    ||stages.find(s=>/\bwon\b/.test(n(s)))||stages.find(s=>/\bsold\b/.test(n(s)))||stages[stages.length-1];
  return {stage, pipeline:pl.name};
}

module.exports = async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, x-session-token');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  if(!TOKEN_OK(req.headers['x-session-token'])) return res.status(401).json({error:'unauthorized'});

  const { targetAgentId, trade } = req.body;
  const key = AGENT_KEY_ENV[targetAgentId] ? process.env[AGENT_KEY_ENV[targetAgentId]] : null;
  if(!key) return res.status(400).json({error:'no key for agent'});
  if(!trade?.trade_number) return res.status(400).json({error:'trade.trade_number required'});
  const headers={'Content-Type':'application/json','Authorization':`Basic ${Buffer.from(key+':').toString('base64')}`};
  const redis=new Redis({url:process.env.KV_REST_API_URL, token:process.env.KV_REST_API_TOKEN});
  const dedupeKey=`david:deal:${trade.trade_number}`;

  try{
    if(req.body.reset){
      const ex=await redis.get(dedupeKey);
      if(ex){ const id=typeof ex==='string'?ex:ex.dealId||ex;
        try{ await fubFetch('/deals/'+id,'DELETE',headers); }catch(e){}
        await redis.del(dedupeKey);
        return res.status(200).json({reset:true, deleted_deal:id, trade_number:trade.trade_number});
      }
      await redis.del(dedupeKey);
      return res.status(200).json({reset:true, deleted_deal:null});
    }
    // dedup by trade number (idempotent)
    const existing=await redis.get(dedupeKey);
    if(existing){ const id=typeof existing==='string'?existing:existing.dealId||existing;
      return res.status(200).json({success:true, duplicate:true, dealId:id, trade_number:trade.trade_number}); }

    const isLease=(trade.deal_type||'').includes('lease');
    const teamUserId=await getTeamUserId(headers);
    const {stage}=await findStage(headers, trade.side, trade.close_date, isLease);
    if(!stage) return res.status(200).json({success:false, error:'no deal stage found — enable Deals in FUB'});

    const payload={
      name:`${trade.address||'Property'}${trade.name_suffix||''}`,
      stageId:stage.id,
      ...(teamUserId?{users:[{id:teamUserId}]}:{}),
      ...(trade.close_date?{projectedCloseDate:trade.close_date}:{}),
      ...(trade.sale_price?{price:trade.sale_price}:{}),    // sale price -> tracks volume
      ...(trade.gci?{commissionValue:trade.gci}:{}),         // GCI -> tracks commission
      ...(trade.peopleIds?.length?{peopleIds:trade.peopleIds}:{}),
      description:[
        `Trade #: ${trade.trade_number}`,
        trade.side?`David rep'd: ${trade.side}`:null,
        trade.sale_price?`Sale price: $${Number(trade.sale_price).toLocaleString()}`:null,
        (trade.ends!=null)?`Ends: ${trade.ends}`:null,
        `Gross GCI: $${Number(trade.gci||0).toLocaleString()}`,
        isLease?'Type: lease':null
      ].filter(Boolean).join('\n')
    };
    const r=await fubFetch('/deals','POST',headers,payload);
    if(!r.ok) return res.status(200).json({success:false, error:`FUB ${r.status}`, detail:JSON.stringify(r.body).slice(0,300), payload});
    await redis.set(dedupeKey, String(r.body.id));
    return res.status(200).json({success:true, dealId:r.body.id, stage:stage.name, linked:trade.peopleIds?.length||0, trade_number:trade.trade_number});
  }catch(e){ return res.status(500).json({error:e.message}); }
};
