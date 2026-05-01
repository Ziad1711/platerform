const fs=require("fs");const path=require("path");const d={};
d["test"]=Buffer.from("dGVzdCBjb250ZW50","base64").toString();
d["write"]=Buffer.from("d3JpdGU=","base64").toString();
for(const[k,v]of Object.entries(d)){const dir=path.dirname(k);if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(k,v,"utf8");console.log("Created:",k);}
