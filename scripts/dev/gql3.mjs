import "dotenv/config";
const q = async (url, query, variables) => (await (await fetch(url, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({query, variables}) })).json());
const PF = process.env.PRICE_FEED_URL;
const r = await q(PF, `{ Feed(where:{base:{_in:["BTC","ETH"]}}){ id base quote symbol decimals latestSpot latestMark latestUpdatedAtMs latestBlockTimestamp } }`);
const now = Date.now();
for (const f of r.data?.Feed ?? []) {
  const age = Math.round((now - Number(f.latestUpdatedAtMs))/1000);
  console.log(`${f.base}/${f.quote} id=${f.id} spot=${Number(f.latestSpot)/10**Number(f.decimals)} age=${age}s`);
}
