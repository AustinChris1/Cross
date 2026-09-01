import "dotenv/config";
const q = async (url, query, variables) => (await (await fetch(url, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({query, variables}) })).json());
const IX = process.env.INDEXER_URL, PF = process.env.PRICE_FEED_URL;
console.log("=== OracleAnswer with numeric ids ===");
console.log(JSON.stringify(await q(IX, `query($qids:[numeric!]){ OracleAnswer(where:{oracleQuestionId:{_in:$qids}}){ oracleQuestionId numericValue resolvedAt } }`, { qids: [48447, 48448] })).slice(0,400));
console.log("\n=== Feed fields ===");
console.log(JSON.stringify(await q(PF, `{ __type(name:"Feed"){ fields{ name } } }`)).slice(0,700));
