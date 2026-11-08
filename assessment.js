import {stableStringify} from './data-utils.js';
export function cleanAssessment(value={}) {
 const out={};
 for(const key of ['classic-single','fever-single','classic-double','fever-double','note']){
  const text=value[key]??'';
  if(typeof text!=='string'||text.length>3000)throw Error('実績メモは各欄3000文字以内で入力してください。');
  out[key]=text.trim();
 }
 return out;
}
export function assessmentFingerprint(p){return stableStringify([p.name||'',p.authUid||'',p.assessment||null]);}
export async function saveAssessment(api,db,person,value){
 const assessment=cleanAssessment(value),expected=assessmentFingerprint(person);
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'participants',person.id),snap=await tx.get(ref);
  if(!snap.exists()||assessmentFingerprint(snap.data())!==expected)throw Error('この参加者の名前または実績メモが更新されました。入力を控えて画面を読み直してください。');
  tx.update(ref,{assessment,assessmentUpdatedAt:api.serverTimestamp()});
 });
}
