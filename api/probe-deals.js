const fetch = require('node-fetch');
module.exports = async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  const key = process.env[req.query.agent==='lorry'?'LORRY_FUB_KEY':'DAVID_FUB_KEY'];
  if(!key) return res.status(400).json({error:'no key'});
  const enc = Buffer.from(key+':').toString('base64');
  const H={'Authorization':`Basic ${enc}`};
  try{
    // fetch deals with people included
    const r = await fetch('https://api.followupboss.com/v1/deals?limit=3&includeTeam=false', {headers:H});
    const d = await r.json();
    const sample = (d.deals||[]).map(x=>({id:x.id,name:x.name,stage:x.stage,price:x.price,people:x.people,personId:x.personId,contactId:x.contactId}));
    res.status(200).json({status:r.status, total:d._metadata?.total, sample});
  }catch(e){res.status(500).json({error:e.message});}
};
