// Firestore may return map keys in a different order from the submitted object.
export function stableStringify(value){
 const normalize=x=>{
  if(x===null||typeof x!=='object')return x;
  if(x instanceof Date)return x.toISOString();
  if(Array.isArray(x))return x.map(normalize);
  return Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,normalize(x[k])]));
 };
 return JSON.stringify(normalize(value));
}
